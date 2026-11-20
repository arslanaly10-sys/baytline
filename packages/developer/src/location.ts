import {
  hasCapability, LOCATION_SOURCES, PLACE_CATEGORIES, PLACE_KINDS, PLACE_STAGES, placeDistance, toLatLng, withinGcc,
  type LatLng, type LocationSource, type MarketCode, type PlaceCategory, type PlaceDistance, type PlaceKind, type PlaceStage,
} from "@baytline/core";
import { withAppTx, type Client, type Db } from "@baytline/db";
import { fields, IdentityError, requireContext, writeAudit, type Actor } from "@baytline/identity";

/**
 * Project location profiles (milestone 8). Everything is recorded by people or imported from
 * files; no map or places provider is configured, so nothing is fetched or inferred. The owning
 * developer reads and manages; a partner brokerage reads only when its share includes location.
 */

export type LocationRecord = {
  address: string | null;
  area: string | null;
  coordinates: LatLng | null;
  sourceKind: LocationSource;
  sourceReference: string | null;
  verification: "unverified" | "verified";
  verifiedAt: Date | null;
  verifiedByName: string | null;
  updatedAt: Date;
  updatedByName: string | null;
};

export type PlaceRow = {
  id: string;
  kind: PlaceKind;
  category: PlaceCategory;
  name: string;
  description: string | null;
  coordinates: LatLng | null;
  recordedDistanceM: number | null;
  distance: PlaceDistance;
  stage: PlaceStage | null;
  expectedDate: string | null;
  developerName: string | null;
  sourceKind: LocationSource;
  sourceReference: string | null;
  verification: "unverified" | "verified";
  verifiedAt: Date | null;
  updatedAt: Date;
  updatedByName: string | null;
};

export type LocationFilters = { kind?: string; category?: string; maxDistance?: string };

export type LocationProfile = {
  project: { id: string; name: string; market: MarketCode; city: string; area: string | null; isSample: boolean };
  access: "owner" | "partner";
  location: LocationRecord | null;
  places: PlaceRow[];
  /** Places hidden by a distance filter because their distance isn't known. */
  hiddenWithoutDistance: number;
  totalPlaces: number;
  canManage: boolean;
  canVerify: boolean;
  sharedWithPartners: number | null; // owner only: active shares that include location
  shownPublicly: boolean | null; // owner only
};

const mapLocation = (r: Record<string, any>): LocationRecord => ({
  address: r.address,
  area: r.area,
  coordinates: toLatLng(r.latitude, r.longitude),
  sourceKind: r.source_kind,
  sourceReference: r.source_reference,
  verification: r.verification,
  verifiedAt: r.verified_at,
  verifiedByName: r.verified_by_name ?? null,
  updatedAt: r.updated_at,
  updatedByName: r.updated_by_name ?? null,
});

export function mapPlace(r: Record<string, any>, origin: LatLng | null): PlaceRow {
  const coordinates = toLatLng(r.latitude, r.longitude);
  return {
    id: r.id,
    kind: r.kind,
    category: r.category,
    name: r.name,
    description: r.description,
    coordinates,
    recordedDistanceM: r.recorded_distance_m,
    distance: placeDistance(origin, coordinates, r.recorded_distance_m),
    stage: r.stage,
    expectedDate: r.expected_date instanceof Date ? r.expected_date.toISOString().slice(0, 10) : r.expected_date ?? null,
    developerName: r.developer_name,
    sourceKind: r.source_kind,
    sourceReference: r.source_reference,
    verification: r.verification,
    verifiedAt: r.verified_at,
    updatedAt: r.updated_at,
    updatedByName: r.updated_by_name ?? null,
  };
}

/** Applies kind, category and distance filters; nearest first, unknown distances last. */
export function filterPlaces(all: PlaceRow[], s: LocationFilters): { places: PlaceRow[]; hiddenWithoutDistance: number } {
  let places = all;
  if (s.kind && (PLACE_KINDS as readonly string[]).includes(s.kind)) places = places.filter((p) => p.kind === s.kind);
  if (s.category) places = places.filter((p) => p.category === s.category);
  let hidden = 0;
  const max = Number(s.maxDistance);
  if (s.maxDistance && Number.isFinite(max) && max > 0) {
    hidden = places.filter((p) => !p.distance).length;
    places = places.filter((p) => p.distance && p.distance.meters <= max);
  }
  places = [...places].sort((a, b) => (a.distance?.meters ?? Infinity) - (b.distance?.meters ?? Infinity) || a.name.localeCompare(b.name));
  return { places, hiddenWithoutDistance: hidden };
}

