/** Property-management vocabulary. Stored as text with matching CHECK constraints in migration 0006. */

export const PM_PROPERTY_TYPES = ["residential_building", "villa_compound", "single_villa", "mixed_use", "commercial_building", "retail_center", "other"] as const;
export type PmPropertyType = (typeof PM_PROPERTY_TYPES)[number];

/** How the organization relates to the property, as recorded from its agreement with the owner. */
export const MANAGEMENT_BASES = ["full_management", "leasing_only", "maintenance_only"] as const;
export type ManagementBasis = (typeof MANAGEMENT_BASES)[number];

export const PM_UNIT_TYPES = ["apartment", "villa", "townhouse", "office", "retail", "storage", "other"] as const;
export type PmUnitType = (typeof PM_UNIT_TYPES)[number];

/** Recorded by staff. Never inferred from leases. */
export const OCCUPANCY_STATUSES = ["vacant", "occupied", "notice_given", "under_maintenance", "not_available"] as const;
export type OccupancyStatus = (typeof OCCUPANCY_STATUSES)[number];

export const LEASE_STATUSES = ["draft", "active", "renewed", "ended", "terminated"] as const;
export type LeaseStatus = (typeof LEASE_STATUSES)[number];

export const PAYMENT_FREQUENCIES = ["monthly", "quarterly", "semi_annual", "annual", "other"] as const;
export type PaymentFrequency = (typeof PAYMENT_FREQUENCIES)[number];

export const REQUEST_CATEGORIES = ["plumbing", "electrical", "air_conditioning", "appliance", "pest_control", "cleaning", "access_security", "noise", "billing", "other"] as const;
export type RequestCategory = (typeof REQUEST_CATEGORIES)[number];

export const REQUEST_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];

export const REQUEST_STATUSES = ["open", "in_progress", "waiting", "resolved", "closed"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** "completed" is only reachable through the explicit record-completion action. */
export const WORK_ORDER_STATUSES = ["draft", "scheduled", "in_progress", "on_hold", "completed", "cancelled"] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

/** Market rule categories that apply to leasing (configured under Platform > Markets). */
export const LEASE_RULE_CATEGORIES = ["tenancy_registration", "rent_increase", "security_deposit"] as const;

/** Roles that may see tenant contact details; mirrored in the database (migration 0006) and checked by a test. */
export const TENANT_CONTACT_ROLES = ["pm_admin", "pm_leasing_manager"] as const;
