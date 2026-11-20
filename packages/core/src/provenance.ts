/**
 * Inventory provenance. Every availability/price record carries where it came
 * from, when it was last confirmed, and its verification state. The UI must
 * never present a record as "live" unless `availabilityLabel` says so.
 */
export type SourceKind =
  | "developer_api" // authorized, contracted API
  | "partner_feed" // scheduled file/feed delivered by the owner
  | "structured_import" // spreadsheet/CSV uploaded by an authorized user
  | "partner_portal" // owner staff updating directly in our workspace
  | "manual_entry"; // platform staff on documented owner instruction

export type VerificationStatus =
  | "verified" // confirmed by the owning organization (or its authorized feed)
  | "owner_reported" // supplied by the owner, not yet confirmed for this cycle
  | "pending" // awaiting review
  | "unverified" // supplied by a third party without owner confirmation
  | "disputed"; // conflicting information under review

export type Provenance = {
  sourceKind: SourceKind;
  sourceId: string;
  /** Organization accountable for the data. */
  ownerOrgId: string;
  lastUpdatedAt: string; // ISO timestamp from the source
  lastVerifiedAt?: string;
  verification: VerificationStatus;
  /** Monotonic version; full history lives in the change log. */
  version: number;
};

export type ChangeLogEntry = {
  version: number;
  at: string;
  actor: { kind: "human" | "integration"; id: string };
  field: string;
  from: unknown;
  to: unknown;
  sourceKind: SourceKind;
};

/** Per-source freshness windows (hours). Admin-configurable later; conservative defaults. */
export const DEFAULT_FRESHNESS_HOURS: Record<SourceKind, number> = {
  developer_api: 1,
  partner_feed: 24,
  partner_portal: 24,
  structured_import: 72,
  manual_entry: 72,
};

export type AvailabilityLabel = "live" | "recently_confirmed" | "stale" | "unverified" | "disputed";

export function availabilityLabel(
  p: Provenance & { isSample?: boolean },
  now: Date,
  freshness: Record<SourceKind, number> = DEFAULT_FRESHNESS_HOURS,
): AvailabilityLabel {
  // Sample records are never presented as confirmed availability, whatever their fields say.
  if (p.isSample) return "unverified";
  if (p.verification === "disputed") return "disputed";
  if (p.verification !== "verified" || !p.lastVerifiedAt) return "unverified";
  const ageHours = (now.getTime() - new Date(p.lastVerifiedAt).getTime()) / 36e5;
  const window = freshness[p.sourceKind];
  if (ageHours < 0 || Number.isNaN(ageHours)) return "unverified";
  if (ageHours > window) return "stale";
  // Only a real-time authorized API can be called live.
  return p.sourceKind === "developer_api" ? "live" : "recently_confirmed";
}
