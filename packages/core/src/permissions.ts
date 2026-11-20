import type { Role } from "./roles";

/**
 * effect:
 *  - read           viewing data
 *  - write          routine changes (drafts, notes, status updates)
 *  - consequential  binding/financial actions; ALWAYS human-only and, where
 *                   `approval` is set, executed only after an approval step.
 */
type PermissionMeta = {
  effect: "read" | "write" | "consequential";
  /** The permission an approver needs to approve a request for this action (checked below). */
  approval?: string;
};

export const PERMISSIONS = {
  // Organization administration
  "org.settings.manage": { effect: "write" },
  "org.members.view": { effect: "read" },
  "org.members.manage": { effect: "write" },
  "approval.view": { effect: "read" },

  // Projects & inventory (developer-owned, shareable with partner brokerages)
  "project.view": { effect: "read" },
  "project.manage": { effect: "write" },
  "inventory.view": { effect: "read" },
  "inventory.import": { effect: "write" },
  // A partner brokerage proposes inventory updates; the developer reviews and confirms them.
  "inventory.update.submit": { effect: "write" },
  "unit.manage": { effect: "write" },
  "partner.view": { effect: "read" },
  "partner.manage": { effect: "write" },
  "inventory.verify": { effect: "consequential" },
  "unit.hold.request": { effect: "consequential", approval: "unit.hold.approve" },
  "unit.hold.approve": { effect: "consequential" },
  "price.view": { effect: "read" },
  "price.change.request": { effect: "consequential", approval: "price.change.approve" },
  "price.change.approve": { effect: "consequential" },
  "payment_plan.manage": { effect: "write" },
  "payment_plan.publish": { effect: "consequential", approval: "payment_plan.approve" },
  "payment_plan.approve": { effect: "consequential" },
  "document.view": { effect: "read" },
  "document.manage": { effect: "write" },
  "area_profile.view": { effect: "read" },
  "area_profile.manage": { effect: "write" },

  // Property management
  "property.view": { effect: "read" },
  "property.manage": { effect: "write" },
  "occupancy.view": { effect: "read" },
  "lease.view": { effect: "read" },
  "lease.manage": { effect: "write" },
  "lease.sign.request": { effect: "consequential", approval: "lease.sign.approve" },
  "lease.sign.approve": { effect: "consequential" },
  "tenant.contact.view": { effect: "read" },
  "tenant_request.view": { effect: "read" },
  "tenant_request.manage": { effect: "write" },
  "maintenance.view": { effect: "read" },
  "maintenance.manage": { effect: "write" },
  "maintenance.spend.approve": { effect: "consequential" },

  // Brokerage
  "client_registration.submit": { effect: "write" },
  "client_registration.review": { effect: "consequential" },
  "lead.view": { effect: "read" },
  "lead.manage": { effect: "write" },
  "lead.assign": { effect: "write" },
  "viewing.manage": { effect: "write" },
  "deal.view": { effect: "read" },
  "deal.manage": { effect: "write" },
  "commission.view": { effect: "read" },
  "commission.approve": { effect: "consequential" },

  // Communications & analytics
  "conversation.view": { effect: "read" },
  "conversation.reply": { effect: "write" },
  "campaign.view": { effect: "read" },
  "analytics.view": { effect: "read" },
  "audit.view": { effect: "read" },

  // Individuals (buyers, investors, renters, tenants)
  "listing.browse": { effect: "read" },
  /** Approving a project, units or a rental for public display. Audited. */
  "listing.publish": { effect: "consequential" },
  "shortlist.manage": { effect: "write" },
  "enquiry.create": { effect: "write" },
  "appointment.book": { effect: "write" },
  "tenancy.view": { effect: "read" },
  "support.request": { effect: "write" },

  // Platform operations
  "platform.orgs.view": { effect: "read" },
  "platform.orgs.manage": { effect: "write" },
  "platform.users.view": { effect: "read" },
  "platform.users.manage": { effect: "write" },
  "platform.markets.view": { effect: "read" },
  "platform.integrations.view": { effect: "read" },
  "platform.integrations.manage": { effect: "write" },
  "platform.markets.configure": { effect: "consequential" },
  "platform.sources.manage": { effect: "write" },
  "platform.ai_policy.manage": { effect: "consequential" },
  "support.handle": { effect: "write" },
} as const satisfies Record<string, PermissionMeta>;

export type Permission = keyof typeof PERMISSIONS;

// Compile-time guarantee: every `approval` names an existing permission.
type ApprovalTargets = { [K in Permission]: (typeof PERMISSIONS)[K] extends { approval: infer A } ? A : never }[Permission];
const _approvalTargetsAreValid: Permission = null as unknown as ApprovalTargets;
void _approvalTargetsAreValid;

/** The approver permission for an approval-gated action, if any. */
export function approverPermission(p: Permission): Permission | undefined {
  const meta: PermissionMeta = PERMISSIONS[p];
  return meta.approval as Permission | undefined;
}


/**
 * How far a grant reaches:
 *  - platform  any record (platform staff only, always audited)
 *  - org       records owned by the active organization
 *  - shared    records owned by, or explicitly shared with, the active org
 *  - assigned  records in scope of the org AND assigned to this user
 *  - self      records whose subject is this user
 *  - public    records that have been published to the marketplace
 */
export type Scope = "platform" | "org" | "shared" | "assigned" | "self" | "public";
export type Grant = readonly [Permission, Scope];

const g = (scope: Scope, ...ps: Permission[]): Grant[] => ps.map((p) => [p, scope] as const);

