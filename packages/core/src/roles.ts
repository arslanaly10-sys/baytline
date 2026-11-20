/**
 * Organization types and the roles that exist inside each one.
 * A user can belong to several organizations, but every request is evaluated
 * against exactly one *active* membership (see access.ts).
 */
export const ORG_TYPES = [
  "platform",
  "developer",
  "property_manager",
  "brokerage",
  "individual",
] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const ROLES = {
  // Platform operator
  platform_admin: { orgType: "platform" },
  platform_compliance: { orgType: "platform" },
  platform_support: { orgType: "platform" },
  // Developers
  developer_admin: { orgType: "developer" },
  developer_sales_manager: { orgType: "developer" },
  developer_inventory_manager: { orgType: "developer" },
  developer_finance: { orgType: "developer" },
  // Property management companies
  pm_admin: { orgType: "property_manager" },
  pm_leasing_manager: { orgType: "property_manager" },
  pm_maintenance_coordinator: { orgType: "property_manager" },
  pm_finance: { orgType: "property_manager" },
  // Brokerages and agents
  brokerage_admin: { orgType: "brokerage" },
  brokerage_manager: { orgType: "brokerage" },
  brokerage_agent: { orgType: "brokerage" },
  // Buyers, investors, renters, tenants (a personal "org" of one)
  individual: { orgType: "individual" },
} as const satisfies Record<string, { orgType: OrgType }>;

export type Role = keyof typeof ROLES;

export function rolesForOrgType(orgType: OrgType): Role[] {
  return (Object.keys(ROLES) as Role[]).filter((r) => ROLES[r].orgType === orgType);
}