async function loadProfile(c: Client, projectId: string, s: LocationFilters) {
  const loc = (await c.query(
    `select l.*, l.latitude::text as latitude, l.longitude::text as longitude, vu.display_name as verified_by_name, uu.display_name as updated_by_name
       from app.project_locations l left join app.users vu on vu.id = l.verified_by left join app.users uu on uu.id = l.updated_by
      where l.project_id = $1`, [projectId])).rows[0];
  const location = loc ? mapLocation(loc) : null;
  const rows = (await c.query(
    `select p.*, p.latitude::text as latitude, p.longitude::text as longitude, uu.display_name as updated_by_name
       from app.project_places p left join app.users uu on uu.id = p.updated_by
      where p.project_id = $1 and p.status = 'active' order by p.name`, [projectId])).rows;
  const all = rows.map((r) => mapPlace(r, location?.coordinates ?? null));
  return { location, all, ...filterPlaces(all, s) };
}

export async function getLocationProfile(db: Db, actor: Actor, projectId: string, s: LocationFilters = {}): Promise<LocationProfile> {
  const pid = fields.id(projectId);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireContext(c, actor);
    const can = (p: Parameters<typeof hasCapability>[1]) => hasCapability(ctx.principal, p);
    if (!can("area_profile.view")) throw new IdentityError("forbidden", "area_profile.view");
    let access: "owner" | "partner";
    if (ctx.org.type === "developer") access = "owner";
    else if (ctx.org.type === "brokerage") {
      // A partner sees the profile only when its share for this project includes location.
      const ok = (await c.query<{ ok: boolean }>("select app.shared_with_me($1, 'location') as ok", [pid])).rows[0]?.ok;
      if (!ok) throw new IdentityError("not_found");
      access = "partner";
    } else throw new IdentityError("not_found");
    const p = (await c.query("select id, name, market, city, location, is_sample, org_id from app.projects where id = $1", [pid])).rows[0];
    if (!p || (access === "owner" && p.org_id !== actor.orgId)) throw new IdentityError("not_found");
    const profile = await loadProfile(c, pid, s);
    const owner = access === "owner";
    return {
      project: { id: p.id, name: p.name, market: p.market, city: p.city, area: p.location, isSample: p.is_sample },
      access,
      location: profile.location,
      places: profile.places,
      hiddenWithoutDistance: profile.hiddenWithoutDistance,
      totalPlaces: profile.all.length,
      canManage: owner && can("area_profile.manage"),
      canVerify: owner && can("inventory.verify"),
      sharedWithPartners: owner ? (await c.query<{ n: number }>("select count(*)::int as n from app.project_shares where project_id = $1 and status = 'active' and include_location", [pid])).rows[0]!.n : null,
      shownPublicly: owner ? Boolean((await c.query("select 1 from app.project_publications where project_id = $1 and status = 'published' and show_location", [pid])).rowCount) : null,
    };
  });
}

/** One line per project for the Area profiles section. */
export type LocationSummary = { projectId: string; name: string; city: string; isSample: boolean; hasCoordinates: boolean; verification: "unverified" | "verified" | null; places: number; updatedAt: Date | null };

export async function listLocationSummaries(db: Db, actor: Actor): Promise<LocationSummary[]> {
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireContext(c, actor);
    if (ctx.org.type !== "developer") throw new IdentityError("not_found");
    if (!hasCapability(ctx.principal, "area_profile.view")) throw new IdentityError("forbidden", "area_profile.view");
    const { rows } = await c.query(
      `select p.id, p.name, p.city, p.is_sample, l.latitude is not null as has_coords, l.verification,
              (select count(*)::int from app.project_places x where x.project_id = p.id and x.status = 'active') as places,
              greatest(l.updated_at, (select max(updated_at) from app.project_places x where x.project_id = p.id)) as updated_at
         from app.projects p left join app.project_locations l on l.project_id = p.id
        where p.org_id = app.current_org_id() order by p.is_sample, p.name`);
    return rows.map((r) => ({ projectId: r.id, name: r.name, city: r.city, isSample: r.is_sample, hasCoordinates: r.has_coords ?? false, verification: r.verification, places: r.places, updatedAt: r.updated_at }));
  });
}

// ---------------------------------------------------------------- writes

