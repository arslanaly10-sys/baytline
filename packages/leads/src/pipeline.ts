import { availabilityLabel, type AvailabilityLabel } from "@baytline/core";
import { withAppTx, type Client, type Db } from "@baytline/db";
import type { Actor } from "@baytline/identity";
import { audit, can, f, guarded, IdentityError, requireLeadOrg, requireOrg } from "./guard";
import { leadEvent } from "./leads";

// ---------------------------------------------------------------- shared: what this organization may see of a project

/** A project the organization owns, or one actively shared with it. Never a sample. */
async function visibleProject(c: Client, orgType: string, projectId: string): Promise<{ id: string; name: string; timeZone: string; currency: string; developerOrgId: string }> {
  const scope = orgType === "developer"
    ? "p.org_id = app.current_org_id()"
    : "exists (select 1 from app.project_shares s where s.project_id = p.id and s.brokerage_org_id = app.current_org_id() and s.status = 'active')";
  const { rows } = await c.query(
    `select p.id, p.name, mk.time_zone, mk.currency, p.org_id from app.projects p join app.markets mk on mk.code = p.market where p.id = $1 and not p.is_sample and ${scope}`,
    [projectId],
  );
  if (!rows[0]) throw new IdentityError("invalid_input", "project");
  return { id: rows[0].id, name: rows[0].name, timeZone: rows[0].time_zone, currency: rows[0].currency, developerOrgId: rows[0].org_id };
}

async function leadRow(c: Client, leadId: string) {
  const { rows } = await c.query("select id, status from app.leads where id = $1 and org_id = app.current_org_id() for update", [leadId]);
  if (!rows[0]) throw new IdentityError("not_found");
  return rows[0] as { id: string; status: string };
}

async function advanceLead(c: Client, actor: Actor, leadId: string, from: string[], to: string) {
  const { rows } = await c.query("update app.leads set status = $2, updated_at = now(), updated_by = $3 where id = $1 and status = any($4::text[]) returning id", [leadId, to, actor.userId, from]);
  if (rows[0]) await leadEvent(c, actor, leadId, "status", { to, automatic: true });
}

// ---------------------------------------------------------------- viewings

export type Viewing = {
  id: string; leadId: string; leadName: string; projectId: string; projectName: string; unitId: string | null; unitCode: string | null;
  scheduledFor: Date; timeZone: string; status: "scheduled" | "completed" | "no_show" | "cancelled"; outcome: string | null; assigneeName: string | null;
};

/** A viewing actually arranged with the client. `localDateTime` is in the project's market time zone. */
export async function scheduleViewing(db: Db, actor: Actor, leadId: string, i: { projectId: unknown; unitId?: unknown; localDateTime: unknown; appointmentId?: unknown }): Promise<string> {
  const lid = f.id(leadId);
  const pid = f.id(i.projectId);
  const uid = typeof i.unitId === "string" && i.unitId ? f.id(i.unitId) : null;
  const at = typeof i.localDateTime === "string" ? i.localDateTime.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) throw new IdentityError("invalid_input", "scheduled_for");
  const appt = typeof i.appointmentId === "string" && i.appointmentId ? f.id(i.appointmentId) : null;
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireLeadOrg(c, actor, "viewing.manage");
    await leadRow(c, lid);
    const p = await visibleProject(c, ctx.org.type, pid);
    const { rows } = await guarded(c, () => c.query<{ id: string }>(
      `insert into app.viewings (org_id, lead_id, project_id, unit_id, appointment_id, scheduled_for, time_zone, assignee_user_id, created_by)
       select app.current_org_id(), $1, $2, $3, $4, ($5::timestamp at time zone $6), $6, $7, $7
        where ($5::timestamp at time zone $6) > now() - interval '1 day' returning id`,
      [lid, pid, uid, appt, at, p.timeZone, actor.userId],
    ));
    if (!rows[0]) throw new IdentityError("invalid_input", "scheduled_for");
    await leadEvent(c, actor, lid, "viewing", { scheduled: at, project: p.name });
    await advanceLead(c, actor, lid, ["new", "contacted", "qualified"], "viewing");
    await audit(c, actor, { type: "viewing.scheduled", target: { type: "viewing", id: rows[0].id } });
    return rows[0].id;
  });
}

