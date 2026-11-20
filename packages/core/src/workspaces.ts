import type { Permission } from "./permissions";
import type { OrgType } from "./roles";

export type WorkspaceId = "admin" | "developer" | "management" | "brokerage" | "personal";

export type WorkspaceSection = {
  /** URL segment; "" is the workspace overview. Also the i18n key. */
  id: string;
  /** Shown only when the active membership has this capability. */
  requires: Permission;
  /** Milestone in docs/roadmap.md that delivers this section. */
  milestone: number;
};

export type WorkspaceDef = {
  id: WorkspaceId;
  orgType: OrgType;
  sections: readonly WorkspaceSection[];
};

const s = (id: string, requires: Permission, milestone: number): WorkspaceSection => ({ id, requires, milestone });

export const WORKSPACES: Record<WorkspaceId, WorkspaceDef> = {
  admin: {
    id: "admin",
    orgType: "platform",
    sections: [
      s("organizations", "platform.orgs.view", 3),
      s("users", "platform.users.view", 3),
      s("markets", "platform.markets.view", 3),
      s("integrations", "platform.integrations.view", 3),
      s("sources", "platform.sources.manage", 8),
      s("ai-policies", "platform.ai_policy.manage", 7),
      s("team", "org.members.view", 2),
      s("audit", "audit.view", 3),
    ],
  },
  developer: {
    id: "developer",
    orgType: "developer",
    sections: [
      s("projects", "project.view", 4),
      s("inventory", "inventory.view", 4),
      s("pricing", "price.view", 4),
      s("documents", "document.view", 4),
      s("partners", "partner.view", 4),
      s("approvals", "approval.view", 4),
      s("area-profiles", "area_profile.view", 9),
      s("leads", "lead.view", 9),
      s("team", "org.members.view", 2),
      s("audit", "audit.view", 2),
    ],
  },
  management: {
    id: "management",
    orgType: "property_manager",
    sections: [
      s("portfolio", "property.view", 6),
      s("occupancy", "occupancy.view", 6),
      s("leasing", "lease.view", 6),
      s("requests", "tenant_request.view", 6),
      s("maintenance", "maintenance.view", 6),
      s("approvals", "approval.view", 6),
      s("team", "org.members.view", 2),
      s("audit", "audit.view", 2),
    ],
  },
  brokerage: {
    id: "brokerage",
    orgType: "brokerage",
    sections: [
      s("clients", "client_registration.submit", 9),
      s("leads", "lead.view", 9),
      s("viewings", "viewing.manage", 9),
      s("deals", "deal.view", 9),
      s("commissions", "commission.view", 9),
      s("conversations", "conversation.view", 10),
      s("inventory", "inventory.view", 9),
      s("team", "org.members.view", 2),
      s("audit", "audit.view", 2),
    ],
  },
  personal: {
    id: "personal",
    orgType: "individual",
    sections: [
      s("discover", "listing.browse", 11),
      s("shortlist", "shortlist.manage", 11),
      s("enquiries", "enquiry.create", 11),
      s("appointments", "appointment.book", 11),
      s("tenancy", "tenancy.view", 10),
      s("support", "support.request", 10),
    ],
  },
};

export const WORKSPACE_IDS = Object.keys(WORKSPACES) as WorkspaceId[];

export function workspaceForOrgType(orgType: OrgType): WorkspaceDef {
  const ws = Object.values(WORKSPACES).find((w) => w.orgType === orgType);
  if (!ws) throw new Error(`No workspace for org type ${orgType}`);
  return ws;
}

export function isWorkspaceId(v: string): v is WorkspaceId {
  return v in WORKSPACES;
}
