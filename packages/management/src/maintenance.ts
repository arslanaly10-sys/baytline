import { WORK_ORDER_STATUSES, type WorkOrderStatus } from "@baytline/core";
import { withAppTx, type Db } from "@baytline/db";
import type { Actor } from "@baytline/identity";
import { audit, can, f, IdentityError, like, mapDbError, requireManagement } from "./guard";

/**
 * Work orders record what people did. "Vendor confirmed" and "completed" are separate,
 * explicit actions that store who recorded them and when; nothing is inferred.
 */
export type WorkOrderRow = {
  id: string;
  title: string;
  status: WorkOrderStatus;
  propertyId: string;
  propertyName: string;
  unitId: string | null;
  unitCode: string | null;
  requestId: string | null;
  requestTitle: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  vendorName: string | null;
  vendorConfirmed: boolean;
  scheduledFor: string | null;
  completedAt: Date | null;
  costMinor: string | null;
  costCurrency: string | null;
  createdAt: Date;
};

const SELECT = `
  select w.*, w.scheduled_for::text as sched, w.cost_minor::text as cost, p.name as property_name, u.code as unit_code,
         r.title as request_title, a.display_name as assignee_name, vb.display_name as vendor_confirmed_by_name, cb.display_name as completed_by_name,
         mk.currency as market_currency
    from app.pm_work_orders w
    join app.pm_properties p on p.id = w.property_id
    join app.markets mk on mk.code = p.market
    left join app.pm_units u on u.id = w.unit_id
    left join app.pm_requests r on r.id = w.request_id
    left join app.users a on a.id = w.assignee_user_id
    left join app.users vb on vb.id = w.vendor_confirmed_by
    left join app.users cb on cb.id = w.completed_by`;

const map = (r: Record<string, any>): WorkOrderRow => ({
  id: r.id,
  title: r.title,
  status: r.status,
  propertyId: r.property_id,
  propertyName: r.property_name,
  unitId: r.unit_id,
  unitCode: r.unit_code,
  requestId: r.request_id,
  requestTitle: r.request_title,
  assigneeId: r.assignee_user_id,
  assigneeName: r.assignee_name,
  vendorName: r.vendor_name,
  vendorConfirmed: r.vendor_confirmed,
  scheduledFor: r.sched,
  completedAt: r.completed_at,
  costMinor: r.cost,
  costCurrency: r.cost_currency,
  createdAt: r.created_at,
});

export type WorkOrderSearch = { status?: string; propertyId?: string; assignee?: string; q?: string };

export async function listWorkOrders(db: Db, actor: Actor, s: WorkOrderSearch = {}): Promise<WorkOrderRow[]> {
  return withAppTx(db, actor, async (c) => {
    await requireManagement(c, actor, "maintenance.view");
    const where = ["w.org_id = app.current_org_id()"];
    const args: unknown[] = [];
    if (s.status === "open_all") where.push("w.status not in ('completed','cancelled')");
    else if (s.status && (WORK_ORDER_STATUSES as readonly string[]).includes(s.status)) where.push(`w.status = $${args.push(s.status)}`);
    if (s.propertyId) where.push(`w.property_id = $${args.push(f.id(s.propertyId))}`);
    if (s.assignee === "none") where.push("w.assignee_user_id is null");
    else if (s.assignee === "me") where.push("w.assignee_user_id = app.current_user_id()");
    if (s.q?.trim()) {
      const n = args.push(like(s.q));
      where.push(`(w.title ilike $${n} or w.vendor_name ilike $${n} or u.code ilike $${n})`);
    }
    const { rows } = await c.query(`${SELECT} where ${where.join(" and ")} order by (w.status in ('completed','cancelled')), w.scheduled_for nulls last, w.created_at desc limit 1000`, args);
    return rows.map(map);
  });
}

export type WorkOrderDetail = WorkOrderRow & {
  description: string | null;
  vendorConfirmedAt: Date | null;
  vendorConfirmedByName: string | null;
  completedByName: string | null;
  completionNotes: string | null;
  marketCurrency: string;
  canManage: boolean;
};

