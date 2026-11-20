import { describe, expect, it } from "vitest";
import { availabilityLabel } from "./provenance";
import { defaultFreshnessHours, deriveSourceHealth, suggestMapping } from "./sources";

const now = new Date("2026-11-20T12:00:00Z");
const base = { sourceType: "data_feed" as const, adapterAvailable: true, authorization: "authorized" as const, platformEnabled: true, configured: true, lastSuccessAt: null, lastAttemptOk: null, freshnessHours: 24 };

describe("source health", () => {
  it("never calls a source healthy without a recent successful sync", () => {
    expect(deriveSourceHealth(base, now)).toBe("never_synced");
    expect(deriveSourceHealth({ ...base, lastSuccessAt: new Date("2026-11-20T06:00:00Z"), lastAttemptOk: true }, now)).toBe("healthy");
    expect(deriveSourceHealth({ ...base, lastSuccessAt: new Date("2026-11-18T06:00:00Z"), lastAttemptOk: true }, now)).toBe("stale");
    expect(deriveSourceHealth({ ...base, lastSuccessAt: new Date("2026-11-20T06:00:00Z"), lastAttemptOk: false }, now)).toBe("failing");
  });
  it("reports exactly what is missing, in order", () => {
    expect(deriveSourceHealth({ ...base, adapterAvailable: false }, now)).toBe("no_adapter");
    expect(deriveSourceHealth({ ...base, authorization: "pending_approval" }, now)).toBe("not_authorized");
    expect(deriveSourceHealth({ ...base, platformEnabled: false }, now)).toBe("platform_disabled");
    expect(deriveSourceHealth({ ...base, configured: false }, now)).toBe("not_configured");
    expect(deriveSourceHealth({ ...base, sourceType: "file_import" }, now)).toBe("not_applicable");
  });
  it("uses each kind's default freshness", () => {
    expect(defaultFreshnessHours("direct_integration")).toBe(1);
    expect(defaultFreshnessHours("file_import")).toBe(72);
  });
});

describe("mapping suggestions", () => {
  it("matches common header spellings, each column once", () => {
    const m = suggestMapping("units", ["Project Name", "Unit No", "Type", "Availability", "Beds", "Size (sqm)", "Unit"]);
    expect(m).toMatchObject({ project: 0, code: 1, property_type: 2, status: 3, bedrooms: 4, area_sqm: 5, floor: null });
  });
});

describe("freshness per source", () => {
  const p = { sourceKind: "structured_import" as const, sourceId: "s", ownerOrgId: "o", lastUpdatedAt: now.toISOString(), verification: "verified" as const, version: 1 };
  it("a source can shorten the window, never extend it", () => {
    const at = new Date(now.getTime() - 30 * 36e5).toISOString();
    expect(availabilityLabel({ ...p, lastVerifiedAt: at }, now)).toBe("recently_confirmed");
    expect(availabilityLabel({ ...p, lastVerifiedAt: at, freshnessHours: 24 }, now)).toBe("stale");
    const old = new Date(now.getTime() - 100 * 36e5).toISOString();
    expect(availabilityLabel({ ...p, lastVerifiedAt: old, freshnessHours: 168 }, now)).toBe("stale");
  });
  it("confirmations from a source that is no longer authorized don't count", () => {
    expect(availabilityLabel({ ...p, lastVerifiedAt: now.toISOString(), sourceAuthorized: false }, now)).toBe("unverified");
  });
  it("only a direct integration is ever live", () => {
    expect(availabilityLabel({ ...p, sourceKind: "partner_feed", lastVerifiedAt: now.toISOString() }, now)).toBe("recently_confirmed");
    expect(availabilityLabel({ ...p, sourceKind: "developer_api", lastVerifiedAt: now.toISOString() }, now)).toBe("live");
  });
});
