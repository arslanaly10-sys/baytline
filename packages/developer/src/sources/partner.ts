import { hasCapability, UNIT_STATUSES } from "@baytline/core";
import { withAppTx, type Db } from "@baytline/db";
import { IdentityError, requireContext, writeAudit, type Actor } from "@baytline/identity";
import { id, opt } from "../validation";

/**
 * The brokerage side of a partner source: which developers authorized it to propose updates, for which
 * projects, and what it has submitted. A submission changes nothing until the developer reviews it.
 */
export type PartnerSourceView = {
  id: string; name: string; developerName: string; authorization: string;
  projects: { id: string; name: string }[];
  submissions: { id: string; projectName: string | null; status: string; rowCount: number; createdAt: Date; summary: Record<string, number> | null }[];
};

async function requireBrokerage(c: Parameters<Parameters<typeof withAppTx>[2]>[0], actor: Actor) {
  const ctx = await requireContext(c, actor);
  if (ctx.org.type !== "brokerage") throw new IdentityError("not_found");
  if (!hasCapability(ctx.principal, "inventory.update.submit")) throw new IdentityError("forbidden", "inventory.update.submit");
  return ctx;
}

export async function listMyPartnerSources(db: Db, actor: Actor): Promise<PartnerSourceView[]> {
  return withAppTx(db, actor, async (c) => {
    await requireBrokerage(c, actor);
    const { rows } = await c.query(
      `select s.id, s.name, s.authorization_status, app.partner_developer_name(s.org_id) as developer_name,
              coalesce((select json_agg(json_build_object('id', p.id, 'name', p.name) order by p.name)
                          from app.inventory_source_projects sp join app.projects p on p.id = sp.project_id where sp.source_id = s.id), '[]') as projects,
              coalesce((select json_agg(json_build_object('id', b.id, 'projectId', b.options->>'project_id', 'status', b.status, 'rowCount', b.row_count,
                                                          'createdAt', b.created_at, 'summary', b.summary) order by b.created_at desc)
                          from (select * from app.import_batches b where b.source_id = s.id and b.submitted_by_org = app.current_org_id() order by created_at desc limit 20) b), '[]') as submissions
         from app.inventory_sources s where s.partner_org_id = app.current_org_id() and s.authorization_status <> 'revoked' order by s.name`,
    );
    return rows.map((r) => {
      const names = new Map((r.projects as { id: string; name: string }[]).map((p) => [p.id, p.name]));
      return {
        id: r.id, name: r.name, authorization: r.authorization_status, projects: r.projects,
        developerName: r.developer_name ?? "",
        submissions: (r.submissions as any[]).map((b) => ({ id: b.id, projectName: names.get(b.projectId) ?? null, status: b.status, rowCount: b.rowCount, createdAt: new Date(b.createdAt), summary: b.summary })),
      };
    });
  });
}

/**
 * Lines of "unit code, status" for one project. Only availability (unit status) can be proposed; the
 * developer validates the submission, sees any conflicts, and decides whether to apply it.
 */
export async function submitPartnerUpdate(db: Db, actor: Actor, input: { sourceId: unknown; projectId: unknown; lines: unknown; asOf: unknown; note?: unknown }, now = new Date()): Promise<string> {
  const sid = id(input.sourceId);
  const pid = id(input.projectId);
  const note = opt(input.note, 500, "note", true);
  const asOfRaw = typeof input.asOf === "string" ? input.asOf.trim() : "";
  const asOf = asOfRaw ? new Date(asOfRaw) : null;
  if (!asOf || Number.isNaN(asOf.getTime())) throw new IdentityError("invalid_input", "as_of");
  if (asOf.getTime() > now.getTime() + 5 * 60_000) throw new IdentityError("invalid_input", "as_of_future");
  const text = typeof input.lines === "string" ? input.lines : "";
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(",").map((x) => x.trim()));
  if (!rows.length) throw new IdentityError("invalid_input", "lines");
  if (rows.length > 200) throw new IdentityError("invalid_input", "lines_too_many");
  if (rows.some((r) => r.length !== 2 || !r[0] || r[0].length > 40 || !(UNIT_STATUSES as readonly string[]).includes(r[1]!.toLowerCase()))) {
    throw new IdentityError("invalid_input", "lines");
  }
  return withAppTx(db, actor, async (c) => {
    await requireBrokerage(c, actor);
    try {
      const { rows: out } = await c.query<{ id: string }>("select app.submit_partner_update($1, $2, $3, $4, $5, $6) as id", [
        sid, pid, ["code", "status"], JSON.stringify(rows.map((r) => [r[0], r[1]!.toLowerCase()])), asOf, note,
      ]);
      const bid = out[0]!.id;
      await writeAudit(c, { type: "import.partner_submitted", outcome: "success", actorUserId: actor.userId, orgId: actor.orgId, target: { type: "import_batch", id: bid }, metadata: { rows: String(rows.length) } });
      return bid;
    } catch (e) {
      const m = (e as { message?: string }).message ?? "";
      if (["source_not_authorized", "project_not_in_source", "project_not_shared", "rate_limited", "as_of_future", "row_count"].includes(m)) throw new IdentityError("invalid_input", m);
      if (m === "not_found") throw new IdentityError("not_found");
      if (m === "forbidden") throw new IdentityError("forbidden", "inventory.update.submit");
      throw e;
    }
  });
}