export async function getWorkOrder(db: Db, actor: Actor, workOrderId: string): Promise<WorkOrderDetail> {
  const wid = f.id(workOrderId);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireManagement(c, actor, "maintenance.view");
    const { rows } = await c.query(`${SELECT} where w.id = $1 and w.org_id = app.current_org_id()`, [wid]);
    const r = rows[0];
    if (!r) throw new IdentityError("not_found");
    return {
      ...map(r),
      description: r.description,
      vendorConfirmedAt: r.vendor_confirmed_at,
      vendorConfirmedByName: r.vendor_confirmed_by_name,
      completedByName: r.completed_by_name,
      completionNotes: r.completion_notes,
      marketCurrency: r.market_currency,
      canManage: can(ctx, "maintenance.manage"),
    };
  });
}

export type WorkOrderInput = {
  propertyId?: unknown;
  unitId?: unknown;
  requestId?: unknown;
  title: unknown;
  description?: unknown;
  status: unknown;
  assigneeId?: unknown;
  vendorName?: unknown;
  scheduledFor?: unknown;
};

/** "completed" can't be set here; use recordCompletion. */
const EDITABLE: readonly WorkOrderStatus[] = WORK_ORDER_STATUSES.filter((s) => s !== "completed");

function validate(i: WorkOrderInput) {
  const status = f.oneOf(i.status, EDITABLE, "status");
  const scheduled = f.optDate(i.scheduledFor, "scheduled_for");
  if (status === "scheduled" && !scheduled) throw new IdentityError("invalid_input", "scheduled_needs_date");
  return {
    title: f.req(i.title, 160, "title"),
    description: f.opt(i.description, 4000, "description", true),
    status,
    assignee_user_id: i.assigneeId ? f.id(i.assigneeId) : null,
    vendor_name: f.opt(i.vendorName, 160, "vendor_name"),
    scheduled_for: scheduled,
  };
}

