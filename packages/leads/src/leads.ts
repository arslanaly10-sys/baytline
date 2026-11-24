import {
  can as canOn,
  LEAD_FINANCING,
  LEAD_STATUSES,
  LEAD_TIMELINES,
  PROPERTY_TYPES,
  SCORE_BANDS,
  scoreLead,
  type LeadFinancing,
  type LeadScore,
  type LeadStatus,
  type LeadTimeline,
  type PropertyType,
  type ScoreBand,
} from "@baytline/core";
import { withAppTx, type Client, type Db } from "@baytline/db";
import type { Actor, OrgContext } from "@baytline/identity";
import { audit, can, f, guarded, IdentityError, like, requireLeadOrg, validPhone } from "./guard";

/**
 * Leads: people interested in buying, captured from customer enquiries and appointment requests routed
 * to this organization, or entered by staff. Contact details come only from the customer's own request
 * (with the consent they gave) or from staff who confirm consent. Every change is in the lead's timeline.
 */
export type LeadSummary = {
  id: string; contactName: string; source: string; status: LeadStatus; assigneeId: string | null; assigneeName: string | null;
  interest: string | null; score: LeadScore; lastActivityAt: Date; createdAt: Date;
};

const SUMMARY_SQL = `
  select l.*, au.display_name as assignee_name, ou.display_name as override_name,
         (select count(*)::int from app.viewings v where v.lead_id = l.id and v.status = 'completed') as completed_viewings,
         (select count(*)::int from app.viewings v where v.lead_id = l.id and v.status = 'scheduled' and v.scheduled_for > now()) as upcoming_viewings
    from app.leads l
    left join app.users au on au.id = l.assignee_user_id
    left join app.users ou on ou.id = l.override_by`;

export function scoreRow(r: Record<string, any>, now = new Date()): LeadScore {
  return scoreLead(
    {
      hasPhone: Boolean(r.contact_phone),
      budgetStated: r.budget_max_minor !== null || r.budget_min_minor !== null,
      timeline: r.timeline,
      financing: r.financing,
      specificRequirements: (r.property_types?.length ?? 0) > 0 || r.bedrooms_min !== null,
      requestedAppointment: r.source === "appointment" || r.appointment_id !== null,
      completedViewings: r.completed_viewings ?? 0,
      upcomingViewings: r.upcoming_viewings ?? 0,
      lastActivityAt: r.last_activity_at,
    },
    r.override_band ? { band: r.override_band, reason: r.override_reason, byName: r.override_name ?? null, at: r.override_at } : null,
    now,
  );
}

function summary(r: Record<string, any>, now: Date): LeadSummary {
  return {
    id: r.id, contactName: r.contact_name, source: r.source, status: r.status, assigneeId: r.assignee_user_id, assigneeName: r.assignee_name,
    interest: r.interest, score: scoreRow(r, now), lastActivityAt: r.last_activity_at, createdAt: r.created_at,
  };
}

async function event(c: Client, actor: Actor, leadId: string, kind: string, detail: Record<string, unknown> = {}) {
  await c.query("insert into app.lead_events (org_id, lead_id, actor_user_id, kind, detail) values (app.current_org_id(), $1, $2, $3, $4)", [leadId, actor.userId, kind, JSON.stringify(detail)]);
  await c.query("update app.leads set last_activity_at = now() where id = $1", [leadId]);
}
export { event as leadEvent };

/** Whether the actor sees all the organization's leads, or only those assigned to them. */
export function seesAllLeads(ctx: OrgContext) {
  return canOn(ctx.principal, "lead.view", { ownerOrgId: ctx.org.id });
}

// ---------------------------------------------------------------- capture

/** Turns a customer enquiry or appointment request routed to this organization into a lead. Idempotent. */
export async function captureLead(db: Db, actor: Actor, from: { enquiryId?: string; appointmentId?: string }): Promise<{ id: string; created: boolean }> {
  return withAppTx(db, actor, async (c) => {
    await requireLeadOrg(c, actor, "lead.manage");
    return captureOne(c, actor, from);
  });
}

