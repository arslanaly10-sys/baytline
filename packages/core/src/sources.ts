import { DEFAULT_FRESHNESS_HOURS, type SourceKind } from "./provenance";

/**
 * Inventory sources (milestone 9). Every update to a developer's inventory comes through one of these,
 * and every change records which source it came from.
 */
export const SOURCE_TYPES = ["workspace", "partner", "file_import", "data_feed", "direct_integration"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Source types a developer can add (the workspace source is built in). */
export const ADDABLE_SOURCE_TYPES = ["file_import", "partner", "data_feed", "direct_integration"] as const satisfies readonly SourceType[];

/** Feeds and direct integrations connect to outside systems, so the platform approves them first. */
export const NEEDS_PLATFORM_APPROVAL: readonly SourceType[] = ["data_feed", "direct_integration"];

export const AUTHORIZATION_STATUSES = ["draft", "pending_approval", "authorized", "rejected", "suspended", "revoked"] as const;
export type AuthorizationStatus = (typeof AUTHORIZATION_STATUSES)[number];

/** How records from each source type are labelled in provenance. Only a direct integration can ever be "live". */
export const SOURCE_KIND_FOR: Record<SourceType, SourceKind> = {
  workspace: "partner_portal",
  partner: "partner_portal",
  file_import: "structured_import",
  data_feed: "partner_feed",
  direct_integration: "developer_api",
};

/** Default freshness window for a new source. A source may shorten it, never extend past its kind's default. */
export function defaultFreshnessHours(t: SourceType): number {
  return DEFAULT_FRESHNESS_HOURS[SOURCE_KIND_FOR[t]];
}

/** Secret names a source may reference. Values live in the server environment, never in the database or UI. */
export const SECRET_NAME_PATTERN = /^FEED_[A-Z0-9_]{2,60}$/;

// ---------------------------------------------------------------- connection health

export type SourceHealth =
  | "not_applicable" // workspace, partner and file sources have no connection
  | "no_adapter" // no adapter exists in code for this provider
  | "not_authorized" // not (or no longer) authorized
  | "platform_disabled" // platform administrators turned feeds off
  | "not_configured" // settings or secrets are missing
  | "never_synced" // ready, but no sync has succeeded yet
  | "failing" // latest attempt failed
  | "stale" // last success is older than the freshness window
  | "healthy";

export function deriveSourceHealth(
  s: {
    sourceType: SourceType;
    adapterAvailable: boolean;
    authorization: AuthorizationStatus;
    platformEnabled: boolean;
    configured: boolean;
    lastSuccessAt: Date | null;
    lastAttemptOk: boolean | null;
    freshnessHours: number;
  },
  now = new Date(),
): SourceHealth {
  if (s.sourceType !== "data_feed" && s.sourceType !== "direct_integration") return "not_applicable";
  if (!s.adapterAvailable) return "no_adapter";
  if (s.authorization !== "authorized") return "not_authorized";
  if (!s.platformEnabled) return "platform_disabled";
  if (!s.configured) return "not_configured";
  if (s.lastAttemptOk === false) return "failing";
  if (!s.lastSuccessAt) return "never_synced";
  const age = (now.getTime() - s.lastSuccessAt.getTime()) / 36e5;
  return age > s.freshnessHours || age < 0 ? "stale" : "healthy";
}

// ---------------------------------------------------------------- import record types and fields

export const IMPORT_RECORD_TYPES = ["units", "projects", "prices", "payment_plans"] as const;
export type ImportRecordType = (typeof IMPORT_RECORD_TYPES)[number];

export type ImportField = {
  key: string;
  /** Required on every row. */
  required?: boolean;
  /** Required only when the row creates a new record. */
  requiredForCreate?: boolean;
  /** Header spellings recognised when suggesting a mapping (lower-case, punctuation ignored). */
  aliases: readonly string[];
};

const f = (key: string, aliases: string[], extra: Partial<ImportField> = {}): ImportField => ({ key, aliases: [key, ...aliases], ...extra });

export const IMPORT_FIELDS: Record<ImportRecordType, readonly ImportField[]> = {
  units: [
    f("project", ["project name", "development"], { required: true }),
    f("code", ["unit", "unit code", "unit number", "unit no"], { required: true }),
    f("property_type", ["type", "unit type", "property type"], { requiredForCreate: true }),
    f("status", ["availability", "unit status"], { requiredForCreate: true }),
    f("bedrooms", ["beds", "bedroom", "bed"]),
    f("area_sqm", ["area", "size", "sqm", "area sqm", "size sqm"]),
    f("floor", ["level"]),
    f("phase", ["building", "phase name", "tower"]),
  ],
  projects: [
    f("project", ["project name", "name"], { required: true }),
    f("status", ["project status", "stage"]),
    f("launch_date", ["launch", "launch date"]),
    f("handover_date", ["handover", "completion", "handover date", "completion date"]),
    f("location", ["address", "area", "community"]),
  ],
  prices: [
    f("project", ["project name"], { required: true }),
    f("code", ["unit", "unit code", "unit number"], { required: true }),
    f("price_list", ["list", "price list", "list name"], { required: true }),
    f("price", ["amount", "list price", "asking price"], { required: true }),
    f("currency", ["ccy"]),
  ],
  payment_plans: [
    f("project", ["project name"], { required: true }),
    f("plan", ["plan name", "payment plan"], { required: true }),
    f("currency", ["ccy"], { required: true }),
    f("effective_from", ["effective", "valid from", "start date"], { required: true }),
    f("seq", ["step", "order", "milestone number", "no"], { required: true }),
    f("label", ["milestone", "description", "name"], { required: true }),
    f("trigger", ["due on", "when", "trigger kind"], { required: true }),
    f("due_date", ["date"]),
    f("progress_percent", ["construction percent", "progress"]),
    f("months_after_handover", ["months after handover", "months"]),
    f("percent", ["percentage", "pct", "share"]),
    f("amount", ["fixed amount", "value"]),
  ],
};

export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_BYTES = 2_000_000;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Suggests a column for each field by header name. A suggestion only; the person confirms the mapping. */
export function suggestMapping(recordType: ImportRecordType, headers: readonly string[]): Record<string, number | null> {
  const normalized = headers.map(norm);
  const used = new Set<number>();
  const out: Record<string, number | null> = {};
  for (const field of IMPORT_FIELDS[recordType]) {
    const idx = normalized.findIndex((h, i) => !used.has(i) && field.aliases.some((a) => norm(a) === h));
    out[field.key] = idx >= 0 ? idx : null;
    if (idx >= 0) used.add(idx);
  }
  return out;
}