/** From a request, the property and unit are taken from the request itself. */
export async function createWorkOrder(db: Db, actor: Actor, input: WorkOrderInput): Promise<string> {
  const v = validate(input);
  return withAppTx(db, actor, async (c) => {
    await requireManagement(c, actor, "maintenance.manage");
    let propertyId: string;
    let unitId: string | null;
    let requestId: string | null = null;
    if (input.requestId) {
      requestId = f.id(input.requestId);
      const { rows } = await c.query("select property_id, unit_id from app.pm_requests where id = $1", [requestId]);
      if (!rows[0]) throw new IdentityError("not_found");
      propertyId = rows[0].property_id;
      unitId = rows[0].unit_id;
    } else {
      propertyId = f.id(input.propertyId);
      unitId = input.unitId ? f.id(input.unitId) : null;
    }
    try {
      await c.query("savepoint s");
      const { rows } = await c.query<{ id: string }>(
        `insert into app.pm_work_orders (org_id, property_id, unit_id, request_id, title, description, status, assignee_user_id, vendor_name, scheduled_for, created_by)
         values (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
        [propertyId, unitId, requestId, v.title, v.description, v.status, v.assignee_user_id, v.vendor_name, v.scheduled_for, actor.userId],
      );
      await audit(c, actor, { type: "work_order.created", target: { type: "work_order", id: rows[0]!.id }, metadata: { fromRequest: Boolean(requestId) } });
      return rows[0]!.id;
    } catch (e) {
      return mapDbError(c, e);
    }
  });
}

export async function updateWorkOrder(db: Db, actor: Actor, workOrderId: string, input: WorkOrderInput): Promise<string[]> {
  const wid = f.id(workOrderId);
  const v = validate(input);
  return withAppTx(db, actor, async (c) => {
    await requireManagement(c, actor, "maintenance.manage");
    const { rows } = await c.query("select *, scheduled_for::text as sched from app.pm_work_orders where id = $1 for update", [wid]);
    const b = rows[0];
    if (!b) throw new IdentityError("not_found");
    if (b.status === "completed") throw new IdentityError("invalid_input", "work_order_completed");
    const prev: Record<string, unknown> = { ...b, scheduled_for: b.sched };
    const changed = (Object.keys(v) as (keyof typeof v)[]).filter((k) => (prev[k] ?? null) !== (v[k] ?? null));
    if (!changed.length) return [];
    // A different vendor means the earlier confirmation no longer applies.
    const vendorChanged = changed.includes("vendor_name");
    try {
      await c.query("savepoint s");
      await c.query(
        `update app.pm_work_orders set title = $2, description = $3, status = $4, assignee_user_id = $5, vendor_name = $6, scheduled_for = $7,
                vendor_confirmed = case when $8 then false else vendor_confirmed end,
                vendor_confirmed_at = case when $8 then null else vendor_confirmed_at end,
                vendor_confirmed_by = case when $8 then null else vendor_confirmed_by end,
                updated_at = now(), updated_by = $9 where id = $1`,
        [wid, v.title, v.description, v.status, v.assignee_user_id, v.vendor_name, v.scheduled_for, vendorChanged, actor.userId],
      );
    } catch (e) {
      return mapDbError(c, e);
    }
    await audit(c, actor, {
      type: "work_order.updated",
      target: { type: "work_order", id: wid },
      metadata: { fields: changed.join(","), ...(changed.includes("status") ? { statusFrom: b.status, statusTo: v.status } : {}) },
    });
    return changed;
  });
}

/** A person records that the named vendor confirmed the job. */
export async function recordVendorConfirmation(db: Db, actor: Actor, workOrderId: string): Promise<void> {
  const wid = f.id(workOrderId);
  await withAppTx(db, actor, async (c) => {
    await requireManagement(c, actor, "maintenance.manage");
    const { rows } = await c.query("select vendor_name, vendor_confirmed, status from app.pm_work_orders where id = $1 for update", [wid]);
    const w = rows[0];
    if (!w) throw new IdentityError("not_found");
    if (!w.vendor_name) throw new IdentityError("invalid_input", "vendor_name_required");
    if (w.status === "completed" || w.status === "cancelled") throw new IdentityError("invalid_input", "work_order_closed");
    if (w.vendor_confirmed) return;
    await c.query("update app.pm_work_orders set vendor_confirmed = true, vendor_confirmed_at = now(), vendor_confirmed_by = $2, updated_at = now(), updated_by = $2 where id = $1", [wid, actor.userId]);
    await audit(c, actor, { type: "work_order.vendor_confirmed", target: { type: "work_order", id: wid } });
  });
}

/** Completion needs notes from the person recording it; cost is optional and stored as recorded. */
export async function recordCompletion(db: Db, actor: Actor, workOrderId: string, input: { notes: unknown; cost?: unknown; costCurrency?: unknown }): Promise<void> {
  const wid = f.id(workOrderId);
  const notes = f.req(typeof input.notes === "string" ? input.notes : "", 2000, "completion_notes");
  await withAppTx(db, actor, async (c) => {
    await requireManagement(c, actor, "maintenance.manage");
    const { rows } = await c.query(
      "select w.status, mk.currency from app.pm_work_orders w join app.pm_properties p on p.id = w.property_id join app.markets mk on mk.code = p.market where w.id = $1 for update of w",
      [wid],
    );
    const w = rows[0];
    if (!w) throw new IdentityError("not_found");
    if (w.status === "completed" || w.status === "cancelled") throw new IdentityError("invalid_input", "work_order_closed");
    const currency = input.costCurrency ? f.currency(input.costCurrency) : w.currency;
    const cost = typeof input.cost === "string" && input.cost.trim() === "0" ? 0n : f.parseMoney(input.cost, currency, "cost");
    await c.query(
      `update app.pm_work_orders set status = 'completed', completed_at = now(), completed_by = $2, completion_notes = $3,
              cost_minor = $4, cost_currency = $5, updated_at = now(), updated_by = $2 where id = $1`,
      [wid, actor.userId, notes, cost === null ? null : cost.toString(), cost === null ? null : currency],
    );
    await audit(c, actor, { type: "work_order.completed", target: { type: "work_order", id: wid }, metadata: { costRecorded: cost !== null } });
  });
}
