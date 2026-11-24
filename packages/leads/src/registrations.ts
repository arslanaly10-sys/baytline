import { createHash } from "node:crypto";
import { withAppTx, type Db } from "@baytline/db";
import type { Actor } from "@baytline/identity";
import { audit, can, f, guarded, IdentityError, requireOrg } from "./guard";
import { leadEvent } from "./leads";

/**
 * Client registration: a brokerage tells a developer "this client is ours for this project". If the
 * developer approves, the brokerage is protected for a set number of days: a deal for that client on
 * that project in that window backs a commission claim. Duplicates are detected across brokerages by
 * hashes of the client's email and phone, so no brokerage sees another's clients.
 */
export const DEFAULT_PROTECTION_DAYS = 90;

const norm = { email: (v: string) => v.trim().toLowerCase(), phone: (v: string) => v.replace(/\D/g, "").replace(/^00/, "").slice(-9) };
const hash = (kind: string, v: string) => createHash("sha256").update(`baytline:client:${kind}:${v}`).digest("hex");
export function maskEmail(e: string): string {
  const [user, domain] = e.split("@");
  return user && domain ? `${user[0]}***@${domain}` : "***";
}
export const maskPhone = (p: string) => `••• ${p.replace(/\D/g, "").slice(-4)}`;

export type RegistrationState = "submitted" | "protected" | "expired" | "rejected" | "withdrawn";
export type Registration = {
  id: string; projectId: string; projectName: string; clientName: string; emailMasked: string | null; phoneMasked: string | null; note: string | null;
  state: RegistrationState; protectionDays: number | null; protectedFrom: Date | null; protectedUntil: Date | null; decisionNote: string | null;
  submittedAt: Date; submittedByName: string | null; decidedByName: string | null; leadId: string; brokerageName: string; developerName: string | null;
  /** Developer view only: other registrations of the same client for this project (any brokerage). */
  possibleDuplicates: { id: string; brokerageName: string; state: RegistrationState }[];
};

function stateOf(r: Record<string, any>, now: Date): RegistrationState {
  if (r.status === "approved") return r.protected_until > now ? "protected" : "expired";
  return r.status;
}

const SELECT = `
  select r.*, p.name as project_name, case when r.brokerage_org_id = app.current_org_id() then app.sharing_developer_name(r.developer_org_id) end as developer_name,
         su.display_name as submitted_name, du.display_name as decided_name
    from app.client_registrations r join app.projects p on p.id = r.project_id
    left join app.users su on su.id = r.submitted_by left join app.users du on du.id = r.decided_by`;

/** The brokerage registers the client of one of its leads for a project shared with it. */
export async function submitRegistration(db: Db, actor: Actor, leadId: string, projectId: string, note?: unknown): Promise<string> {
  const lid = f.id(leadId);
  const pid = f.id(projectId);
  const n = f.opt(note, 500, "note", true);
  return withAppTx(db, actor, async (c) => {
    await requireOrg(c, actor, ["brokerage"], "client_registration.submit");
    const { rows } = await c.query("select contact_email, contact_phone from app.leads where id = $1 and org_id = app.current_org_id()", [lid]);
    const lead = rows[0];
    if (!lead) throw new IdentityError("not_found");
    const email = lead.contact_email ? norm.email(lead.contact_email) : null;
    const phone = lead.contact_phone ? norm.phone(lead.contact_phone) : null;
    const { rows: out } = await guarded(c, () => c.query<{ id: string }>("select app.submit_client_registration($1, $2, $3, $4, $5, $6, $7) as id", [
      lid, pid, email ? hash("email", email) : null, phone && phone.length >= 6 ? hash("phone", phone) : null,
      email ? maskEmail(email) : null, lead.contact_phone ? maskPhone(lead.contact_phone) : null, n,
    ]));
    const id = out[0]!.id;
    await leadEvent(c, actor, lid, "registration", { project: pid, status: "submitted" });
    await audit(c, actor, { type: "registration.submitted", target: { type: "client_registration", id } });
    return id;
  });
}

