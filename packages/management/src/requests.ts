import { REQUEST_CATEGORIES, REQUEST_PRIORITIES, REQUEST_STATUSES, type RequestCategory, type RequestPriority, type RequestStatus } from "@baytline/core";
import { withAppTx, type Db } from "@baytline/db";
import type { Actor } from "@baytline/identity";
import { audit, can, f, IdentityError, like, mapDbError, requireManagement } from "./guard";

export type RequestRow = {
  id: string;
  title: string;
  category: RequestCategory;
  priority: RequestPriority;
  status: RequestStatus;
  propertyId: string;
  propertyName: string;
  unitId: string | null;
  unitCode: string | null;
  tenantId: string | null;
  /** Tenant name only. Contact details are never returned by this service. */
  tenantName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  reportedAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  updatedAt: Date | null;
};

const SELECT = `
  select r.*, p.name as property_name, u.code as unit_code, t.display_name as tenant_name, a.display_name as assignee_name
    from app.pm_requests r
    join app.pm_properties p on p.id = r.property_id
    left join app.pm_units u on u.id = r.unit_id
    left join app.pm_tenants t on t.id = r.tenant_id
    left join app.users a on a.id = r.assignee_user_id`;

const map = (r: Record<string, any>): RequestRow => ({
  id: r.id,
  title: r.title,
  category: r.category,
  priority: r.priority,
  status: r.status,
  propertyId: r.property_id,
  propertyName: r.property_name,
  unitId: r.unit_id,
  unitCode: r.unit_code,
  tenantId: r.tenant_id,
  tenantName: r.tenant_name,
  assigneeId: r.assignee_user_id,
  assigneeName: r.assignee_name,
  reportedAt: r.reported_at,
  resolvedAt: r.resolved_at,
  closedAt: r.closed_at,
  updatedAt: r.updated_at,
});

export type RequestSearch = { status?: string; priority?: string; category?: string; propertyId?: string; assignee?: string; q?: string };

export async function listRequests(db: Db, actor: Actor, s: RequestSearch = {}): Promise<RequestRow[]> {
  return withAppTx(db, actor, async (c) => {
    await requireManagement(c, actor, "tenant_request.view");
    const where = ["r.org_id = app.current_org_id()"];
    const args: unknown[] = [];
    if (s.status === "open_all") where.push("r.status not in ('resolved','closed')");
    else if (s.status && (REQUEST_STATUSES as readonly string[]).includes(s.status)) where.push(`r.status = $${args.push(s.status)}`);
    if (s.priority && (REQUEST_PRIORITIES as readonly string[]).includes(s.priority)) where.push(`r.priority = $${args.push(s.priority)}`);
    if (s.category && (REQUEST_CATEGORIES as readonly string[]).includes(s.category)) where.push(`r.category = $${args.push(s.category)}`);
    if (s.propertyId) where.push(`r.property_id = $${args.push(f.id(s.propertyId))}`);
    if (s.assignee === "none") where.push("r.assignee_user_id is null");
    else if (s.assignee === "me") where.push("r.assignee_user_id = app.current_user_id()");
    if (s.q?.trim()) {
      const n = args.push(like(s.q));
      where.push(`(r.title ilike $${n} or u.code ilike $${n})`);
    }
    const { rows } = await c.query(
      `${SELECT} where ${where.join(" and ")}
        order by (r.status in ('resolved','closed')), array_position(array['urgent','high','normal','low'], r.priority), r.reported_at desc limit 1000`,
      args,
    );
    return rows.map(map);
  });
}

export type RequestDetail = RequestRow & {
  description: string | null;
  notes: { id: string; body: string; authorName: string | null; at: Date }[];
  workOrders: { id: string; title: string; status: string }[] | null;
  canManage: boolean;
  canCreateWorkOrder: boolean;
  createdByName: string | null;
};

export async function getRequest(db: Db, actor: Actor, requestId: string): Promise<RequestDetail> {
  const rid = f.id(requestId);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireManagement(c, actor, "tenant_request.view");
    const { rows } = await c.query(`${SELECT.replace("from app.pm_requests r", ", cu.display_name as created_by_name from app.pm_requests r left join app.users cu on cu.id = r.created_by")} where r.id = $1 and r.org_id = app.current_org_id()`, [rid]);
    if (!rows[0]) throw new IdentityError("not_found");
    const notes = (await c.query(
      "select n.id::text, n.body, u.display_name, n.created_at from app.pm_request_notes n left join app.users u on u.id = n.author_user_id where n.request_id = $1 order by n.id",
      [rid],
    )).rows.map((n) => ({ id: n.id, body: n.body, authorName: n.display_name, at: n.created_at }));
    const workOrders = can(ctx, "maintenance.view")
      ? (await c.query("select id, title, status from app.pm_work_orders where request_id = $1 order by created_at", [rid])).rows
      : null;
    return {
      ...map(rows[0]),
      description: rows[0].description,
      createdByName: rows[0].created_by_name,
      notes,
      workOrders,
      canManage: can(ctx, "tenant_request.manage"),
      canCreateWorkOrder: can(ctx, "maintenance.manage"),
    };
  });
}

