import { MILESTONE_TRIGGERS, type MilestoneTrigger } from "@baytline/core";
import { withAppTx, type Db } from "@baytline/db";
import type { Actor } from "@baytline/identity";
import { audit, can, IdentityError, requireDeveloper } from "./guard";
import { currency, id, oneOf, opt, optDate, optDecimal, optInt, parseMoney, req, reqDate } from "./validation";
import { decideVersion, loadVersion, mapVersionError, nextVersionNumber, submitVersion, type VersionMeta } from "./versions";

export type Milestone = {
  seq: number;
  label: string;
  trigger: MilestoneTrigger;
  dueDate: string | null;
  progressPercent: string | null;
  monthsAfterHandover: number | null;
  percent: string | null;
  amountMinor: string | null;
};

export type PlanSummary = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  versions: { id: string; version: number; status: string; effectiveFrom: string; effectiveTo: string | null; milestoneCount: number }[];
};

export async function listPlans(db: Db, actor: Actor, projectId?: string): Promise<PlanSummary[]> {
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "price.view");
    const args: unknown[] = [];
    const where = ["pl.org_id = app.current_org_id()"];
    if (projectId) where.push(`pl.project_id = $${args.push(id(projectId))}`);
    const { rows } = await c.query(
      `select pl.id, pl.project_id, p.name as project_name, pl.name,
              coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'status', v.status,
                        'effectiveFrom', v.effective_from::text, 'effectiveTo', v.effective_to::text,
                        'milestoneCount', (select count(*) from app.payment_plan_milestones m where m.version_id = v.id)) order by v.version desc)
                 from app.payment_plan_versions v where v.plan_id = pl.id), '[]') as versions
         from app.payment_plans pl join app.projects p on p.id = pl.project_id
        where ${where.join(" and ")} order by p.name, pl.name`,
      args,
    );
    return rows.map((r) => ({ id: r.id, projectId: r.project_id, projectName: r.project_name, name: r.name, versions: r.versions }));
  });
}

export async function createPlan(db: Db, actor: Actor, projectId: string, input: { name: unknown }): Promise<string> {
  const pid = id(projectId);
  const name = req(input.name, 120, "plan_name");
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "payment_plan.manage");
    const p = await c.query("select 1 from app.projects where id = $1", [pid]);
    if (!p.rowCount) throw new IdentityError("not_found");
    try {
      await c.query("savepoint s");
      const { rows } = await c.query<{ id: string }>(
        "insert into app.payment_plans (org_id, project_id, name, created_by) values (app.current_org_id(), $1, $2, $3) returning id",
        [pid, name, actor.userId],
      );
      await audit(c, actor, { type: "payment_plan.created", target: { type: "payment_plan", id: rows[0]!.id } });
      return rows[0]!.id;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        await c.query("rollback to savepoint s");
        throw new IdentityError("conflict", "plan_name_taken");
      }
      throw e;
    }
  });
}

export async function createPlanVersion(db: Db, actor: Actor, planId: string, input: { effectiveFrom: unknown; currency?: unknown }): Promise<string> {
  const plid = id(planId);
  const from = reqDate(input.effectiveFrom, "effective_from");
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "payment_plan.manage");
    const { rows: p } = await c.query("select m.currency from app.payment_plans pl join app.projects p on p.id = pl.project_id join app.markets m on m.code = p.market where pl.id = $1", [plid]);
    if (!p[0]) throw new IdentityError("not_found");
    const latest = (await c.query("select id, currency, handover_terms from app.payment_plan_versions where plan_id = $1 and status = 'approved' order by effective_from desc limit 1", [plid])).rows[0];
    const cur = input.currency ? currency(input.currency) : (latest?.currency ?? p[0].currency);
    const n = await nextVersionNumber(c, "plan", plid);
    const { rows } = await c.query<{ id: string }>(
      `insert into app.payment_plan_versions (org_id, plan_id, version, currency, effective_from, handover_terms, created_by)
       values (app.current_org_id(), $1, $2, $3, $4, $5, $6) returning id`,
      [plid, n, cur, from, latest?.handover_terms ?? null, actor.userId],
    );
    const vid = rows[0]!.id;
    if (latest && latest.currency === cur) {
      await c.query(
        `insert into app.payment_plan_milestones (org_id, version_id, seq, label, trigger_kind, due_date, progress_percent, months_after_handover, percent, amount_minor)
         select org_id, $1, seq, label, trigger_kind, due_date, progress_percent, months_after_handover, percent, amount_minor
           from app.payment_plan_milestones where version_id = $2`,
        [vid, latest.id],
      );
    }
    await audit(c, actor, { type: "plan_version.created", target: { type: "plan_version", id: vid }, metadata: { version: n } });
    return vid;
  });
}