async function captureOne(c: Client, actor: Actor, from: { enquiryId?: string; appointmentId?: string }) {
  const isEnquiry = Boolean(from.enquiryId);
  const rid = f.id(isEnquiry ? from.enquiryId : from.appointmentId);
  const existing = await c.query<{ id: string }>(`select id from app.leads where org_id = app.current_org_id() and ${isEnquiry ? "enquiry_id" : "appointment_id"} = $1`, [rid]);
  if (existing.rows[0]) return { id: existing.rows[0].id, created: false };
  const table = isEnquiry ? "app.customer_enquiries" : "app.appointment_requests";
  const { rows } = await c.query(`select * from ${table} where id = $1 and routed_org_id = app.current_org_id()`, [rid]);
  const r = rows[0];
  if (!r) throw new IdentityError("not_found");
  // The same customer may have both an enquiry and an appointment: link the second request to the first lead.
  const same = await c.query<{ id: string }>(
    "select id from app.leads where org_id = app.current_org_id() and lower(contact_email) = lower($1) and status not in ('won','lost','archived') order by created_at desc limit 1",
    [r.contact_email],
  );
  if (same.rows[0]) {
    await c.query(`update app.leads set ${isEnquiry ? "enquiry_id" : "appointment_id"} = coalesce(${isEnquiry ? "enquiry_id" : "appointment_id"}, $2) where id = $1`, [same.rows[0].id, rid]);
    await event(c, actor, same.rows[0].id, "note", { linked: isEnquiry ? "enquiry" : "appointment", title: r.listing_title });
    return { id: same.rows[0].id, created: false };
  }
  const ins = await guarded(c, () => c.query<{ id: string }>(
    `insert into app.leads (org_id, source, enquiry_id, appointment_id, contact_name, contact_email, contact_phone, preferred_contact, locale, consent_at, interest, created_by)
     values (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [isEnquiry ? "enquiry" : "appointment", isEnquiry ? rid : null, isEnquiry ? null : rid, r.contact_name, r.contact_email, r.contact_phone, r.preferred_contact, r.locale, r.consent_at, r.listing_title, actor.userId],
  ));
  const id = ins.rows[0]!.id;
  await event(c, actor, id, "created", { source: isEnquiry ? "enquiry" : "appointment", title: r.listing_title });
  await audit(c, actor, { type: "lead.captured", target: { type: "lead", id }, metadata: { source: isEnquiry ? "enquiry" : "appointment" } });
  return { id, created: true };
}

/** Captures every open request that isn't a lead yet. */
export async function captureAllNew(db: Db, actor: Actor): Promise<number> {
  return withAppTx(db, actor, async (c) => {
    await requireLeadOrg(c, actor, "lead.manage");
    const { rows: eq } = await c.query<{ id: string }>(
      "select e.id from app.customer_enquiries e where e.routed_org_id = app.current_org_id() and e.status <> 'closed' and not exists (select 1 from app.leads l where l.org_id = e.routed_org_id and l.enquiry_id = e.id) order by e.created_at limit 200");
    const { rows: ap } = await c.query<{ id: string }>(
      "select a.id from app.appointment_requests a where a.routed_org_id = app.current_org_id() and a.status in ('pending','confirmed') and not exists (select 1 from app.leads l where l.org_id = a.routed_org_id and l.appointment_id = a.id) order by a.created_at limit 200");
    let n = 0;
    for (const r of eq) if ((await captureOne(c, actor, { enquiryId: r.id })).created) n++;
    for (const r of ap) if ((await captureOne(c, actor, { appointmentId: r.id })).created) n++;
    return n;
  });
}

/** Staff enter a lead themselves, confirming the person agreed to be contacted. */
export async function createLead(db: Db, actor: Actor, i: { name: unknown; email?: unknown; phone?: unknown; preferredContact?: unknown; interest?: unknown; consent: unknown }): Promise<string> {
  const name = f.req(i.name, 120, "name");
  const email = typeof i.email === "string" && i.email.trim() ? i.email.trim().toLowerCase() : null;
  if (email && (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254)) throw new IdentityError("invalid_input", "email");
  const phone = validPhone(i.phone, false);
  if (!email && !phone) throw new IdentityError("invalid_input", "email_or_phone");
  if (i.consent !== true && i.consent !== "on") throw new IdentityError("invalid_input", "consent");
  const preferred = i.preferredContact ? f.oneOf(i.preferredContact, ["email", "phone", "whatsapp"] as const, "preferred_contact") : email ? "email" : "phone";
  const interest = f.opt(i.interest, 300, "interest");
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireLeadOrg(c, actor, "lead.manage");
    // Someone who only sees their own leads gets the new lead assigned to them.
    const assignee = seesAllLeads(ctx) ? null : actor.userId;
    const { rows } = await c.query<{ id: string }>(
      `insert into app.leads (org_id, source, contact_name, contact_email, contact_phone, preferred_contact, consent_at, interest, assignee_user_id, created_by)
       values (app.current_org_id(), 'manual', $1, $2, $3, $4, now(), $5, $6, $7) returning id`,
      [name, email, phone, preferred, interest, assignee, actor.userId],
    );
    const id = rows[0]!.id;
    await event(c, actor, id, "created", { source: "manual", consent: "confirmed_by_staff" });
    await audit(c, actor, { type: "lead.created", target: { type: "lead", id } });
    return id;
  });
}

// ---------------------------------------------------------------- read

export type LeadFilter = { status?: string; band?: string; assignee?: string; q?: string };

export async function listLeads(db: Db, actor: Actor, filter: LeadFilter = {}, now = new Date()): Promise<{ leads: LeadSummary[]; seesAll: boolean; canManage: boolean; canAssign: boolean }> {
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireLeadOrg(c, actor, "lead.view");
    const where = ["l.org_id = app.current_org_id()"];
    const args: unknown[] = [];
    if (filter.status === "open" || !filter.status) where.push("l.status not in ('won','lost','archived')");
    else if ((LEAD_STATUSES as readonly string[]).includes(filter.status)) where.push(`l.status = $${args.push(filter.status)}`);
    if (filter.assignee === "me") where.push(`l.assignee_user_id = $${args.push(actor.userId)}`);
    else if (filter.assignee === "none") where.push("l.assignee_user_id is null");
    if (filter.q?.trim()) where.push(`(l.contact_name ilike $${args.push(like(filter.q))} or l.interest ilike $${args.length})`);
    const { rows } = await c.query(`${SUMMARY_SQL} where ${where.join(" and ")} order by l.last_activity_at desc limit 500`, args);
    let leads = rows.map((r) => summary(r, now));
    if (filter.band && (SCORE_BANDS as readonly string[]).includes(filter.band)) leads = leads.filter((l) => l.score.band === filter.band);
    // Hot first, then most recent activity.
    const rank: Record<ScoreBand, number> = { hot: 0, warm: 1, cold: 2 };
    leads.sort((a, b) => rank[a.score.band] - rank[b.score.band] || b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
    return { leads, seesAll: seesAllLeads(ctx), canManage: can(ctx, "lead.manage"), canAssign: can(ctx, "lead.assign") };
  });
}

export type LeadEvent = { id: string; at: Date; kind: string; detail: Record<string, unknown>; actorName: string | null };
export type LeadDetail = LeadSummary & {
  contactEmail: string | null; contactPhone: string | null; preferredContact: string | null; locale: string | null; consentAt: Date;
  enquiryId: string | null; appointmentId: string | null; lostReason: string | null;
  requirements: { budgetMinMinor: string | null; budgetMaxMinor: string | null; currency: string | null; propertyTypes: PropertyType[]; bedroomsMin: number | null; city: string | null; timeline: LeadTimeline; financing: LeadFinancing; note: string | null };
  events: LeadEvent[];
  members: { id: string; name: string }[];
  orgType: "developer" | "brokerage";
  orgCurrency: string;
  can: { manage: boolean; assign: boolean; register: boolean; deal: boolean; viewing: boolean };
};

export async function getLead(db: Db, actor: Actor, leadId: string, now = new Date()): Promise<LeadDetail> {
  const id = f.id(leadId);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireLeadOrg(c, actor, "lead.view");
    const { rows } = await c.query(`${SUMMARY_SQL} where l.id = $1 and l.org_id = app.current_org_id()`, [id]);
    const r = rows[0];
    if (!r) throw new IdentityError("not_found");
    const { rows: ev } = await c.query(
      "select e.id::text, e.at, e.kind, e.detail, u.display_name from app.lead_events e left join app.users u on u.id = e.actor_user_id where e.lead_id = $1 order by e.id desc limit 200",
      [id],
    );
    const { rows: members } = await c.query(
      `select u.id, u.display_name from app.memberships m join app.users u on u.id = m.user_id
        where m.org_id = app.current_org_id() and m.status = 'active' order by u.display_name`,
    );
    const { rows: cur } = await c.query<{ currency: string }>("select mk.currency from app.organizations o join app.markets mk on mk.code = o.market where o.id = app.current_org_id()");
    return {
      ...summary(r, now),
      contactEmail: r.contact_email, contactPhone: r.contact_phone, preferredContact: r.preferred_contact, locale: r.locale, consentAt: r.consent_at,
      enquiryId: r.enquiry_id, appointmentId: r.appointment_id, lostReason: r.lost_reason,
      requirements: {
        budgetMinMinor: r.budget_min_minor?.toString() ?? null, budgetMaxMinor: r.budget_max_minor?.toString() ?? null, currency: r.currency, propertyTypes: r.property_types,
        bedroomsMin: r.bedrooms_min, city: r.city, timeline: r.timeline, financing: r.financing, note: r.requirements_note,
      },
      events: ev.map((e) => ({ id: e.id, at: e.at, kind: e.kind, detail: e.detail, actorName: e.display_name })),
      members: can(ctx, "lead.assign") ? members.map((m) => ({ id: m.id, name: m.display_name })) : [],
      orgType: ctx.org.type as "developer" | "brokerage",
      orgCurrency: cur[0]?.currency ?? "AED",
      can: {
        manage: can(ctx, "lead.manage"), assign: can(ctx, "lead.assign"), register: ctx.org.type === "brokerage" && can(ctx, "client_registration.submit"),
        deal: can(ctx, "deal.manage"), viewing: can(ctx, "viewing.manage"),
      },
    };
  });
}

// ---------------------------------------------------------------- changes

export type RequirementsInput = {
  budgetMin?: unknown; budgetMax?: unknown; currency?: unknown; propertyTypes?: unknown[]; bedroomsMin?: unknown; city?: unknown;
  timeline?: unknown; financing?: unknown; note?: unknown;
};

/** The customer's stated requirements. Amounts are as the customer said; nothing is calculated from them. */
export async function updateRequirements(db: Db, actor: Actor, leadId: string, i: RequirementsInput): Promise<string[]> {
  const id = f.id(leadId);
  const types = [...new Set((i.propertyTypes ?? []).map(String))];
  if (types.some((t) => !(PROPERTY_TYPES as readonly string[]).includes(t))) throw new IdentityError("invalid_input", "property_types");
  const timeline = i.timeline ? f.oneOf(i.timeline, LEAD_TIMELINES, "timeline") : "unknown";
  const financing = i.financing ? f.oneOf(i.financing, LEAD_FINANCING, "financing") : "unknown";
  const bedrooms = f.optInt(i.bedroomsMin, 0, 20, "bedrooms_min");
  const city = f.opt(i.city, 80, "city");
  const note = f.opt(i.note, 1000, "requirements_note", true);
  return withAppTx(db, actor, async (c) => {
    await requireLeadOrg(c, actor, "lead.manage");
    const { rows } = await c.query("select * from app.leads where id = $1 and org_id = app.current_org_id() for update", [id]);
    const before = rows[0];
    if (!before) throw new IdentityError("not_found");
    const hasBudget = (typeof i.budgetMin === "string" && i.budgetMin.trim()) || (typeof i.budgetMax === "string" && i.budgetMax.trim());
    const currency = hasBudget ? f.currency(i.currency) : null;
    const min = currency ? f.parseMoney(i.budgetMin, currency, "budget_min") : null;
    const max = currency ? f.parseMoney(i.budgetMax, currency, "budget_max") : null;
    if (min !== null && max !== null && min > max) throw new IdentityError("invalid_input", "budget_max");
    const next: Record<string, unknown> = {
      budget_min_minor: min?.toString() ?? null, budget_max_minor: max?.toString() ?? null, currency, property_types: types, bedrooms_min: bedrooms, city, timeline, financing, requirements_note: note,
    };
    const prev: Record<string, unknown> = { ...before, budget_min_minor: before.budget_min_minor?.toString() ?? null, budget_max_minor: before.budget_max_minor?.toString() ?? null };
    const changed = Object.keys(next).filter((k) => JSON.stringify(prev[k] ?? null) !== JSON.stringify(next[k] ?? null));
    if (!changed.length) return [];
    await c.query(
      `update app.leads set budget_min_minor = $2, budget_max_minor = $3, currency = $4, property_types = $5, bedrooms_min = $6, city = $7, timeline = $8, financing = $9,
              requirements_note = $10, updated_at = now(), updated_by = $11 where id = $1`,
      [id, next.budget_min_minor, next.budget_max_minor, currency, types, bedrooms, city, timeline, financing, note, actor.userId],
    );
    await event(c, actor, id, "requirements", { fields: changed });
    await audit(c, actor, { type: "lead.updated", target: { type: "lead", id }, metadata: { fields: changed.join(",") } });
    return changed;
  });
}

export async function setLeadStatus(db: Db, actor: Actor, leadId: string, status: unknown, lostReason?: unknown): Promise<void> {
  const id = f.id(leadId);
  const st = f.oneOf(status, LEAD_STATUSES, "status");
  const reason = st === "lost" ? f.req(lostReason, 300, "lost_reason") : null;
  await withAppTx(db, actor, async (c) => {
    await requireLeadOrg(c, actor, "lead.manage");
    const { rows } = await c.query("select status from app.leads where id = $1 and org_id = app.current_org_id() for update", [id]);
    if (!rows[0]) throw new IdentityError("not_found");
    if (rows[0].status === st) return;
    await c.query("update app.leads set status = $2, lost_reason = $3, updated_at = now(), updated_by = $4 where id = $1", [id, st, reason, actor.userId]);
    await event(c, actor, id, "status", { from: rows[0].status, to: st, reason });
    await audit(c, actor, { type: "lead.updated", target: { type: "lead", id }, metadata: { status: st } });
  });
}

export async function assignLead(db: Db, actor: Actor, leadId: string, userId: unknown): Promise<void> {
  const id = f.id(leadId);
  const assignee = typeof userId === "string" && userId ? f.id(userId) : null;
  await withAppTx(db, actor, async (c) => {
    await requireLeadOrg(c, actor, "lead.assign");
    const { rows } = await c.query("select assignee_user_id from app.leads where id = $1 and org_id = app.current_org_id() for update", [id]);
    if (!rows[0]) throw new IdentityError("not_found");
    if (rows[0].assignee_user_id === assignee) return;
    await guarded(c, () => c.query("update app.leads set assignee_user_id = $2, updated_at = now(), updated_by = $3 where id = $1", [id, assignee, actor.userId]));
    await event(c, actor, id, "assigned", { to: assignee });
    await audit(c, actor, { type: "lead.assigned", target: { type: "lead", id } });
  });
}

/** A person overrides the band. The reason is required and kept; clearing the override is recorded too. */
export async function overrideScore(db: Db, actor: Actor, leadId: string, band: unknown, reason: unknown): Promise<void> {
  const id = f.id(leadId);
  const clear = band === "" || band == null;
  const b = clear ? null : f.oneOf(band, SCORE_BANDS, "band");
  const why = clear ? null : f.req(reason, 300, "override_reason");
  if (why !== null && why.length < 3) throw new IdentityError("invalid_input", "override_reason");
  await withAppTx(db, actor, async (c) => {
    await requireLeadOrg(c, actor, "lead.manage");
    const { rows } = await c.query("select override_band from app.leads where id = $1 and org_id = app.current_org_id() for update", [id]);
    if (!rows[0]) throw new IdentityError("not_found");
    await c.query(
      "update app.leads set override_band = $2, override_reason = $3, override_by = $4, override_at = case when $2::text is null then null else now() end, updated_at = now(), updated_by = $5 where id = $1",
      [id, b, why, b ? actor.userId : null, actor.userId],
    );
    await event(c, actor, id, "score_override", { from: rows[0].override_band, to: b, reason: why });
    await audit(c, actor, { type: "lead.score_overridden", target: { type: "lead", id }, metadata: { band: b ?? "cleared" } });
  });
}

export async function addLeadNote(db: Db, actor: Actor, leadId: string, note: unknown): Promise<void> {
  const id = f.id(leadId);
  const text = f.req(note, 1000, "note");
  await withAppTx(db, actor, async (c) => {
    await requireLeadOrg(c, actor, "lead.manage");
    const { rowCount } = await c.query("select 1 from app.leads where id = $1 and org_id = app.current_org_id()", [id]);
    if (!rowCount) throw new IdentityError("not_found");
    await event(c, actor, id, "note", { text });
  });
}
