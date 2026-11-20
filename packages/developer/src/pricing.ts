import { withAppTx, type Db } from "@baytline/db";
import type { Actor } from "@baytline/identity";
import { audit, can, IdentityError, requireDeveloper } from "./guard";
import { currency, id, opt, optDate, parseMoney, req, reqDate } from "./validation";
import { decideVersion, loadVersion, mapVersionError, nextVersionNumber, submitVersion, type VersionMeta } from "./versions";

export type PriceListSummary = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  currency: string;
  versions: { id: string; version: number; status: string; effectiveFrom: string; effectiveTo: string | null; entryCount: number }[];
};

export async function listPriceLists(db: Db, actor: Actor, projectId?: string): Promise<PriceListSummary[]> {
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "price.view");
    const args: unknown[] = [];
    const where = ["l.org_id = app.current_org_id()"];
    if (projectId) where.push(`l.project_id = $${args.push(id(projectId))}`);
    const { rows } = await c.query(
      `select l.id, l.project_id, p.name as project_name, l.name, l.currency,
              coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'status', v.status,
                        'effectiveFrom', v.effective_from::text, 'effectiveTo', v.effective_to::text,
                        'entryCount', (select count(*) from app.price_list_entries e where e.version_id = v.id)) order by v.version desc)
                 from app.price_list_versions v where v.price_list_id = l.id), '[]') as versions
         from app.price_lists l join app.projects p on p.id = l.project_id
        where ${where.join(" and ")} order by p.name, l.name`,
      args,
    );
    return rows.map((r) => ({ id: r.id, projectId: r.project_id, projectName: r.project_name, name: r.name, currency: r.currency, versions: r.versions }));
  });
}

/** Currency defaults to the project's market currency (from market settings). */
export async function createPriceList(db: Db, actor: Actor, projectId: string, input: { name: unknown; currency?: unknown }): Promise<string> {
  const pid = id(projectId);
  const name = req(input.name, 120, "list_name");
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "price.change.request");
    const { rows: p } = await c.query("select m.currency from app.projects p join app.markets m on m.code = p.market where p.id = $1", [pid]);
    if (!p[0]) throw new IdentityError("not_found");
    const cur = input.currency ? currency(input.currency) : p[0].currency;
    try {
      await c.query("savepoint s");
      const { rows } = await c.query<{ id: string }>(
        "insert into app.price_lists (org_id, project_id, name, currency, created_by) values (app.current_org_id(), $1, $2, $3, $4) returning id",
        [pid, name, cur, actor.userId],
      );
      await audit(c, actor, { type: "price_list.created", target: { type: "price_list", id: rows[0]!.id } });
      return rows[0]!.id;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        await c.query("rollback to savepoint s");
        throw new IdentityError("conflict", "list_name_taken");
      }
      throw e;
    }
  });
}

/** New draft version, starting from the latest approved prices (or the given version). */
export async function createPriceVersion(
  db: Db,
  actor: Actor,
  listId: string,
  input: { effectiveFrom: unknown; effectiveTo?: unknown; notes?: unknown; copyFrom?: string },
): Promise<string> {
  const lid = id(listId);
  const from = reqDate(input.effectiveFrom, "effective_from");
  const to = optDate(input.effectiveTo, "effective_to");
  if (to && to < from) throw new IdentityError("invalid_input", "effective_to");
  const notes = opt(input.notes, 1000, "notes", true);
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "price.change.request");
    const l = await c.query("select 1 from app.price_lists where id = $1", [lid]);
    if (!l.rowCount) throw new IdentityError("not_found");
    const n = await nextVersionNumber(c, "price", lid);
    const { rows } = await c.query<{ id: string }>(
      `insert into app.price_list_versions (org_id, price_list_id, version, effective_from, effective_to, notes, created_by)
       values (app.current_org_id(), $1, $2, $3, $4, $5, $6) returning id`,
      [lid, n, from, to, notes, actor.userId],
    );
    const vid = rows[0]!.id;
    const source = input.copyFrom
      ? id(input.copyFrom)
      : (await c.query<{ id: string }>("select id from app.price_list_versions where price_list_id = $1 and status = 'approved' order by effective_from desc limit 1", [lid])).rows[0]?.id;
    if (source) {
      await c.query(
        `insert into app.price_list_entries (org_id, version_id, unit_id, price_minor)
         select org_id, $1, unit_id, price_minor from app.price_list_entries where version_id = $2`,
        [vid, source],
      );
    }
    await audit(c, actor, { type: "price_version.created", target: { type: "price_version", id: vid }, metadata: { version: n } });
    return vid;
  });
}

export type PriceVersionDetail = VersionMeta & {
  listId: string;
  listName: string;
  currency: string;
  projectId: string;
  projectName: string;
  rows: { unitId: string; code: string; phaseName: string | null; status: string; isSample: boolean; priceMinor: string | null; previousMinor: string | null }[];
  canEdit: boolean;
  canSubmit: boolean;
  canDecide: boolean;
};

