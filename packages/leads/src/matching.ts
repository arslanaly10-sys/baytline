import { availabilityLabel, type AvailabilityLabel } from "@baytline/core";
import { withAppTx, type Db } from "@baytline/db";
import type { Actor } from "@baytline/identity";
import { f, IdentityError, requireLeadOrg } from "./guard";

/**
 * Matching a lead's stated requirements to inventory. Only real, available, non-sample units the
 * organization may see (its own, or projects actively shared with it), only prices from an APPROVED
 * price list in effect today, and every unit carries its inventory label. Confirmed availability
 * comes first; stale, unverified or conflicting units are shown as such, never as available.
 * Each match says which requirements it meets and which can't be checked.
 */
export type MatchCriterion = { criterion: "property_type" | "bedrooms" | "budget" | "city"; result: "met" | "unknown" };
export type UnitMatch = {
  unitId: string; projectId: string; projectName: string; city: string; code: string; propertyType: string; bedrooms: number | null; areaSqm: string | null;
  price: { minor: string; currency: string } | null; availability: AvailabilityLabel; criteria: MatchCriterion[];
};

const RANK: Record<AvailabilityLabel, number> = { live: 0, recently_confirmed: 1, stale: 2, unverified: 3, disputed: 4 };

export async function matchUnits(db: Db, actor: Actor, leadId: string, now = new Date()): Promise<{ matches: UnitMatch[]; hasRequirements: boolean }> {
  const id = f.id(leadId);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireLeadOrg(c, actor, "lead.view");
    const { rows: lr } = await c.query("select * from app.leads where id = $1 and org_id = app.current_org_id()", [id]);
    const lead = lr[0];
    if (!lead) throw new IdentityError("not_found");
    const types: string[] = lead.property_types ?? [];
    const hasRequirements = types.length > 0 || lead.bedrooms_min !== null || lead.budget_max_minor !== null || lead.budget_min_minor !== null || Boolean(lead.city);
    if (!hasRequirements) return { matches: [], hasRequirements };

    const scope = ctx.org.type === "developer"
      ? "u.org_id = app.current_org_id()"
      : "exists (select 1 from app.project_shares s where s.project_id = u.project_id and s.brokerage_org_id = app.current_org_id() and s.status = 'active')";
    const args: unknown[] = [];
    const where = [scope, "u.status = 'available'", "not u.is_sample", "not p.is_sample", "p.status <> 'cancelled'"];
    if (types.length) where.push(`u.property_type = any($${args.push(types)}::text[])`);
    if (lead.bedrooms_min !== null) where.push(`u.bedrooms >= $${args.push(lead.bedrooms_min)}`);
    if (lead.city) where.push(`lower(p.city) = lower($${args.push(lead.city)})`);
    const { rows } = await c.query(
      `select u.id, u.project_id, p.name as project_name, p.city, u.code, u.property_type, u.bedrooms, u.area_sqm::text as area_sqm,
              u.source_kind, u.verification, u.last_verified_at, u.last_updated_at, u.version,
              src.freshness_hours, coalesce(src.authorization_status = 'authorized', true) as source_authorized,
              cp.price_minor::text as price_minor, cp.currency
         from app.units u
         join app.projects p on p.id = u.project_id
         join app.markets mk on mk.code = p.market
         left join app.inventory_sources src on src.id = u.source_id
         left join lateral (
           select e.price_minor, l.currency from app.price_list_entries e
             join app.price_list_versions v on v.id = e.version_id join app.price_lists l on l.id = v.price_list_id
            where e.unit_id = u.id and v.status = 'approved'
              and v.effective_from <= (now() at time zone mk.time_zone)::date and (v.effective_to is null or v.effective_to >= (now() at time zone mk.time_zone)::date)
            order by v.effective_from desc, v.decided_at desc limit 1) cp on true
        where ${where.join(" and ")}
        limit 500`,
      args,
    );
    const budgetSet = lead.budget_max_minor !== null || lead.budget_min_minor !== null;
    const matches: UnitMatch[] = [];
    for (const r of rows) {
      const price = r.price_minor ? { minor: r.price_minor as string, currency: r.currency as string } : null;
      if (budgetSet) {
        // A budget can only be checked against an approved price in the same currency; otherwise the unit isn't offered as a match.
        if (!price || price.currency !== lead.currency) continue;
        const p = BigInt(price.minor);
        if (lead.budget_max_minor !== null && p > BigInt(lead.budget_max_minor)) continue;
        if (lead.budget_min_minor !== null && p < BigInt(lead.budget_min_minor)) continue;
      }
      const availability = availabilityLabel(
        { sourceKind: r.source_kind, sourceId: "", ownerOrgId: "", lastUpdatedAt: r.last_updated_at.toISOString(), lastVerifiedAt: r.last_verified_at?.toISOString(),
          verification: r.verification, version: r.version, freshnessHours: r.freshness_hours, sourceAuthorized: r.source_authorized },
        now,
      );
      const criteria: MatchCriterion[] = [];
      if (types.length) criteria.push({ criterion: "property_type", result: "met" });
      if (lead.bedrooms_min !== null) criteria.push({ criterion: "bedrooms", result: "met" });
      if (budgetSet) criteria.push({ criterion: "budget", result: "met" });
      if (lead.city) criteria.push({ criterion: "city", result: "met" });
      matches.push({
        unitId: r.id, projectId: r.project_id, projectName: r.project_name, city: r.city, code: r.code, propertyType: r.property_type, bedrooms: r.bedrooms,
        areaSqm: r.area_sqm, price, availability, criteria,
      });
    }
    matches.sort((a, b) => RANK[a.availability] - RANK[b.availability] || (a.price && b.price ? (BigInt(a.price.minor) < BigInt(b.price.minor) ? -1 : 1) : a.price ? -1 : 1));
    return { matches: matches.slice(0, 50), hasRequirements };
  });
}
