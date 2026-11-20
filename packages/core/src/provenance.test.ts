import { describe, expect, it } from "vitest";
import { availabilityLabel, type Provenance } from "./provenance";
import { formatMoney } from "./markets";

const base: Provenance = {
  sourceKind: "partner_feed",
  sourceId: "feed-1",
  ownerOrgId: "dev-1",
  lastUpdatedAt: "2026-11-19T08:00:00Z",
  lastVerifiedAt: "2026-11-19T08:00:00Z",
  verification: "verified",
  version: 3,
};
const now = new Date("2026-11-19T12:00:00Z");

describe("availabilityLabel", () => {
  it("never calls feed data live", () => {
    expect(availabilityLabel(base, now)).toBe("recently_confirmed");
  });
  it("calls authorized API data live only within its window", () => {
    const api = { ...base, sourceKind: "developer_api" as const, lastVerifiedAt: "2026-11-19T11:30:00Z" };
    expect(availabilityLabel(api, now)).toBe("live");
    expect(availabilityLabel({ ...api, lastVerifiedAt: "2026-11-19T09:00:00Z" }, now)).toBe("stale");
  });
  it("marks old feed data stale", () => {
    expect(availabilityLabel({ ...base, lastVerifiedAt: "2026-11-17T08:00:00Z" }, now)).toBe("stale");
  });
  it("treats anything not verified as unverified", () => {
    expect(availabilityLabel({ ...base, verification: "owner_reported" }, now)).toBe("unverified");
    expect(availabilityLabel({ ...base, lastVerifiedAt: undefined }, now)).toBe("unverified");
    expect(availabilityLabel({ ...base, verification: "disputed" }, now)).toBe("disputed");
  });
});

describe("formatMoney", () => {
  it("uses three minor digits for KWD", () => {
    expect(formatMoney({ amountMinor: 1500n, currency: "KWD" }, "en")).toContain("1.500");
  });
});
