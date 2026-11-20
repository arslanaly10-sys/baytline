/** Developer workspace vocabulary. Stored as text in the database with matching CHECK constraints. */

export const PROJECT_STATUSES = ["planning", "pre_launch", "launched", "under_construction", "completed", "on_hold", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROPERTY_TYPES = ["apartment", "villa", "townhouse", "penthouse", "duplex", "office", "retail", "plot"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PHASE_KINDS = ["building", "phase"] as const;
export type PhaseKind = (typeof PHASE_KINDS)[number];

/** Unit lifecycle. Reserved and sold are binding states and need unit.hold.approve. */
export const UNIT_STATUSES = ["draft", "available", "reserved", "sold", "unavailable"] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];
export const BINDING_UNIT_STATUSES: readonly UnitStatus[] = ["reserved", "sold"];

/** Price lists and payment plans are versioned. Only drafts can be edited; approval needs a second person. */
export const VERSION_STATUSES = ["draft", "submitted", "approved", "rejected", "superseded"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export const MILESTONE_TRIGGERS = ["on_booking", "on_date", "construction_progress", "on_handover", "after_handover"] as const;
export type MilestoneTrigger = (typeof MILESTONE_TRIGGERS)[number];

export const DOCUMENT_TYPES = ["brochure", "floor_plan", "fact_sheet", "price_sheet", "payment_plan", "site_plan", "regulatory", "other"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** internal: the developer only. partners: brokerages with document access to the project. */
export const DOCUMENT_VISIBILITIES = ["internal", "partners"] as const;
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];