export async function withdrawRegistration(db: Db, actor: Actor, registrationId: string): Promise<void> {
  const id = f.id(registrationId);
  await withAppTx(db, actor, async (c) => {
    await requireOrg(c, actor, ["brokerage"], "client_registration.submit");
    await guarded(c, () => c.query("select app.withdraw_client_registration($1)", [id]));
    await audit(c, actor, { type: "registration.withdrawn", target: { type: "client_registration", id } });
  });
}

/** Brokerage: its registrations. Developer: registrations for its projects, with possible duplicates. */
export async function listRegistrations(db: Db, actor: Actor, f2: { state?: string; leadId?: string } = {}, now = new Date()): Promise<{ items: Registration[]; side: "brokerage" | "developer"; canReview: boolean; canSubmit: boolean }> {
  return withAppTx(db, actor, async (c) => {
    // Both sides need lead visibility in their own organization to see registrations at all.
    const ctx = await requireOrg(c, actor, ["brokerage", "developer"], "lead.view");
    const side = ctx.org.type === "developer" ? "developer" : "brokerage";
    if (side === "developer" && !can(ctx, "client_registration.review")) throw new IdentityError("forbidden", "client_registration.review");
    const args: unknown[] = [];
    const where = [side === "developer" ? "r.developer_org_id = app.current_org_id()" : "r.brokerage_org_id = app.current_org_id()"];
    if (f2.leadId) where.push(`r.lead_id = $${args.push(f.id(f2.leadId))}`);
    const { rows } = await c.query(`${SELECT} where ${where.join(" and ")} order by (r.status = 'submitted') desc, r.submitted_at desc limit 300`, args);
    // Brokerage names: the developer sees its partners' names through the brokerage directory.
    const { rows: names } = side === "developer" ? await c.query<{ id: string; name: string }>("select id, name from app.brokerage_directory()") : { rows: [] as { id: string; name: string }[] };
    const nameOf = (orgId: string) => (side === "developer" ? names.find((x) => x.id === orgId)?.name ?? "" : ctx.org.name);
    let items = rows.map((r) => ({
      id: r.id, projectId: r.project_id, projectName: r.project_name, clientName: r.client_name, emailMasked: r.email_masked, phoneMasked: r.phone_masked, note: r.note,
      state: stateOf(r, now), protectionDays: r.protection_days, protectedFrom: r.protected_from, protectedUntil: r.protected_until, decisionNote: r.decision_note,
      submittedAt: r.submitted_at, submittedByName: r.submitted_name, decidedByName: r.decided_name, leadId: r.lead_id, brokerageName: nameOf(r.brokerage_org_id), developerName: r.developer_name,
      possibleDuplicates: side === "developer"
        ? rows.filter((o) => o.id !== r.id && o.project_id === r.project_id && ((r.email_hash && o.email_hash === r.email_hash) || (r.phone_hash && o.phone_hash === r.phone_hash)))
            .map((o) => ({ id: o.id, brokerageName: nameOf(o.brokerage_org_id), state: stateOf(o, now) }))
        : [],
    }));
    if (f2.state) items = items.filter((x) => x.state === f2.state);
    return { items, side, canReview: side === "developer" && can(ctx, "client_registration.review"), canSubmit: side === "brokerage" && can(ctx, "client_registration.submit") };
  });
}

/** The developer approves (starting protection now) or rejects with a reason. */
export async function decideRegistration(db: Db, actor: Actor, registrationId: string, decision: unknown, protectionDays?: unknown, note?: unknown): Promise<void> {
  const id = f.id(registrationId);
  const d = f.oneOf(decision, ["approve", "reject"] as const, "decision");
  const days = d === "approve" ? f.optInt(protectionDays, 1, 365, "protection_days") ?? DEFAULT_PROTECTION_DAYS : null;
  const n = f.opt(note, 500, "decision_note", true);
  if (d === "reject" && !n) throw new IdentityError("invalid_input", "decision_note_required");
  await withAppTx(db, actor, async (c) => {
    await requireOrg(c, actor, ["developer"], "client_registration.review");
    await guarded(c, () => c.query("select app.decide_client_registration($1, $2, $3, $4)", [id, d, days, n]));
    await audit(c, actor, { type: "registration.decided", target: { type: "client_registration", id }, metadata: { decision: d, days: String(days ?? "") } });
  });
}