async function requireManager(c: Client, actor: Actor, permission: "area_profile.manage" | "inventory.verify", projectId: string) {
  const ctx = await requireContext(c, actor);
  if (ctx.org.type !== "developer") throw new IdentityError("not_found");
  if (!hasCapability(ctx.principal, permission)) throw new IdentityError("forbidden", permission);
  const p = (await c.query("select id from app.projects where id = $1 and org_id = app.current_org_id()", [projectId])).rows[0];
  if (!p) throw new IdentityError("not_found");
}

const audit = (c: Client, actor: Actor, type: Parameters<typeof writeAudit>[1]["type"], target: { type: string; id: string }, metadata?: Record<string, string | number | boolean>) =>
  writeAudit(c, { type, outcome: "success", actorUserId: actor.userId, orgId: actor.orgId, target, metadata });

function coords(lat: unknown, lng: unknown, field: string): LatLng | null {
  const has = (v: unknown) => typeof v === "string" ? v.trim() !== "" : v !== null && v !== undefined;
  if (!has(lat) && !has(lng)) return null;
  const a = Number(typeof lat === "string" ? lat.trim() : lat), b = Number(typeof lng === "string" ? lng.trim() : lng);
  if (!has(lat) || !has(lng) || !Number.isFinite(a) || !Number.isFinite(b)) throw new IdentityError("invalid_input", field);
  const p = { lat: Math.round(a * 1e6) / 1e6, lng: Math.round(b * 1e6) / 1e6 };
  if (!withinGcc(p)) throw new IdentityError("invalid_input", "coordinates_outside_gcc");
  return p;
}

const source = (v: unknown): Exclude<LocationSource, "provider"> => {
  const s = v === undefined || v === "" ? "manual_entry" : fields.oneOf(v, LOCATION_SOURCES, "source_kind");
  // "provider" is reserved for a configured provider adapter; people can't claim it.
  if (s === "provider") throw new IdentityError("invalid_input", "source_kind");
  return s;
};

export type LocationInput = { address?: unknown; area?: unknown; latitude?: unknown; longitude?: unknown; sourceKind?: unknown; sourceReference?: unknown };

export async function saveLocation(db: Db, actor: Actor, projectId: string, i: LocationInput): Promise<string[]> {
  const pid = fields.id(projectId);
  const v = {
    address: fields.opt(i.address, 300, "address"),
    area: fields.opt(i.area, 120, "area"),
    coordinates: coords(i.latitude, i.longitude, "coordinates"),
    source_kind: source(i.sourceKind),
    source_reference: fields.opt(i.sourceReference, 300, "source_reference"),
  };
  return withAppTx(db, actor, async (c) => {
    await requireManager(c, actor, "area_profile.manage", pid);
    const prev = (await c.query("select *, latitude::float8 as lat, longitude::float8 as lng from app.project_locations where project_id = $1 for update", [pid])).rows[0];
    const changed: string[] = [];
    if (!prev || (prev.address ?? null) !== v.address) changed.push("address");
    if (!prev || (prev.area ?? null) !== v.area) changed.push("area");
    if (!prev || prev.lat !== (v.coordinates?.lat ?? null) || prev.lng !== (v.coordinates?.lng ?? null)) changed.push("coordinates");
    if (!prev || prev.source_kind !== v.source_kind || (prev.source_reference ?? null) !== v.source_reference) changed.push("source");
    if (prev && !changed.length) return [];
    // Any change to what was verified needs verifying again.
    await c.query(
      `insert into app.project_locations (project_id, org_id, address, area, latitude, longitude, source_kind, source_reference, created_by, updated_by)
       values ($1, app.current_org_id(), $2, $3, $4, $5, $6, $7, $8, $8)
       on conflict (project_id) do update set address = excluded.address, area = excluded.area, latitude = excluded.latitude, longitude = excluded.longitude,
              source_kind = excluded.source_kind, source_reference = excluded.source_reference, updated_at = now(), updated_by = excluded.updated_by,
              verification = 'unverified', verified_at = null, verified_by = null`,
      [pid, v.address, v.area, v.coordinates?.lat ?? null, v.coordinates?.lng ?? null, v.source_kind, v.source_reference, actor.userId],
    );
    await audit(c, actor, "location.updated", { type: "project", id: pid }, { fields: changed.join(",") });
    return changed;
  });
}