export async function updateViewing(db: Db, actor: Actor, viewingId: string, i: { status: unknown; outcome?: unknown }): Promise<void> {
  const id = f.id(viewingId);
  const st = f.oneOf(i.status, ["scheduled", "completed", "no_show", "cancelled"] as const, "status");
  const outcome = f.opt(i.outcome, 1000, "outcome", true);
  await withAppTx(db, actor, async (c) => {
    await requireLeadOrg(c, actor, "viewing.manage");
    const { rows } = await c.query("select lead_id, status from app.viewings where id = $1 and org_id = app.current_org_id() for update", [id]);
    if (!rows[0]) throw new IdentityError("not_found");
    await c.query("update app.viewings set status = $2, outcome = coalesce($3, outcome), updated_at = now(), updated_by = $4 where id = $1", [id, st, outcome, actor.userId]);
    await leadEvent(c, actor, rows[0].lead_id, "viewing", { from: rows[0].status, to: st });
    await audit(c, actor, { type: "viewing.updated", target: { type: "viewing", id }, metadata: { status: st } });
  });
}

export async function listViewings(db: Db, actor: Actor, i: { when?: string; leadId?: string } = {}): Promise<{ items: Viewing[]; canManage: boolean }> {
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireLeadOrg(c, actor, "lead.view");
    const args: unknown[] = [];
    const where = ["v.org_id = app.current_org_id()"];
    if (i.leadId) where.push(`v.lead_id = $${args.push(f.id(i.leadId))}`);
    else if (i.when === "past") where.push("(v.scheduled_for < now() or v.status <> 'scheduled')");
    else where.push("v.status = 'scheduled'");
    const { rows } = await c.query(
      `select v.*, l.contact_name, p.name as project_name, u.code as unit_code, au.display_name as assignee_name
         from app.viewings v join app.leads l on l.id = v.lead_id join app.projects p on p.id = v.project_id
         left join app.units u on u.id = v.unit_id left join app.users au on au.id = v.assignee_user_id
        where ${where.join(" and ")} order by v.scheduled_for ${i.when === "past" ? "desc" : "asc"} limit 300`,
      args,
    );
    return {
      items: rows.map((r) => ({
        id: r.id, leadId: r.lead_id, leadName: r.contact_name, projectId: r.project_id, projectName: r.project_name, unitId: r.unit_id, unitCode: r.unit_code,
        scheduledFor: r.scheduled_for, timeZone: r.time_zone, status: r.status, outcome: r.outcome, assigneeName: r.assignee_name,
      })),
      canManage: can(ctx, "viewing.manage"),
    };
  });
}

// ---------------------------------------------------------------- deals

export type DealStage = "negotiating" | "reserved" | "contracted" | "won" | "lost";
export type Deal = {
  id: string; leadId: string; leadName: string; projectId: string; projectName: string; unitId: string; unitCode: string; stage: DealStage;
  agreedPriceMinor: string | null; currency: string; listPriceMinor: string | null; availabilityAtOpen: AvailabilityLabel; registrationId: string | null;
  note: string | null; lostReason: string | null; closedAt: Date | null; createdAt: Date; createdByName: string | null;
  claim: { id: string; status: string; amountMinor: string; decidedAt: Date | null; decisionNote: string | null } | null;
};

/**
 * Opens a deal on a real unit: visible to this organization, not a sample, available or reserved. The
 * approved list price and the unit's inventory label at this moment are recorded with the deal.
 */
