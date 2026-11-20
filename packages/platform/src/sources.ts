import { withAppTx, type Db } from "@baytline/db";
import { IdentityError, writeAudit, type Actor } from "@baytline/identity";
import { fields } from "@baytline/identity";
import { requirePlatform } from "./guard";

/**
 * Platform review of developers' feeds and direct integrations. Platform staff see source metadata
 * (owner, type, connection host, authorization) and never the inventory itself.
 */
export type ReviewSource = {
  id: string; name: string; type: "data_feed" | "direct_integration"; adapterKey: string | null; orgId: string; orgName: string;
  host: string | null; recordType: string | null; trusted: boolean; secretNames: string[]; authorization: string; authorizationRef: string | null;
  decisionNote: string | null; decidedAt: Date | null; lastSuccessAt: Date | null; createdAt: Date;
};

export async function listSourcesForReview(db: Db, actor: Actor, filter: { status?: string } = {}): Promise<ReviewSource[]> {
  return withAppTx(db, actor, async (c) => {
    await requirePlatform(c, actor, "platform.integrations.view");
    const status = filter.status && ["pending_approval", "authorized", "rejected", "suspended", "revoked", "draft"].includes(filter.status) ? filter.status : null;
    const { rows } = await c.query(
      `select s.id, s.name, s.source_type, s.adapter_key, s.org_id, o.name as org_name, s.config, s.trusted, s.secret_names, s.authorization_status,
              s.authorization_ref, s.decision_note, s.decided_at, s.last_success_at, s.created_at
         from app.inventory_sources s join app.organizations o on o.id = s.org_id
        where s.source_type in ('data_feed','direct_integration') and s.authorization_status <> 'draft' and ($1::text is null or s.authorization_status = $1)
        order by (s.authorization_status = 'pending_approval') desc, s.created_at desc limit 200`,
      [status],
    );
    return rows.map((r) => {
      let host: string | null = null;
      try { host = r.config?.url ? new URL(r.config.url).hostname : null; } catch { host = null; }
      return {
        id: r.id, name: r.name, type: r.source_type, adapterKey: r.adapter_key, orgId: r.org_id, orgName: r.org_name, host, recordType: r.config?.record_type ?? null,
        trusted: r.trusted, secretNames: r.secret_names, authorization: r.authorization_status, authorizationRef: r.authorization_ref,
        decisionNote: r.decision_note, decidedAt: r.decided_at, lastSuccessAt: r.last_success_at, createdAt: r.created_at,
      };
    });
  });
}

/** Approve or reject a pending source, or suspend an authorized one. Platform administrators only; a note is required except to approve. */
export async function decideSource(db: Db, actor: Actor, sourceId: string, decision: unknown, note?: unknown): Promise<void> {
  const sid = fields.id(sourceId);
  const d = fields.oneOf(decision, ["approve", "reject", "suspend"] as const, "decision");
  const n = fields.opt(note, 500, "decision_note", true);
  if (d !== "approve" && !n) throw new IdentityError("invalid_input", "decision_note_required");
  await withAppTx(db, actor, async (c) => {
    await requirePlatform(c, actor, "platform.sources.manage");
    try {
      await c.query("savepoint s");
      await c.query("select app.decide_inventory_source($1, $2, $3)", [sid, d, n]);
    } catch (e) {
      const m = (e as { message?: string }).message;
      await c.query("rollback to savepoint s");
      if (m === "not_found") throw new IdentityError("not_found");
      if (m === "invalid_transition") throw new IdentityError("invalid_input", "invalid_transition");
      throw e;
    }
    await writeAudit(c, { type: "source.decided", outcome: "success", actorUserId: actor.userId, orgId: actor.orgId, target: { type: "inventory_source", id: sid }, metadata: { decision: d } });
  });
}
