import { canApprove, type MarketCode } from "@baytline/core";
import { withAppTx, type Db } from "@baytline/db";
import type { Actor } from "@baytline/identity";
import { audit, can, IdentityError, requireDeveloper } from "./guard";
import { id } from "./validation";

/**
 * Project access for brokerage partners. A share grants read access to the project
 * and its non-draft units; pricing (approved versions only) and partner-visible
 * documents are separate switches. Enforced by RLS (app.shared_with_me).
 * Lead registration, commissions and deals are not part of this milestone.
 */
export type BrokerageOption = { id: string; name: string; market: MarketCode | null };

export async function brokerageDirectory(db: Db, actor: Actor): Promise<BrokerageOption[]> {
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "partner.view");
    const { rows } = await c.query("select id, name, market from app.brokerage_directory()");
    return rows;
  });
}

export type ShareRow = {
  id: string;
  projectId: string;
  projectName: string;
  brokerageId: string;
  brokerageName: string;
  includePricing: boolean;
  includeDocuments: boolean;
  status: "active" | "revoked";
  grantedAt: Date;
  grantedByName: string | null;
  updatedAt: Date | null;
};

export async function listShares(db: Db, actor: Actor, s: { projectId?: string; includeRevoked?: boolean } = {}): Promise<{ shares: ShareRow[]; canManage: boolean }> {
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireDeveloper(c, actor, "partner.view");
    const where = ["s.org_id = app.current_org_id()"];
    const args: unknown[] = [];
    if (s.projectId) where.push(`s.project_id = $${args.push(id(s.projectId))}`);
    if (!s.includeRevoked) where.push("s.status = 'active'");
    // Brokerage names come from the directory function: developers can't read other orgs' rows directly.
    const { rows } = await c.query(
      `select s.*, p.name as project_name, d.name as brokerage_name, u.display_name as granted_by_name
         from app.project_shares s
         join app.projects p on p.id = s.project_id
         left join app.brokerage_directory() d on d.id = s.brokerage_org_id
         left join app.users u on u.id = s.granted_by
        where ${where.join(" and ")} order by d.name nulls last, p.name`,
      args,
    );
    return {
      canManage: can(ctx, "partner.manage"),
      shares: rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        projectName: r.project_name,
        brokerageId: r.brokerage_org_id,
        brokerageName: r.brokerage_name ?? "",
        includePricing: r.include_pricing,
        includeDocuments: r.include_documents,
        status: r.status,
        grantedAt: r.granted_at,
        grantedByName: r.granted_by_name,
        updatedAt: r.updated_at,
      })),
    };
  });
}

export async function grantShare(
  db: Db,
  actor: Actor,
  input: { projectId: string; brokerageId: string; includePricing: boolean; includeDocuments: boolean },
): Promise<string> {
  const pid = id(input.projectId);
  const bid = id(input.brokerageId);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireDeveloper(c, actor, "partner.manage");
    // Sharing pricing makes approved prices visible outside the company: needs pricing authority too.
    if (input.includePricing && !can(ctx, "price.change.request") && !can(ctx, "price.change.approve")) throw new IdentityError("forbidden", "pricing_share");
    const { rows: p } = await c.query("select is_sample from app.projects where id = $1", [pid]);
    if (!p[0]) throw new IdentityError("not_found");
    if (p[0].is_sample) throw new IdentityError("invalid_input", "sample_not_shareable");
    const { rowCount } = await c.query("select 1 from app.brokerage_directory() where id = $1", [bid]);
    if (!rowCount) throw new IdentityError("invalid_input", "brokerage");
    try {
      await c.query("savepoint s");
      const { rows } = await c.query<{ id: string }>(
        `insert into app.project_shares (org_id, project_id, brokerage_org_id, include_pricing, include_documents, granted_by)
         values (app.current_org_id(), $1, $2, $3, $4, $5) returning id`,
        [pid, bid, input.includePricing, input.includeDocuments, actor.userId],
      );
      await audit(c, actor, {
        type: "partner_share.granted",
        target: { type: "project_share", id: rows[0]!.id },
        metadata: { pricing: input.includePricing, documents: input.includeDocuments },
      });
      return rows[0]!.id;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        await c.query("rollback to savepoint s");
        throw new IdentityError("conflict", "already_shared");
      }
      throw e;
    }
  });
}