export type PlanVersionDetail = VersionMeta & {
  planId: string;
  planName: string;
  projectId: string;
  projectName: string;
  currency: string;
  handoverTerms: string | null;
  milestones: Milestone[];
  percentTotal: string;
  canEdit: boolean;
  canSubmit: boolean;
  canDecide: boolean;
};

export async function getPlanVersion(db: Db, actor: Actor, versionId: string): Promise<PlanVersionDetail> {
  const vid = id(versionId);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireDeveloper(c, actor, "price.view");
    const v = await loadVersion(c, "plan", vid);
    const { rows: pl } = await c.query("select pl.id, pl.name, p.id as project_id, p.name as project_name from app.payment_plans pl join app.projects p on p.id = pl.project_id where pl.id = $1", [v.parentId]);
    const { rows: ms } = await c.query(
      `select seq, label, trigger_kind, due_date::text, progress_percent::text, months_after_handover, percent::text, amount_minor::text
         from app.payment_plan_milestones where version_id = $1 order by seq`,
      [vid],
    );
    const isDraft = v.status === "draft";
    const total = ms.reduce((sum, m) => sum + (m.percent ? Math.round(Number(m.percent) * 100) : 0), 0);
    return {
      ...v,
      planId: pl[0].id,
      planName: pl[0].name,
      projectId: pl[0].project_id,
      projectName: pl[0].project_name,
      currency: v.currency,
      handoverTerms: v.handover_terms,
      milestones: ms.map((m) => ({
        seq: m.seq,
        label: m.label,
        trigger: m.trigger_kind,
        dueDate: m.due_date,
        progressPercent: m.progress_percent,
        monthsAfterHandover: m.months_after_handover,
        percent: m.percent,
        amountMinor: m.amount_minor,
      })),
      percentTotal: (total / 100).toFixed(2),
      canEdit: isDraft && can(ctx, "payment_plan.manage"),
      canSubmit: isDraft && can(ctx, "payment_plan.publish"),
      canDecide: v.status === "submitted" && can(ctx, "payment_plan.approve") && v.submittedBy !== actor.userId,
    };
  });
}

export type MilestoneInput = {
  label: unknown;
  trigger: unknown;
  dueDate?: unknown;
  progressPercent?: unknown;
  monthsAfterHandover?: unknown;
  percent?: unknown;
  amount?: unknown;
};

