import { withAppTx, type Db } from "@baytline/db";
import type { Actor } from "@baytline/identity";
import { requireDeveloper } from "../guard";
import { id } from "../validation";

/**
 * One list of inventory changes across units, projects and imported price / payment-plan drafts, each
 * with its source, time, field and the person who made or confirmed it.
 */
export type InventoryChange = {
  key: string;
  at: Date;
  recordType: "unit" | "project" | "price" | "payment_plan";
  recordId: string;
  label: string;
  projectId: string;
  field: string;
  from: unknown;
  to: unknown;
  sourceId: string | null;
  sourceName: string | null;
  sourceType: string | null;
  batchId: string | null;
  actorName: string | null;
};

export type HistoryFilter = { recordType?: string; sourceId?: string; projectId?: string; batchId?: string; before?: string };

const HISTORY_SQL = `
  select x.*, s.name as source_name, s.source_type, u.display_name as actor_name from (
    select concat('u', h.id) as key, h.at, 'unit' as record_type, h.unit_id as record_id, concat(p.name, ' · ', un.code) as label, un.project_id,
           h.field, h.from_value, h.to_value, h.source_id, h.batch_id, h.actor_user_id
      from app.unit_changes h join app.units un on un.id = h.unit_id join app.projects p on p.id = un.project_id
     where h.org_id = app.current_org_id()
    union all
    select concat('p', h.id), h.at, 'project', h.project_id, p.name, h.project_id, h.field, h.from_value, h.to_value, h.source_id, h.batch_id, h.actor_user_id
      from app.project_changes h join app.projects p on p.id = h.project_id where h.org_id = app.current_org_id()
    union all
    select concat('v', v.id), v.created_at, 'price', v.id, concat(p.name, ' · ', l.name, ' v', v.version), l.project_id, 'draft_version', null, to_jsonb(v.status),
           b.source_id, v.import_batch_id, v.created_by
      from app.price_list_versions v join app.price_lists l on l.id = v.price_list_id join app.projects p on p.id = l.project_id
      join app.import_batches b on b.id = v.import_batch_id where v.org_id = app.current_org_id()
    union all
    select concat('m', v.id), v.created_at, 'payment_plan', v.id, concat(p.name, ' · ', pl.name, ' v', v.version), pl.project_id, 'draft_version', null, to_jsonb(v.status),
           b.source_id, v.import_batch_id, v.created_by
      from app.payment_plan_versions v join app.payment_plans pl on pl.id = v.plan_id join app.projects p on p.id = pl.project_id
      join app.import_batches b on b.id = v.import_batch_id where v.org_id = app.current_org_id()
  ) x
  left join app.inventory_sources s on s.id = x.source_id
  left join app.users u on u.id = x.actor_user_id`;

export async function listInventoryChanges(db: Db, actor: Actor, f: HistoryFilter = {}): Promise<InventoryChange[]> {
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "inventory.view");
    const args: unknown[] = [];
    const cond: string[] = [];
    if (f.sourceId) cond.push(`x.source_id = $${args.push(id(f.sourceId))}`);
    if (f.projectId) cond.push(`x.project_id = $${args.push(id(f.projectId))}`);
    if (f.batchId) cond.push(`x.batch_id = $${args.push(id(f.batchId))}`);
    if (f.recordType && ["unit", "project", "price", "payment_plan"].includes(f.recordType)) cond.push(`x.record_type = $${args.push(f.recordType)}`);
    if (f.before && !Number.isNaN(Date.parse(f.before))) cond.push(`x.at < $${args.push(new Date(f.before))}`);
    const { rows } = await c.query(`${HISTORY_SQL} ${cond.length ? `where ${cond.join(" and ")}` : ""} order by x.at desc, x.key desc limit 200`, args);
    return rows.map((r) => ({
      key: r.key, at: r.at, recordType: r.record_type, recordId: r.record_id, label: r.label, projectId: r.project_id, field: r.field,
      from: r.from_value, to: r.to_value, sourceId: r.source_id, sourceName: r.source_name, sourceType: r.source_type, batchId: r.batch_id, actorName: r.actor_name,
    }));
  });
}
