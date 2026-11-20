import { ROLE_GRANTS, type Permission } from "./permissions";
import type { Role } from "./roles";

/** Customer-facing vocabulary (milestone 7). Stored as text with matching CHECK constraints in migration 0009. */

export const PURPOSES = ["buy", "rent"] as const;
export type Purpose = (typeof PURPOSES)[number];

export const LISTING_KINDS = ["project", "unit", "rental"] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

export const CONTACT_METHODS = ["email", "phone", "whatsapp"] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export const ENQUIRY_SOURCES = ["listing_page", "compare_page"] as const;
export type EnquirySource = (typeof ENQUIRY_SOURCES)[number];

export const ENQUIRY_STATUSES = ["new", "in_progress", "closed"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export const APPOINTMENT_KINDS = ["viewing", "consultation"] as const;
export type AppointmentKind = (typeof APPOINTMENT_KINDS)[number];

export const DAY_PERIODS = ["morning", "afternoon", "evening"] as const;
export type DayPeriod = (typeof DAY_PERIODS)[number];

/** "pending" until an authorized person confirms a time; nothing here is a calendar booking. */
export const APPOINTMENT_STATUSES = ["pending", "confirmed", "declined", "cancelled"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const SUPPORT_TOPICS = ["account", "enquiry", "appointment", "listing", "privacy", "other"] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

export const SUPPORT_STATUSES = ["open", "answered", "closed"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** Most units a customer can compare side by side. */
export const COMPARE_LIMIT = 4;
/** Furthest ahead a customer can propose a viewing. */
export const APPOINTMENT_HORIZON_DAYS = 90;

/** Roles holding `p` at organization scope. The database mirrors these lists (migration 0009); a test checks they match. */
export function orgScopedRoles(p: Permission): Role[] {
  return (Object.entries(ROLE_GRANTS) as [Role, readonly (readonly [Permission, string])[]][])
    .filter(([, grants]) => grants.some(([perm, scope]) => perm === p && scope === "org"))
    .map(([r]) => r)
    .sort();
}
export const LEAD_ROLES = orgScopedRoles("lead.view");
export const VIEWING_ROLES = orgScopedRoles("viewing.manage");
export const PUBLISH_ROLES = orgScopedRoles("listing.publish");
export const SUPPORT_ROLES = (Object.entries(ROLE_GRANTS) as [Role, readonly (readonly [Permission, string])[]][])
  .filter(([, grants]) => grants.some(([perm]) => perm === "support.handle"))
  .map(([r]) => r)
  .sort();