export async function verifyLocation(db: Db, actor: Actor, projectId: string): Promise<void> {
  const pid = fields.id(projectId);
  await withAppTx(db, actor, async (c) => {
    await requireManager(c, actor, "inventory.verify", pid);
    const r = await c.query(
      "update app.project_locations set verification = 'verified', verified_at = now(), verified_by = $2 where project_id = $1 and (latitude is not null or address is not null)",
      [pid, actor.userId],
    );
    if (!r.rowCount) throw new IdentityError("invalid_input", "nothing_to_verify");
    await audit(c, actor, "location.verified", { type: "project", id: pid });
  });
}

export type PlaceInput = {
  kind: unknown; category: unknown; name: unknown; description?: unknown; latitude?: unknown; longitude?: unknown;
  distanceKm?: unknown; stage?: unknown; expectedDate?: unknown; developerName?: unknown; sourceKind?: unknown; sourceReference?: unknown;
};

export function validatePlace(i: PlaceInput) {
  const kind = fields.oneOf(i.kind, PLACE_KINDS, "kind");
  const category = fields.oneOf(i.category, PLACE_CATEGORIES[kind] as readonly string[], "category") as PlaceCategory;
  const stages = PLACE_STAGES[kind] as readonly string[];
  const stage = i.stage === undefined || i.stage === "" || i.stage === null ? null : fields.oneOf(i.stage, stages, "stage");
  const dist = fields.optDecimal(i.distanceKm, "distance", { max: 200, places: 2 });
  const sourceReference = fields.opt(i.sourceReference, 300, "source_reference");
  if (kind !== "amenity" && !sourceReference) throw new IdentityError("invalid_input", "source_required");
  return {
    kind,
    category,
    name: fields.req(i.name, 160, "name"),
    description: fields.opt(i.description, 1000, "description", true),
    coordinates: coords(i.latitude, i.longitude, "coordinates"),
    recorded_distance_m: dist === null ? null : Math.round(Number(dist) * 1000),
    stage,
    expected_date: kind === "amenity" ? null : fields.optDate(i.expectedDate, "expected_date"),
    developer_name: kind === "competitor" ? fields.opt(i.developerName, 160, "developer_name") : null,
    source_kind: source(i.sourceKind),
    source_reference: sourceReference,
  };
}

type PlaceValues = ReturnType<typeof validatePlace>;
const placeArgs = (v: PlaceValues) => [v.kind, v.category, v.name, v.description, v.coordinates?.lat ?? null, v.coordinates?.lng ?? null, v.recorded_distance_m, v.stage, v.expected_date, v.developer_name, v.source_kind, v.source_reference];

async function insertPlace(c: Client, actor: Actor, pid: string, v: PlaceValues): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `insert into app.project_places (org_id, project_id, kind, category, name, description, latitude, longitude, recorded_distance_m, stage, expected_date,
            developer_name, source_kind, source_reference, created_by, updated_by)
     values (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14) returning id`,
    [pid, ...placeArgs(v), actor.userId],
  );
  return rows[0]!.id;
}

export async function createPlace(db: Db, actor: Actor, projectId: string, i: PlaceInput): Promise<string> {
  const pid = fields.id(projectId);
  const v = validatePlace(i);
  return withAppTx(db, actor, async (c) => {
    await requireManager(c, actor, "area_profile.manage", pid);
    const id = await insertPlace(c, actor, pid, v);
    await audit(c, actor, "place.created", { type: "project_place", id }, { kind: v.kind, category: v.category, source: v.source_kind });
    return id;
  });
}

export async function updatePlace(db: Db, actor: Actor, placeId: string, i: PlaceInput): Promise<string[]> {
  const id = fields.id(placeId);
  const v = validatePlace(i);
  return withAppTx(db, actor, async (c) => {
    const p = (await c.query("select *, latitude::float8 as lat, longitude::float8 as lng, expected_date::text as ed from app.project_places where id = $1 and status = 'active' for update", [id])).rows[0];
    if (!p) throw new IdentityError("not_found");
    await requireManager(c, actor, "area_profile.manage", p.project_id);
    const prev: Record<string, unknown> = { ...p, latitude: p.lat, longitude: p.lng, expected_date: p.ed };
    const next: Record<string, unknown> = { ...v, latitude: v.coordinates?.lat ?? null, longitude: v.coordinates?.lng ?? null };
    const keys = ["kind", "category", "name", "description", "latitude", "longitude", "recorded_distance_m", "stage", "expected_date", "developer_name", "source_kind", "source_reference"];
    const changed = keys.filter((k) => (prev[k] ?? null) !== (next[k] ?? null));
    if (!changed.length) return [];
    await c.query(
      `update app.project_places set kind = $2, category = $3, name = $4, description = $5, latitude = $6, longitude = $7, recorded_distance_m = $8,
              stage = $9, expected_date = $10, developer_name = $11, source_kind = $12, source_reference = $13, updated_at = now(), updated_by = $14,
              verification = 'unverified', verified_at = null, verified_by = null
        where id = $1`,
      [id, ...placeArgs(v), actor.userId],
    );
    await audit(c, actor, "place.updated", { type: "project_place", id }, { fields: changed.join(",") });
    return changed;
  });
}