export async function getPriceVersion(db: Db, actor: Actor, versionId: string): Promise<PriceVersionDetail> {
  const vid = id(versionId);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireDeveloper(c, actor, "price.view");
    const v = await loadVersion(c, "price", vid);
    const { rows: l } = await c.query(
      "select l.id, l.name, l.currency, p.id as project_id, p.name as project_name from app.price_lists l join app.projects p on p.id = l.project_id where l.id = $1",
      [v.parentId],
    );
    // Every unit in the project, with this version's price and the last approved price for comparison.
    const { rows } = await c.query(
      `select u.id, u.code, ph.name as phase_name, u.status, u.is_sample, e.price_minor::text as price,
              (select pe.price_minor::text from app.price_list_entries pe join app.price_list_versions pv on pv.id = pe.version_id
                where pe.unit_id = u.id and pv.price_list_id = $2 and pv.status in ('approved','superseded') and pv.version < $3
                order by pv.version desc limit 1) as previous
         from app.units u
         left join app.project_phases ph on ph.id = u.phase_id
         left join app.price_list_entries e on e.unit_id = u.id and e.version_id = $1
        where u.project_id = $4
        order by ph.sort_order nulls last, u.code`,
      [vid, v.parentId, v.version, l[0].project_id],
    );
    const isDraft = v.status === "draft";
    return {
      ...v,
      listId: l[0].id,
      listName: l[0].name,
      currency: l[0].currency,
      projectId: l[0].project_id,
      projectName: l[0].project_name,
      rows: rows.map((r) => ({ unitId: r.id, code: r.code, phaseName: r.phase_name, status: r.status, isSample: r.is_sample, priceMinor: r.price, previousMinor: r.previous })),
      canEdit: isDraft && can(ctx, "price.change.request"),
      canSubmit: isDraft && can(ctx, "price.change.request"),
      canDecide: v.status === "submitted" && can(ctx, "price.change.approve") && v.submittedBy !== actor.userId,
    };
  });
}

/** Replaces this draft's prices. Blank means "not priced in this version". */
export async function savePriceDraft(
  db: Db,
  actor: Actor,
  versionId: string,
  input: { effectiveFrom: unknown; effectiveTo?: unknown; notes?: unknown; prices: Record<string, unknown> },
): Promise<number> {
  const vid = id(versionId);
  const from = reqDate(input.effectiveFrom, "effective_from");
  const to = optDate(input.effectiveTo, "effective_to");
  if (to && to < from) throw new IdentityError("invalid_input", "effective_to");
  const notes = opt(input.notes, 1000, "notes", true);
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "price.change.request");
    const v = await loadVersion(c, "price", vid, true);
    if (v.status !== "draft") throw new IdentityError("invalid_input", "version_locked");
    const { rows: l } = await c.query("select currency, project_id from app.price_lists where id = $1", [v.parentId]);
    const { rows: units } = await c.query<{ id: string }>("select id from app.units where project_id = $1", [l[0].project_id]);
    const valid = new Set(units.map((u) => u.id));
    const entries: [string, bigint][] = [];
    for (const [unitId, raw] of Object.entries(input.prices)) {
      if (!valid.has(unitId)) throw new IdentityError("invalid_input", "unit");
      const minor = parseMoney(raw, l[0].currency);
      if (minor !== null) entries.push([unitId, minor]);
    }
    try {
      await c.query("update app.price_list_versions set effective_from = $2, effective_to = $3, notes = $4 where id = $1", [vid, from, to, notes]);
      await c.query("delete from app.price_list_entries where version_id = $1", [vid]);
      for (const [unitId, minor] of entries) {
        await c.query("insert into app.price_list_entries (org_id, version_id, unit_id, price_minor) values (app.current_org_id(), $1, $2, $3)", [vid, unitId, minor.toString()]);
      }
    } catch (e) {
      mapVersionError(e);
    }
    return entries.length;
  });
}

export async function submitPriceVersion(db: Db, actor: Actor, versionId: string): Promise<void> {
  const vid = id(versionId);
  await withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "price.change.request");
    const { rows } = await c.query<{ n: number }>("select count(*)::int as n from app.price_list_entries where version_id = $1", [vid]);
    if (!rows[0]!.n) throw new IdentityError("invalid_input", "no_prices");
    await submitVersion(c, actor, "price", vid);
  });
}

export async function decidePriceVersion(db: Db, actor: Actor, versionId: string, decision: unknown, note?: unknown): Promise<void> {
  const vid = id(versionId);
  if (decision !== "approve" && decision !== "reject") throw new IdentityError("invalid_input", "decision");
  const n = opt(note, 500, "decision_note", true);
  if (decision === "reject" && !n) throw new IdentityError("invalid_input", "decision_note_required");
  await withAppTx(db, actor, async (c) => {
    const ctx = await requireDeveloper(c, actor, "price.change.approve");
    await decideVersion(c, actor, ctx, "price", vid, decision, n);
  });
}