export async function createDeal(db: Db, actor: Actor, leadId: string, i: { unitId: unknown; registrationId?: unknown; note?: unknown }, now = new Date()): Promise<string> {
  const lid = f.id(leadId);
  const uid = f.id(i.unitId);
  const rid = typeof i.registrationId === "string" && i.registrationId ? f.id(i.registrationId) : null;
  const note = f.opt(i.note, 1000, "note", true);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireLeadOrg(c, actor, "deal.manage");
    await leadRow(c, lid);
    const { rows: ur } = await c.query(
      `select u.*, p.id as pid, mk.time_zone, src.freshness_hours, coalesce(src.authorization_status = 'authorized', true) as source_authorized
         from app.units u join app.projects p on p.id = u.project_id join app.markets mk on mk.code = p.market
         left join app.inventory_sources src on src.id = u.source_id where u.id = $1`,
      [uid],
    );
    const u = ur[0];
    if (!u || u.is_sample || !["available", "reserved"].includes(u.status)) throw new IdentityError("invalid_input", "unit");
    const p = await visibleProject(c, ctx.org.type, u.project_id);
    const { rows: pr } = await c.query(
      `select e.price_minor::text as price_minor, l.currency, v.id as version_id from app.price_list_entries e
         join app.price_list_versions v on v.id = e.version_id join app.price_lists l on l.id = v.price_list_id
        where e.unit_id = $1 and v.status = 'approved' and v.effective_from <= (now() at time zone $2)::date and (v.effective_to is null or v.effective_to >= (now() at time zone $2)::date)
        order by v.effective_from desc, v.decided_at desc limit 1`,
      [uid, u.time_zone],
    );
    const label = availabilityLabel(
      { sourceKind: u.source_kind, sourceId: "", ownerOrgId: "", lastUpdatedAt: u.last_updated_at.toISOString(), lastVerifiedAt: u.last_verified_at?.toISOString(),
        verification: u.verification, version: u.version, freshnessHours: u.freshness_hours, sourceAuthorized: u.source_authorized },
      now,
    );
    if (rid) {
      const { rows: reg } = await c.query("select status, protected_from, protected_until from app.client_registrations where id = $1 and brokerage_org_id = app.current_org_id() and lead_id = $2 and project_id = $3", [rid, lid, u.project_id]);
      if (!reg[0] || reg[0].status !== "approved" || reg[0].protected_until < now) throw new IdentityError("invalid_input", "registration");
    }
    const { rows } = await guarded(c, () => c.query<{ id: string }>(
      `insert into app.deals (org_id, lead_id, project_id, unit_id, registration_id, currency, list_price_minor, list_price_version_id, availability_label, note, created_by)
       values (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [lid, u.project_id, uid, rid, pr[0]?.currency ?? p.currency, pr[0]?.price_minor ?? null, pr[0]?.version_id ?? null, label, note, actor.userId],
    ));
    const id = rows[0]!.id;
    await leadEvent(c, actor, lid, "deal", { opened: u.code, project: p.name, availability: label });
    await advanceLead(c, actor, lid, ["new", "contacted", "qualified", "viewing"], "negotiating");
    await audit(c, actor, { type: "deal.created", target: { type: "deal", id } });
    return id;
  });
}

/** Moves a deal along. A won deal needs the agreed price (as recorded, not calculated); a lost one a reason. */
export async function updateDeal(db: Db, actor: Actor, dealId: string, i: { stage: unknown; agreedPrice?: unknown; lostReason?: unknown; note?: unknown }): Promise<void> {
  const id = f.id(dealId);
  const stage = f.oneOf(i.stage, ["negotiating", "reserved", "contracted", "won", "lost"] as const, "stage");
  await withAppTx(db, actor, async (c) => {
    await requireLeadOrg(c, actor, "deal.manage");
    const { rows } = await c.query("select * from app.deals where id = $1 and org_id = app.current_org_id() for update", [id]);
    const d = rows[0];
    if (!d) throw new IdentityError("not_found");
    if (d.stage === "won" || d.stage === "lost") throw new IdentityError("invalid_input", "deal_closed");
    const agreed = typeof i.agreedPrice === "string" && i.agreedPrice.trim() ? f.parseMoney(i.agreedPrice, d.currency, "agreed_price") : d.agreed_price_minor ? BigInt(d.agreed_price_minor) : null;
    if (stage === "won" && !agreed) throw new IdentityError("invalid_input", "agreed_price");
    const lost = stage === "lost" ? f.req(i.lostReason, 300, "lost_reason") : null;
    const note = f.opt(i.note, 1000, "note", true);
    await c.query(
      `update app.deals set stage = $2, agreed_price_minor = $3, lost_reason = $4, note = coalesce($5, note), closed_at = case when $2 in ('won','lost') then now() end,
              updated_at = now(), updated_by = $6 where id = $1`,
      [id, stage, agreed?.toString() ?? null, lost, note, actor.userId],
    );
    await leadEvent(c, actor, d.lead_id, "deal", { stage });
    if (stage === "won") await advanceLead(c, actor, d.lead_id, ["new", "contacted", "qualified", "viewing", "negotiating"], "won");
    await audit(c, actor, { type: "deal.updated", target: { type: "deal", id }, metadata: { stage } });
  });
}

export async function listDeals(db: Db, actor: Actor, i: { stage?: string; leadId?: string } = {}): Promise<{ items: Deal[]; canManage: boolean; canClaim: boolean }> {
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireLeadOrg(c, actor, "deal.view");
    const args: unknown[] = [];
    const where = ["d.org_id = app.current_org_id()"];
    if (i.leadId) where.push(`d.lead_id = $${args.push(f.id(i.leadId))}`);
    if (i.stage === "open") where.push("d.stage not in ('won','lost')");
    else if (i.stage && ["negotiating", "reserved", "contracted", "won", "lost"].includes(i.stage)) where.push(`d.stage = $${args.push(i.stage)}`);
    const { rows } = await c.query(
      `select d.*, l.contact_name, p.name as project_name, u.code as unit_code, cu.display_name as created_name,
              (select json_build_object('id', k.id, 'status', k.status, 'amountMinor', k.amount_minor::text, 'decidedAt', k.decided_at, 'decisionNote', k.decision_note)
                 from app.commission_claims k where k.deal_id = d.id order by k.submitted_at desc limit 1) as claim
         from app.deals d join app.leads l on l.id = d.lead_id join app.projects p on p.id = d.project_id join app.units u on u.id = d.unit_id
         left join app.users cu on cu.id = d.created_by
        where ${where.join(" and ")} order by d.created_at desc limit 300`,
      args,
    );
    return {
      items: rows.map((r) => ({
        id: r.id, leadId: r.lead_id, leadName: r.contact_name, projectId: r.project_id, projectName: r.project_name, unitId: r.unit_id, unitCode: r.unit_code, stage: r.stage,
        agreedPriceMinor: r.agreed_price_minor?.toString() ?? null, currency: r.currency, listPriceMinor: r.list_price_minor?.toString() ?? null, availabilityAtOpen: r.availability_label,
        registrationId: r.registration_id, note: r.note, lostReason: r.lost_reason, closedAt: r.closed_at, createdAt: r.created_at, createdByName: r.created_name,
        claim: r.claim ? { ...r.claim, decidedAt: r.claim.decidedAt ? new Date(r.claim.decidedAt) : null } : null,
      })),
      canManage: can(ctx, "deal.manage"),
      canClaim: ctx.org.type === "brokerage" && can(ctx, "deal.manage"),
    };
  });
}

// ---------------------------------------------------------------- commission claims

export type Claim = {
  id: string; dealId: string; projectName: string; unitCode: string; clientName: string; claimantName: string; dealPriceMinor: string; currency: string;
  basis: "percent" | "fixed"; ratePercent: string | null; amountMinor: string; note: string | null; status: "submitted" | "approved" | "rejected" | "withdrawn";
  submittedAt: Date; submittedBy: string; decidedAt: Date | null; decisionNote: string | null; protectedFrom: Date | null; protectedUntil: Date | null; dealDate: Date;
};

/**
 * The brokerage claims commission on a won deal backed by an approved registration that was protecting
 * the client when the deal was opened. Staff enter the agreed amount; with a percentage basis the amount
 * must agree with the rate (a consistency check, not a calculator).
 */
export async function submitClaim(db: Db, actor: Actor, dealId: string, i: { basis: unknown; ratePercent?: unknown; amount: unknown; note?: unknown }): Promise<string> {
  const id = f.id(dealId);
  const basis = f.oneOf(i.basis, ["percent", "fixed"] as const, "basis");
  const rate = basis === "percent" ? (typeof i.ratePercent === "string" ? i.ratePercent.trim() : "") : null;
  if (basis === "percent" && (!rate || !/^\d{1,3}(\.\d{1,3})?$/.test(rate) || Number(rate) <= 0 || Number(rate) > 100)) throw new IdentityError("invalid_input", "rate_percent");
  const note = f.opt(i.note, 500, "note", true);
  return withAppTx(db, actor, async (c) => {
    await requireOrg(c, actor, ["brokerage"], "deal.manage");
    const { rows } = await c.query("select lead_id, currency, agreed_price_minor from app.deals where id = $1 and org_id = app.current_org_id()", [id]);
    const d = rows[0];
    if (!d) throw new IdentityError("not_found");
    const amount = f.parseMoney(i.amount, d.currency, "amount");
    if (!amount) throw new IdentityError("invalid_input", "amount");
    if (basis === "percent" && d.agreed_price_minor) {
      // rate has up to 3 decimals: compare in thousandths of a percent, allowing one minor unit of rounding.
      const thousandths = BigInt(Math.round(Number(rate) * 1000));
      const expected = (BigInt(d.agreed_price_minor) * thousandths) / 100000n;
      const diff = expected > amount ? expected - amount : amount - expected;
      if (diff > 1n) throw new IdentityError("invalid_input", "amount_rate_mismatch");
    }
    const { rows: out } = await guarded(c, () => c.query<{ id: string }>("select app.submit_commission_claim($1, $2, $3, $4, $5) as id", [id, basis, rate, amount.toString(), note]));
    const cid = out[0]!.id;
    await leadEvent(c, actor, d.lead_id, "commission", { submitted: amount.toString() });
    await audit(c, actor, { type: "commission.submitted", target: { type: "commission_claim", id: cid } });
    return cid;
  });
}

export async function withdrawClaim(db: Db, actor: Actor, claimId: string): Promise<void> {
  const id = f.id(claimId);
  await withAppTx(db, actor, async (c) => {
    await requireOrg(c, actor, ["brokerage"], "deal.manage");
    await guarded(c, () => c.query("select app.withdraw_commission_claim($1)", [id]));
    await audit(c, actor, { type: "commission.withdrawn", target: { type: "commission_claim", id } });
  });
}

/** The developer's approver decides. Never the person who submitted it (enforced in SQL as well). */
export async function decideClaim(db: Db, actor: Actor, claimId: string, decision: unknown, note?: unknown): Promise<void> {
  const id = f.id(claimId);
  const d = f.oneOf(decision, ["approve", "reject"] as const, "decision");
  const n = f.opt(note, 500, "decision_note", true);
  if (d === "reject" && !n) throw new IdentityError("invalid_input", "decision_note_required");
  await withAppTx(db, actor, async (c) => {
    await requireOrg(c, actor, ["developer"], "commission.approve");
    await guarded(c, () => c.query("select app.decide_commission_claim($1, $2, $3)", [id, d, n]));
    await audit(c, actor, { type: "commission.decided", target: { type: "commission_claim", id }, metadata: { decision: d } });
  });
}

export async function listClaims(db: Db, actor: Actor, i: { status?: string } = {}): Promise<{ items: Claim[]; side: "brokerage" | "developer"; canDecide: boolean }> {
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireOrg(c, actor, ["brokerage", "developer"], "commission.view");
    const side = ctx.org.type === "developer" ? "developer" : "brokerage";
    const args: unknown[] = [];
    const where = [side === "developer" ? "k.payer_org_id = app.current_org_id()" : "k.claimant_org_id = app.current_org_id()"];
    if (i.status && ["submitted", "approved", "rejected", "withdrawn"].includes(i.status)) where.push(`k.status = $${args.push(i.status)}`);
    const { rows } = await c.query(
      `select k.*, r.protected_from, r.protected_until,
              (select d.created_at from app.deals d where d.id = k.deal_id) as deal_date
         from app.commission_claims k join app.client_registrations r on r.id = k.registration_id
        where ${where.join(" and ")} order by (k.status = 'submitted') desc, k.submitted_at desc limit 300`,
      args,
    );
    return {
      items: rows.map((r) => ({
        id: r.id, dealId: r.deal_id, projectName: r.project_name, unitCode: r.unit_code, clientName: r.client_name, claimantName: r.claimant_name,
        dealPriceMinor: r.deal_price_minor.toString(), currency: r.currency, basis: r.basis, ratePercent: r.rate_percent, amountMinor: r.amount_minor.toString(), note: r.note,
        status: r.status, submittedAt: r.submitted_at, submittedBy: r.submitted_by, decidedAt: r.decided_at, decisionNote: r.decision_note,
        protectedFrom: r.protected_from, protectedUntil: r.protected_until, dealDate: r.deal_date ?? r.submitted_at,
      })),
      side,
      canDecide: side === "developer" && can(ctx, "commission.approve"),
    };
  });
}
