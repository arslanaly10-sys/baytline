import { auditScope, isAuditEventType, type AuditEventType, type AuditOutcome } from "@baytline/core";
import { isUuid, withAppTx, type Client, type Db } from "@baytline/db";
import { requireContext, type Actor } from "./context";
import { IdentityError } from "./errors";

export type AuditInput = {
  type: AuditEventType;
  outcome: AuditOutcome;
  actorUserId: string | null;
  actorKind?: "human" | "system";
  orgId?: string | null;
  target?: { type: string; id: string };
  /** Small, non-sensitive facts only: role names, reasons, paths. Never secrets or contact details. */
  metadata?: Record<string, string | number | boolean | null>;
};

const FORBIDDEN_KEYS = /pass|token|secret|hash|cookie|email|phone/i;

function safeMetadata(m: AuditInput["metadata"]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m ?? {})) {
    if (FORBIDDEN_KEYS.test(k)) throw new Error(`audit metadata key "${k}" is not allowed`);
    out[k] = typeof v === "string" ? v.slice(0, 200) : v;
  }
  return out;
}

/** Writes one event using the caller's open transaction (app or auth role). */
export async function writeAudit(c: Client, e: AuditInput): Promise<void> {
  await c.query(
    `insert into app.audit_events (actor_user_id, actor_kind, org_id, event_type, outcome, target_type, target_id, metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      e.actorUserId,
      e.actorKind ?? "human",
      e.orgId && isUuid(e.orgId) ? e.orgId : null,
      e.type,
      e.outcome,
      e.target?.type ?? null,
      e.target?.id ?? null,
      JSON.stringify(safeMetadata(e.metadata)),
    ],
  );
}

/**
 * Records an access denial for a signed-in user (e.g. opening an org they don't
 * belong to). The attempted org is stored only when it is a well-formed ID, so that
 * org's admins can see probing attempts.
 */
export async function recordDenied(
  db: Db,
  userId: string,
  d: { orgId?: string; resource: string; reason: string },
): Promise<void> {
  await withAppTx(db, { userId }, (c) =>
    writeAudit(c, {
      type: "access.denied",
      outcome: "denied",
      actorUserId: userId,
      orgId: d.orgId && isUuid(d.orgId) ? d.orgId : null,
      target: { type: "resource", id: d.resource.slice(0, 200) },
      metadata: { reason: d.reason, ...(d.orgId && !isUuid(d.orgId) ? { malformedOrgId: true } : {}) },
    }),
  );
}

export type AuditRow = {
  id: string;
  occurredAt: Date;
  eventType: string;
  outcome: AuditOutcome;
  actorUserId: string | null;
  actorName: string | null;
  actorKind: string;
  orgId: string | null;
  orgName: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
};

export type AuditQuery = {
  limit?: number;
  beforeId?: string;
  eventType?: string;
  outcome?: AuditOutcome;
  /** Matches the actor's name or email, among actors the viewer may see. */
  actor?: string;
  /** Platform scope only: one organization's events. */
  orgId?: string;
  /** Calendar dates (YYYY-MM-DD), inclusive, interpreted in timeZone. */
  from?: string;
  to?: string;
  timeZone?: string;
};

const SUPPORTED_ZONES = new Set(Intl.supportedValuesOf("timeZone"));

function isDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

/**
 * Lists audit history the actor may see: the active org's events, or every event
 * for platform audit roles. Enforced here (permission) and in RLS (rows).
 */
export async function listAuditEvents(db: Db, actor: Actor, q: AuditQuery = {}): Promise<{ scope: "platform" | "org"; rows: AuditRow[] }> {
  return withAppTx(db, actor, async (c) => {
    const { principal } = await requireContext(c, actor);
    const scope = auditScope(principal, actor.orgId);
    if (!scope) throw new IdentityError("forbidden", "audit.view");

    const where: string[] = [];
    const args: unknown[] = [];
    if (scope === "org") where.push(`e.org_id = $${args.push(actor.orgId)}`);
    if (q.beforeId && /^\d+$/.test(q.beforeId)) where.push(`e.id < $${args.push(q.beforeId)}`);
    if (q.eventType && isAuditEventType(q.eventType)) where.push(`e.event_type = $${args.push(q.eventType)}`);
    if (q.outcome && ["success", "failure", "denied"].includes(q.outcome)) where.push(`e.outcome = $${args.push(q.outcome)}`);
    // Organization filter only widens nothing: org scope is already pinned to the active org above.
    if (scope === "platform" && q.orgId && isUuid(q.orgId)) where.push(`e.org_id = $${args.push(q.orgId)}`);
    const actorQ = q.actor?.trim().slice(0, 100);
    if (actorQ) {
      // Only actors the viewer can see (users RLS) can match, so this can't be used to discover outsiders.
      const pattern = `%${actorQ.replace(/[\\%_]/g, (ch) => "\\" + ch)}%`;
      const n = args.push(pattern);
      where.push(`(u.display_name ilike $${n} or u.email ilike $${n})`);
    }
    const tz = q.timeZone && SUPPORTED_ZONES.has(q.timeZone) ? q.timeZone : "UTC";
    if (q.from && isDate(q.from)) {
      where.push(`e.occurred_at >= ($${args.push(q.from)}::date)::timestamp at time zone $${args.push(tz)}`);
    }
    if (q.to && isDate(q.to)) {
      where.push(`e.occurred_at < ($${args.push(q.to)}::date + 1)::timestamp at time zone $${args.push(tz)}`);
    }
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);

    const { rows } = await c.query(
      `select e.id::text, e.occurred_at, e.event_type, e.outcome, e.actor_user_id, u.display_name as actor_name,
              e.actor_kind, e.org_id, o.name as org_name, e.target_type, e.target_id, e.metadata
         from app.audit_events e
         left join app.users u on u.id = e.actor_user_id
         left join app.organizations o on o.id = e.org_id
        ${where.length ? `where ${where.join(" and ")}` : ""}
        order by e.id desc
        limit ${limit}`,
      args,
    );
    return {
      scope,
      rows: rows.map((r) => ({
        id: r.id,
        occurredAt: r.occurred_at,
        eventType: r.event_type,
        outcome: r.outcome,
        actorUserId: r.actor_user_id,
        actorName: r.actor_name,
        actorKind: r.actor_kind,
        orgId: r.org_id,
        orgName: r.org_name,
        targetType: r.target_type,
        targetId: r.target_id,
        metadata: r.metadata,
      })),
    };
  });
}