async function placeProject(c: Client, id: string): Promise<string> {
  const p = (await c.query("select project_id from app.project_places where id = $1 and status = 'active'", [id])).rows[0];
  if (!p) throw new IdentityError("not_found");
  return p.project_id;
}

export async function verifyPlace(db: Db, actor: Actor, placeId: string): Promise<void> {
  const id = fields.id(placeId);
  await withAppTx(db, actor, async (c) => {
    await requireManager(c, actor, "inventory.verify", await placeProject(c, id));
    await c.query("update app.project_places set verification = 'verified', verified_at = now(), verified_by = $2 where id = $1", [id, actor.userId]);
    await audit(c, actor, "place.verified", { type: "project_place", id });
  });
}

export async function archivePlace(db: Db, actor: Actor, placeId: string): Promise<void> {
  const id = fields.id(placeId);
  await withAppTx(db, actor, async (c) => {
    await requireManager(c, actor, "area_profile.manage", await placeProject(c, id));
    await c.query("update app.project_places set status = 'archived', updated_at = now(), updated_by = $2 where id = $1", [id, actor.userId]);
    await audit(c, actor, "place.archived", { type: "project_place", id });
  });
}

// ---------------------------------------------------------------- import

export const IMPORT_COLUMNS = ["kind", "category", "name", "latitude", "longitude", "distance_km", "stage", "expected_date", "developer", "description", "source"] as const;
export const IMPORT_MAX_ROWS = 200;

/** Minimal CSV parser: commas, double-quoted fields with "" escapes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

export type ImportResult = { imported: number; errors: { line: number; field: string }[] };

/**
 * Imports places from CSV. Every row is checked first; if any row fails, nothing is imported and
 * the errors say which line and field. Imported rows are labelled "structured_import" and carry
 * the row's source, or the file-level source the person gave.
 */
export async function importPlaces(db: Db, actor: Actor, projectId: string, csv: unknown, fileSource: unknown): Promise<ImportResult> {
  const pid = fields.id(projectId);
  const text = typeof csv === "string" ? csv : "";
  const fallbackSource = fields.opt(fileSource, 300, "source_reference");
  if (!fallbackSource) throw new IdentityError("invalid_input", "import_source_required");
  const rows = parseCsv(text);
  if (rows.length < 2) throw new IdentityError("invalid_input", "import_empty");
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  if (!header.includes("kind") || !header.includes("category") || !header.includes("name")) throw new IdentityError("invalid_input", "import_header");
  if (rows.length - 1 > IMPORT_MAX_ROWS) throw new IdentityError("invalid_input", "import_too_many");
  const col = (r: string[], name: (typeof IMPORT_COLUMNS)[number]) => { const i = header.indexOf(name); return i >= 0 ? (r[i] ?? "").trim() : ""; };
  const valid: PlaceValues[] = [];
  const errors: ImportResult["errors"] = [];
  rows.slice(1).forEach((r, idx) => {
    try {
      valid.push(validatePlace({
        kind: col(r, "kind"), category: col(r, "category"), name: col(r, "name"), latitude: col(r, "latitude"), longitude: col(r, "longitude"),
        distanceKm: col(r, "distance_km"), stage: col(r, "stage"), expectedDate: col(r, "expected_date"), developerName: col(r, "developer"),
        description: col(r, "description"), sourceKind: "structured_import", sourceReference: col(r, "source") || fallbackSource,
      }));
    } catch (e) {
      errors.push({ line: idx + 2, field: e instanceof IdentityError ? e.detail ?? e.code : "row" });
    }
  });
  if (errors.length) return { imported: 0, errors };
  return withAppTx(db, actor, async (c) => {
    await requireManager(c, actor, "area_profile.manage", pid);
    for (const v of valid) await insertPlace(c, actor, pid, v);
    await audit(c, actor, "place.imported", { type: "project", id: pid }, { rows: valid.length });
    return { imported: valid.length, errors: [] };
  });
}