export async function updateShare(db: Db, actor: Actor, shareId: string, input: { includePricing: boolean; includeDocuments: boolean }): Promise<void> {
  const sid = id(shareId);
  await withAppTx(db, actor, async (c) => {
    const ctx = await requireDeveloper(c, actor, "partner.manage");
    const { rows } = await c.query("select include_pricing from app.project_shares where id = $1 and status = 'active' for update", [sid]);
    if (!rows[0]) throw new IdentityError("not_found");
    if (input.includePricing && !rows[0].include_pricing && !can(ctx, "price.change.request") && !can(ctx, "price.change.approve")) {
      throw new IdentityError("forbidden", "pricing_share");
    }
    await c.query("update app.project_shares set include_pricing = $2, include_documents = $3, updated_at = now(), updated_by = $4 where id = $1", [
      sid,
      input.includePricing,
      input.includeDocuments,
      actor.userId,
    ]);
    await audit(c, actor, { type: "partner_share.updated", target: { type: "project_share", id: sid }, metadata: { pricing: input.includePricing, documents: input.includeDocuments } });
  });
}

/** Takes effect on the partner's next request. */
export async function revokeShare(db: Db, actor: Actor, shareId: string): Promise<void> {
  const sid = id(shareId);
  await withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "partner.manage");
    const res = await c.query("update app.project_shares set status = 'revoked', revoked_at = now(), revoked_by = $2 where id = $1 and status = 'active'", [sid, actor.userId]);
    if (res.rowCount !== 1) throw new IdentityError("not_found");
    await audit(c, actor, { type: "partner_share.revoked", target: { type: "project_share", id: sid } });
  });
}

// --------------------------------------------------------------- approvals queue

export type PendingApproval = {
  kind: "price" | "plan";
  versionId: string;
  parentName: string;
  projectId: string;
  projectName: string;
  version: number;
  effectiveFrom: string;
  submittedAt: Date;
  submittedByName: string | null;
  canDecide: boolean;
  isOwnSubmission: boolean;
};

export async function listPendingApprovals(db: Db, actor: Actor): Promise<PendingApproval[]> {
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireDeveloper(c, actor, "approval.view");
    const { rows } = await c.query(
      `select 'price' as kind, v.id, l.name as parent_name, p.id as project_id, p.name as project_name, v.version, v.effective_from::text, v.submitted_at, v.submitted_by, u.display_name
         from app.price_list_versions v join app.price_lists l on l.id = v.price_list_id join app.projects p on p.id = l.project_id left join app.users u on u.id = v.submitted_by
        where v.status = 'submitted' and v.org_id = app.current_org_id()
       union all
       select 'plan', v.id, pl.name, p.id, p.name, v.version, v.effective_from::text, v.submitted_at, v.submitted_by, u.display_name
         from app.payment_plan_versions v join app.payment_plans pl on pl.id = v.plan_id join app.projects p on p.id = pl.project_id left join app.users u on u.id = v.submitted_by
        where v.status = 'submitted' and v.org_id = app.current_org_id()
       order by submitted_at`,
    );
    return rows.map((r) => {
      const action = r.kind === "price" ? "price.change.request" : "payment_plan.publish";
      return {
        kind: r.kind,
        versionId: r.id,
        parentName: r.parent_name,
        projectId: r.project_id,
        projectName: r.project_name,
        version: r.version,
        effectiveFrom: r.effective_from,
        submittedAt: r.submitted_at,
        submittedByName: r.display_name,
        isOwnSubmission: r.submitted_by === actor.userId,
        canDecide: canApprove(ctx.principal, { action, requestedBy: r.submitted_by, resource: { ownerOrgId: actor.orgId } }),
      };
    });
  });
}
