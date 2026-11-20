import { describe, expect, it } from "vitest";
import { ALL_PLACE_CATEGORIES, straightLineMeters, withinGcc } from "./geo";

describe("geo", () => {
  it("measures straight-line distance", () => {
    expect(straightLineMeters({ lat: 25.2, lng: 55.27 }, { lat: 25.2, lng: 55.27 })).toBe(0);
    const d = straightLineMeters({ lat: 25.0, lng: 55.0 }, { lat: 25.01, lng: 55.0 }); // ~1.11 km per 0.01 degree of latitude
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1120);
  });
  it("refuses coordinates outside the Gulf (usually swapped)", () => {
    expect(withinGcc({ lat: 25.2, lng: 55.27 })).toBe(true);
    expect(withinGcc({ lat: 55.27, lng: 25.2 })).toBe(false);
  });
  it("lists every category once", () => {
    expect(new Set(ALL_PLACE_CATEGORIES).size).toBe(ALL_PLACE_CATEGORIES.length);
  });
});

import { placeDistance } from "./geo";
describe("place distance", () => {
  it("computes from coordinates, else uses the recorded value, else is unknown", () => {
    expect(placeDistance({ lat: 25, lng: 55 }, { lat: 25.01, lng: 55 }, 9999)?.basis).toBe("computed");
    expect(placeDistance({ lat: 25, lng: 55 }, null, 800)).toEqual({ meters: 800, basis: "recorded" });
    expect(placeDistance(null, { lat: 25, lng: 55 }, null)).toBeNull();
  });
});
