import { canApprove, type Permission, type VersionStatus } from "@baytline/core";
import type { Client } from "@baytline/db";
import type { Actor, OrgContext } from "@baytline/identity";
import { audit, IdentityError } from "./guard";

/**
 * Shared lifecycle for price-list and payment-plan versions:
 *   draft --submit--> submitted --approve--> approved --(newer approved)--> superseded
 *                               \--reject--> rejected
 * Only drafts change (database trigger). The approver must differ from the submitter
 * (core canApprove + a database CHECK).
 */
export type VersionKind = "price" | "plan";

const CFG = {
  price: { table: "app.price_list_versions", parent: "price_list_id", request: "price.change.request" as Permission, events: "price_version" },
  plan: { table: "app.payment_plan_versions", parent: "plan_id", request: "payment_plan.publish" as Permission, events: "plan_version" },
} as const;

export type VersionMeta = {
  id: string;
  parentId: string;
  version: number;
  status: VersionStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  createdAt: Date;
  createdByName: string | null;
  submittedAt: Date | null;
  submittedBy: string | null;
  submittedByName: string | null;
  decidedAt: Date | null;
  decidedByName: string | null;
  decisionNote: string | null;
};

export async function loadVersion(c: Client, kind: VersionKind, versionId: string, lock = false): Promise<VersionMeta & Record<string, any>> {
  const t = CFG[kind];
  const { rows } = await c.query(
    `select v.*, v.effective_from::text as ef, v.effective_to::text as et, cu.display_name as created_by_name,
            su.display_name as submitted_by_name, du.display_name as decided_by_name
       from ${t.table} v
       left join app.users cu on cu.id = v.created_by
       left join app.users su on su.id = v.submitted_by
       left join app.users du on du.id = v.decided_by
      where v.id = $1 and v.org_id = app.current_org_id() ${lock ? "for update of v" : ""}`,
    [versionId],
  );
  const r = rows[0];
  if (!r) throw new IdentityError("not_found");
  return {
    ...r,
    id: r.id,
    parentId: r[t.parent],
    version: r.version,
    status: r.status,
    effectiveFrom: r.ef,
    effectiveTo: r.et,
    notes: r.notes,
    createdAt: r.created_at,
    createdByName: r.created_by_name,
    submittedAt: r.submitted_at,
    submittedBy: r.submitted_by,
    submittedByName: r.submitted_by_name,
    decidedAt: r.decided_at,
    decidedByName: r.decided_by_name,
    decisionNote: r.decision_note,
  };
}

export async function nextVersionNumber(c: Client, kind: VersionKind, parentId: string): Promise<number> {
  const t = CFG[kind];
  const { rows } = await c.query<{ n: number }>(`select coalesce(max(version), 0)::int + 1 as n from ${t.table} where ${t.parent} = $1`, [parentId]);
  return rows[0]!.n;
}

export async function submitVersion(c: Client, actor: Actor, kind: VersionKind, versionId: string): Promise<void> {
  const v = await loadVersion(c, kind, versionId, true);
  if (v.status !== "draft") throw new IdentityError("invalid_input", "not_draft");
  await c.query(`update ${CFG[kind].table} set status = 'submitted', submitted_at = now(), submitted_by = $2 where id = $1`, [versionId, actor.userId]);
  await audit(c, actor, { type: `${CFG[kind].events}.submitted` as never, target: { type: `${kind}_version`, id: versionId } });
}

export async function decideVersion(
  c: Client,
  actor: Actor,
  ctx: OrgContext,
  kind: VersionKind,
  versionId: string,
  decision: "approve" | "reject",
  note: string | null,
): Promise<void> {
  const t = CFG[kind];
  const v = await loadVersion(c, kind, versionId, true);
  if (v.status !== "submitted") throw new IdentityError("invalid_input", "not_submitted");
  // Separation of duties: the same check core uses everywhere.
  const allowed = canApprove(ctx.principal, { action: t.request, requestedBy: v.submittedBy ?? "", resource: { ownerOrgId: actor.orgId } });
  if (!allowed) throw new IdentityError("forbidden", v.submittedBy === actor.userId ? "own_submission" : "no_permission");
  if (decision === "reject") {
    await c.query(`update ${t.table} set status = 'rejected', decided_at = now(), decided_by = $2, decision_note = $3 where id = $1`, [versionId, actor.userId, note]);
    await audit(c, actor, { type: `${t.events}.rejected` as never, target: { type: `${kind}_version`, id: versionId } });
    return;
  }
  // Older approved versions that this one replaces (same parent, starting no later) become superseded.
  await c.query(
    `update ${t.table} set status = 'superseded' where ${t.parent} = $1 and status = 'approved' and effective_from <= $2 and id <> $3`,
    [v.parentId, v.effectiveFrom, versionId],
  );
  await c.query(`update ${t.table} set status = 'approved', decided_at = now(), decided_by = $2, decision_note = $3 where id = $1`, [versionId, actor.userId, note]);
  await audit(c, actor, { type: `${t.events}.approved` as never, target: { type: `${kind}_version`, id: versionId } });
}

export function mapVersionError(e: unknown): never {
  const msg = e instanceof Error ? e.message : "";
  if (msg === "version_locked" || msg === "invalid_version_transition") throw new IdentityError("invalid_input", "version_locked");
  throw e;
}