/** Replaces the draft's terms and milestones. Each milestone is either a percentage or a fixed amount. */
export async function savePlanDraft(
  db: Db,
  actor: Actor,
  versionId: string,
  input: { currency: unknown; effectiveFrom: unknown; effectiveTo?: unknown; handoverTerms?: unknown; notes?: unknown; milestones: MilestoneInput[] },
): Promise<void> {
  const vid = id(versionId);
  const cur = currency(input.currency);
  const from = reqDate(input.effectiveFrom, "effective_from");
  const to = optDate(input.effectiveTo, "effective_to");
  if (to && to < from) throw new IdentityError("invalid_input", "effective_to");
  const handover = opt(input.handoverTerms, 2000, "handover_terms", true);
  const notes = opt(input.notes, 1000, "notes", true);
  if (input.milestones.length > 60) throw new IdentityError("invalid_input", "too_many_milestones");
  const ms = input.milestones.map((m, i) => {
    const trigger = oneOf(m.trigger, MILESTONE_TRIGGERS, "milestone_trigger");
    const percent = optDecimal(m.percent, "milestone_percent", { max: 100, places: 2 });
    const amount = parseMoney(m.amount, cur, "milestone_amount");
    if ((percent === null) === (amount === null)) throw new IdentityError("invalid_input", "milestone_percent_or_amount");
    const dueDate = trigger === "on_date" ? reqDate(m.dueDate, "milestone_due_date") : null;
    const progress = trigger === "construction_progress" ? optDecimal(m.progressPercent, "milestone_progress", { max: 100, places: 2 }) : null;
    if (trigger === "construction_progress" && !progress) throw new IdentityError("invalid_input", "milestone_progress");
    const months = trigger === "after_handover" ? optInt(m.monthsAfterHandover, 1, 120, "milestone_months") : null;
    if (trigger === "after_handover" && !months) throw new IdentityError("invalid_input", "milestone_months");
    return { seq: i + 1, label: req(m.label, 120, "milestone_label"), trigger, dueDate, progress, months, percent, amount };
  });
  // Arithmetic consistency only. The platform doesn't decide what a valid plan is beyond adding up.
  const pct = ms.reduce((s, m) => s + (m.percent ? Math.round(Number(m.percent) * 100) : 0), 0);
  if (pct > 10000) throw new IdentityError("invalid_input", "percent_over_100");

  await withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "payment_plan.manage");
    const v = await loadVersion(c, "plan", vid, true);
    if (v.status !== "draft") throw new IdentityError("invalid_input", "version_locked");
    try {
      await c.query(
        "update app.payment_plan_versions set currency = $2, effective_from = $3, effective_to = $4, handover_terms = $5, notes = $6 where id = $1",
        [vid, cur, from, to, handover, notes],
      );
      await c.query("delete from app.payment_plan_milestones where version_id = $1", [vid]);
      for (const m of ms) {
        await c.query(
          `insert into app.payment_plan_milestones (org_id, version_id, seq, label, trigger_kind, due_date, progress_percent, months_after_handover, percent, amount_minor)
           values (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [vid, m.seq, m.label, m.trigger, m.dueDate, m.progress, m.months, m.percent, m.amount?.toString() ?? null],
        );
      }
    } catch (e) {
      mapVersionError(e);
    }
  });
}

export async function submitPlanVersion(db: Db, actor: Actor, versionId: string): Promise<void> {
  const vid = id(versionId);
  await withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "payment_plan.publish");
    const { rows } = await c.query<{ n: number; pct: string | null; amounts: number }>(
      "select count(*)::int as n, sum(percent)::text as pct, count(amount_minor)::int as amounts from app.payment_plan_milestones where version_id = $1",
      [vid],
    );
    const r = rows[0]!;
    if (!r.n) throw new IdentityError("invalid_input", "no_milestones");
    // A plan made only of percentages must add up to exactly 100%.
    if (r.amounts === 0 && Number(r.pct) !== 100) throw new IdentityError("invalid_input", "percent_not_100");
    await submitVersion(c, actor, "plan", vid);
  });
}

export async function decidePlanVersion(db: Db, actor: Actor, versionId: string, decision: unknown, note?: unknown): Promise<void> {
  const vid = id(versionId);
  if (decision !== "approve" && decision !== "reject") throw new IdentityError("invalid_input", "decision");
  const n = opt(note, 500, "decision_note", true);
  if (decision === "reject" && !n) throw new IdentityError("invalid_input", "decision_note_required");
  await withAppTx(db, actor, async (c) => {
    const ctx = await requireDeveloper(c, actor, "payment_plan.approve");
    await decideVersion(c, actor, ctx, "plan", vid, decision, n);
  });
}