const developerRead = g("org", "project.view", "inventory.view", "price.view", "document.view", "area_profile.view");

export const ROLE_GRANTS: Record<Role, readonly Grant[]> = {
  platform_admin: [
    ...g("platform", "platform.orgs.view", "platform.orgs.manage", "platform.users.view", "platform.users.manage",
      "platform.markets.view", "platform.markets.configure", "platform.integrations.view", "platform.integrations.manage",
      "platform.sources.manage", "platform.ai_policy.manage", "audit.view", "support.handle"),
    ...g("org", "org.settings.manage", "org.members.view", "org.members.manage", "approval.view"),
  ],
  // Compliance and support can look things up; only platform administrators change them.
  platform_compliance: [
    ...g("platform", "audit.view", "platform.orgs.view", "platform.users.view", "platform.markets.view", "platform.integrations.view"),
    ...g("org", "org.members.view", "approval.view"),
  ],
  platform_support: [
    ...g("platform", "platform.orgs.view", "platform.users.view", "platform.markets.view", "platform.integrations.view", "support.handle"),
    ...g("org", "org.members.view"),
  ],

  developer_admin: [
    ...developerRead,
    ...g("org", "org.settings.manage", "org.members.view", "org.members.manage", "approval.view",
      "project.manage", "unit.manage", "inventory.import", "inventory.verify", "document.manage", "area_profile.manage",
      "unit.hold.approve", "price.change.request", "price.change.approve", "payment_plan.manage", "payment_plan.publish", "payment_plan.approve",
      "partner.view", "partner.manage",
      "client_registration.review", "lead.view", "lead.manage", "lead.assign", "viewing.manage", "listing.publish", "conversation.view",
      "campaign.view", "analytics.view", "audit.view", "commission.view", "commission.approve"),
  ],
  developer_sales_manager: [
    ...developerRead,
    ...g("org", "approval.view", "unit.hold.request", "unit.hold.approve", "price.change.request", "partner.view", "partner.manage",
      "client_registration.review", "lead.view", "lead.manage", "lead.assign", "viewing.manage", "listing.publish",
      "conversation.view", "conversation.reply", "campaign.view", "analytics.view", "commission.view"),
  ],
  developer_inventory_manager: [
    ...developerRead,
    ...g("org", "approval.view", "project.manage", "unit.manage", "inventory.import", "inventory.verify", "partner.view",
      "document.manage", "area_profile.manage", "price.change.request", "payment_plan.manage", "payment_plan.publish"),
  ],
  developer_finance: [
    ...developerRead,
    ...g("org", "approval.view", "price.change.approve", "payment_plan.approve", "commission.view", "commission.approve", "audit.view"),
  ],

  pm_admin: [
    ...g("org", "org.settings.manage", "org.members.view", "org.members.manage", "approval.view",
      "property.view", "property.manage", "occupancy.view", "lease.view", "lease.manage", "lease.sign.approve",
      "tenant.contact.view", "tenant_request.view", "tenant_request.manage", "maintenance.view", "maintenance.manage",
      "maintenance.spend.approve", "conversation.view", "analytics.view", "audit.view",
      "lead.view", "lead.manage", "viewing.manage", "listing.publish"),
  ],
  pm_leasing_manager: [
    ...g("org", "approval.view", "property.view", "occupancy.view", "lease.view", "lease.manage",
      "lease.sign.request", "tenant.contact.view", "tenant_request.view", "tenant_request.manage",
      "lead.view", "lead.manage", "viewing.manage", "listing.publish", "conversation.view", "conversation.reply"),
  ],
  // Sees tenant names on requests, never their contact details.
  pm_maintenance_coordinator: [
    ...g("org", "property.view", "tenant_request.view", "tenant_request.manage", "maintenance.view", "maintenance.manage", "conversation.reply"),
  ],
  pm_finance: [
    ...g("org", "approval.view", "property.view", "occupancy.view", "lease.view", "maintenance.view",
      "maintenance.spend.approve", "lease.sign.approve", "audit.view"),
  ],

  brokerage_admin: [
    ...g("org", "org.settings.manage", "org.members.view", "org.members.manage", "approval.view",
      "client_registration.submit", "lead.view", "lead.manage", "lead.assign", "viewing.manage",
      "deal.view", "deal.manage", "commission.view", "conversation.view", "conversation.reply",
      "campaign.view", "analytics.view", "audit.view"),
    ...g("shared", "project.view", "inventory.view", "price.view", "document.view", "area_profile.view", "unit.hold.request", "inventory.update.submit"),
  ],
  brokerage_manager: [
    ...g("org", "approval.view", "client_registration.submit", "lead.view", "lead.manage", "lead.assign",
      "viewing.manage", "deal.view", "deal.manage", "commission.view", "conversation.view", "conversation.reply", "analytics.view"),
    ...g("shared", "project.view", "inventory.view", "price.view", "document.view", "area_profile.view", "unit.hold.request", "inventory.update.submit"),
  ],
  brokerage_agent: [
    ...g("assigned", "lead.view", "lead.manage", "viewing.manage", "deal.view", "deal.manage",
      "commission.view", "conversation.view", "conversation.reply"),
    ...g("org", "client_registration.submit"),
    ...g("shared", "project.view", "inventory.view", "price.view", "document.view", "area_profile.view", "unit.hold.request"),
  ],

  individual: [
    ...g("self", "shortlist.manage", "enquiry.create", "appointment.book", "tenancy.view", "support.request", "conversation.view", "conversation.reply"),
    ...g("public", "listing.browse"),
  ],
};
