/** Location vocabulary (milestone 8). Stored as text with matching CHECK constraints in migration 0012. */

export const PLACE_KINDS = ["amenity", "infrastructure", "competitor"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export const PLACE_CATEGORIES = {
  amenity: ["transport", "school", "healthcare", "retail", "leisure", "worship", "park", "government", "other"],
  infrastructure: ["road", "rail", "utility", "public_facility", "transport", "other"],
  competitor: ["residential", "mixed_use", "commercial", "other"],
} as const satisfies Record<PlaceKind, readonly string[]>;
export type PlaceCategory = (typeof PLACE_CATEGORIES)[PlaceKind][number];
export const ALL_PLACE_CATEGORIES = [...new Set(Object.values(PLACE_CATEGORIES).flat())] as PlaceCategory[];

export const PLACE_STAGES = {
  amenity: [],
  infrastructure: ["announced", "planned", "under_construction", "operational"],
  competitor: ["announced", "launched", "under_construction", "completed"],
} as const satisfies Record<PlaceKind, readonly string[]>;
export type PlaceStage = "announced" | "planned" | "under_construction" | "operational" | "launched" | "completed";

/** Where a location record came from. "provider" is reserved for a configured map or places provider. */
export const LOCATION_SOURCES = ["manual_entry", "structured_import", "provider"] as const;
export type LocationSource = (typeof LOCATION_SOURCES)[number];

/** Distance filters offered in lists, in metres. */
export const DISTANCE_STEPS = [500, 1000, 2000, 5000, 10000] as const;

export type LatLng = { lat: number; lng: number };

/** Great-circle (straight-line) distance in metres. Not a travel distance or time. */
export function straightLineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * Broad box around the six GCC markets. Coordinates outside it are almost always a typo or
 * swapped latitude/longitude, so they're refused rather than saved.
 */
export const GCC_BOUNDS = { minLat: 12, maxLat: 33, minLng: 34, maxLng: 61 } as const;
export function withinGcc(p: LatLng): boolean {
  return p.lat >= GCC_BOUNDS.minLat && p.lat <= GCC_BOUNDS.maxLat && p.lng >= GCC_BOUNDS.minLng && p.lng <= GCC_BOUNDS.maxLng;
}

export type PlaceDistance = { meters: number; basis: "computed" | "recorded" } | null;

/**
 * Distance of a place from the project: straight-line from coordinates when both are recorded,
 * otherwise the distance a person recorded, otherwise unknown. Never estimated.
 */
export function placeDistance(project: LatLng | null, place: LatLng | null, recordedMeters: number | null): PlaceDistance {
  if (project && place) return { meters: straightLineMeters(project, place), basis: "computed" };
  if (recordedMeters !== null && recordedMeters !== undefined) return { meters: recordedMeters, basis: "recorded" };
  return null;
}

export const toLatLng = (lat: unknown, lng: unknown): LatLng | null =>
  lat === null || lat === undefined || lng === null || lng === undefined || lat === "" || lng === "" ? null : { lat: Number(lat), lng: Number(lng) };