export type RequestInput = {
  propertyId: unknown;
  unitId?: unknown;
  tenantId?: unknown;
  title: unknown;
  description?: unknown;
  category: unknown;
  priority: unknown;
  assigneeId?: unknown;
};

export async function createRequest(db: Db, actor: Actor, input: RequestInput): Promise<string> {
  const v = {
    property_id: f.id(input.propertyId),
    unit_id: input.unitId ? f.id(input.unitId) : null,
    tenant_id: input.tenantId ? f.id(input.tenantId) : null,
    title: f.req(input.title, 160, "title"),
    description: f.opt(input.description, 4000, "description", true),
    category: f.oneOf(input.category, REQUEST_CATEGORIES, "category"),
    priority: f.oneOf(input.priority, REQUEST_PRIORITIES, "priority"),
    assignee: input.assigneeId ? f.id(input.assigneeId) : null,
  };
  return withAppTx(db, actor, async (c) => {
    await requireManagement(c, actor, "tenant_request.manage");
    try {
      await c.query("savepoint s");
      const { rows } = await c.query<{ id: string }>(
        `insert into app.pm_requests (org_id, property_id, unit_id, tenant_id, title, description, category, priority, assignee_user_id, status, created_by)
         values (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, 'open', $9) returning id`,
        [v.property_id, v.unit_id, v.tenant_id, v.title, v.description, v.category, v.priority, v.assignee, actor.userId],
      );
      await audit(c, actor, { type: "request.created", target: { type: "request", id: rows[0]!.id }, metadata: { priority: v.priority, category: v.category } });
      return rows[0]!.id;
    } catch (e) {
      return mapDbError(c, e);
    }
  });
}

export type RequestUpdate = { title: unknown; description?: unknown; category: unknown; priority: unknown; status: unknown; assigneeId?: unknown };

/** Status timestamps follow status: resolved_at / closed_at are set on entry and cleared on reopening. */
export async function updateRequest(db: Db, actor: Actor, requestId: string, input: RequestUpdate): Promise<string[]> {
  const rid = f.id(requestId);
  const v = {
    title: f.req(input.title, 160, "title"),
    description: f.opt(input.description, 4000, "description", true),
    category: f.oneOf(input.category, REQUEST_CATEGORIES, "category"),
    priority: f.oneOf(input.priority, REQUEST_PRIORITIES, "priority"),
    status: f.oneOf(input.status, REQUEST_STATUSES, "status"),
    assignee_user_id: input.assigneeId ? f.id(input.assigneeId) : null,
  };
  return withAppTx(db, actor, async (c) => {
    await requireManagement(c, actor, "tenant_request.manage");
    const { rows } = await c.query("select * from app.pm_requests where id = $1 for update", [rid]);
    const b = rows[0];
    if (!b) throw new IdentityError("not_found");
    const changed = (Object.keys(v) as (keyof typeof v)[]).filter((k) => (b[k] ?? null) !== (v[k] ?? null));
    if (!changed.length) return [];
    try {
      await c.query("savepoint s");
      await c.query(
        `update app.pm_requests set title = $2, description = $3, category = $4, priority = $5, status = $6, assignee_user_id = $7,
                resolved_at = case when $6 in ('resolved','closed') then coalesce(resolved_at, now()) else null end,
                closed_at = case when $6 = 'closed' then coalesce(closed_at, now()) else null end,
                updated_at = now(), updated_by = $8 where id = $1`,
        [rid, v.title, v.description, v.category, v.priority, v.status, v.assignee_user_id, actor.userId],
      );
    } catch (e) {
      return mapDbError(c, e);
    }
    await audit(c, actor, {
      type: "request.updated",
      target: { type: "request", id: rid },
      metadata: { fields: changed.join(","), ...(changed.includes("status") ? { statusFrom: b.status, statusTo: v.status } : {}) },
    });
    return changed;
  });
}

export async function addRequestNote(db: Db, actor: Actor, requestId: string, body: unknown): Promise<void> {
  const rid = f.id(requestId);
  const text = f.req(typeof body === "string" ? body.replace(/\r\n/g, "\n") : body, 2000, "note");
  await withAppTx(db, actor, async (c) => {
    await requireManagement(c, actor, "tenant_request.manage");
    const r = await c.query("select 1 from app.pm_requests where id = $1", [rid]);
    if (!r.rowCount) throw new IdentityError("not_found");
    await c.query("insert into app.pm_request_notes (org_id, request_id, author_user_id, body) values (app.current_org_id(), $1, $2, $3)", [rid, actor.userId, text]);
    await c.query("update app.pm_requests set updated_at = now(), updated_by = $2 where id = $1", [rid, actor.userId]);
    await audit(c, actor, { type: "request.note_added", target: { type: "request", id: rid } });
  });
}
