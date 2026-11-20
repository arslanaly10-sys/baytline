import { isMarketCode, type MarketCode } from "@baytline/core";
import { isUuid, withAppTx, withAuthTx, type Db } from "@baytline/db";
import { IdentityError, writeAudit, type Actor } from "@baytline/identity";
import { requirePlatform } from "./guard";

export const DEMO_ORG_TYPES = ["developer", "brokerage", "property_manager", "other"] as const;
export type DemoOrgType = (typeof DEMO_ORG_TYPES)[number];

export type DemoRequestInput = {
  name: string;
  email: string;
  phone: string;
  company: string;
  market: string;
  orgType: string;
  locale: "en" | "ar";
  consent: boolean;
};

export type DemoField = "name" | "email" | "phone" | "company" | "country" | "role" | "consent";
export type DemoResult = { ok: true } | { ok: false; reason: "invalid"; field: DemoField } | { ok: false; reason: "throttled" };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^\+?[0-9 ()-]{5,32}$/;

export function validateDemoRequest(i: DemoRequestInput): DemoField | null {
  const name = i.name.trim();
  if (name.length < 1 || name.length > 120) return "name";
  if (!EMAIL.test(i.email.trim()) || i.email.trim().length > 254) return "email";
  if (i.phone.trim() && !PHONE.test(i.phone.trim())) return "phone";
  const company = i.company.trim();
  if (company.length < 1 || company.length > 160) return "company";
  if (!isMarketCode(i.market)) return "country";
  if (!(DEMO_ORG_TYPES as readonly string[]).includes(i.orgType)) return "role";
  if (!i.consent) return "consent";
  return null;
}

/** Public: anyone can ask for a demo. Stored for the platform team; the visitor gets no account. */
export async function submitDemoRequest(db: Db, i: DemoRequestInput): Promise<DemoResult> {
  const bad = validateDemoRequest(i);
  if (bad) return { ok: false, reason: "invalid", field: bad };
  const r = await withAuthTx(db, (c) =>
    c.query<{ r: string }>("select app.submit_demo_request($1,$2,$3,$4,$5,$6,$7) as r", [
      i.name, i.email, i.phone, i.company, i.market, i.orgType, i.locale,
    ]),
  );
  return r.rows[0]?.r === "ok" ? { ok: true } : { ok: false, reason: "throttled" };
}

export type DemoRequestRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string;
  market: MarketCode;
  orgType: DemoOrgType;
  locale: "en" | "ar";
  status: "new" | "contacted" | "closed";
  createdAt: Date;
};

/** Platform staff only (enforced in code and by row-level security). Newest first. */
export async function listDemoRequests(db: Db, actor: Actor, limit = 100): Promise<DemoRequestRow[]> {
  return withAppTx(db, actor, async (c) => {
    await requirePlatform(c, actor, "platform.orgs.view");
    const r = await c.query(
      `select id, name, email, phone, company, market, org_type as "orgType", locale, status, created_at as "createdAt"
         from app.demo_requests order by created_at desc limit $1`,
      [Math.min(Math.max(limit, 1), 500)],
    );
    return r.rows as DemoRequestRow[];
  });
}

export const DEMO_STATUSES = ["new", "contacted", "closed"] as const;
export type DemoStatus = (typeof DEMO_STATUSES)[number];

export async function listDemoRequestsByStatus(db: Db, actor: Actor, status?: string): Promise<DemoRequestRow[]> {
  const rows = await listDemoRequests(db, actor, 500);
  return (DEMO_STATUSES as readonly string[]).includes(status ?? "") ? rows.filter((r) => r.status === status) : rows;
}

/** Platform admins only. Changes the follow-up status; the submitted details never change. */
export async function setDemoRequestStatus(db: Db, actor: Actor, id: string, status: string): Promise<void> {
  if (!(DEMO_STATUSES as readonly string[]).includes(status)) throw new IdentityError("invalid_input");
  await withAppTx(db, actor, async (c) => {
    await requirePlatform(c, actor, "platform.orgs.manage");
    if (!isUuid(id)) throw new IdentityError("not_found");
    const r = await c.query<{ old: string }>(
      `update app.demo_requests d set status = $2, updated_at = now(), updated_by = $3
         from (select id, status as old from app.demo_requests where id = $1 for update) o
        where d.id = o.id returning o.old`,
      [id, status, actor.userId],
    );
    if (r.rowCount === 0) throw new IdentityError("not_found");
    await writeAudit(c, {
      type: "demo_request.status_changed",
      outcome: "success",
      actorUserId: actor.userId,
      orgId: actor.orgId,
      target: { type: "demo_request", id },
      metadata: { from: r.rows[0]!.old, to: status },
    });
  });
}
