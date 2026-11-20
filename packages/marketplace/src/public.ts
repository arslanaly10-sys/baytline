import { placeDistance as _placeDistance, toLatLng as _toLatLng, type LatLng as _LatLng, type PlaceDistance as _PlaceDistance } from "@baytline/core";
import { availabilityLabel, COMPARE_LIMIT, MARKETS, isMarketCode, type AvailabilityLabel, type MarketCode, type SourceKind, type VerificationStatus } from "@baytline/core";
import { withAppTx, type Client, type Db } from "@baytline/db";
import { f, IdentityError, like } from "./guard";

/**
 * Public reads. They run on the app role with no user set, so row-level security hides every
 * table; only the published pub_* views (migration 0009) return rows. Nothing here needs, or
 * reveals, who is browsing.
 */
const publicTx = <T>(db: Db, fn: (c: Client) => Promise<T>) => withAppTx(db, { userId: null }, fn);

// ---------------------------------------------------------------- availability

/**
 * What a customer may be told about availability. Only "available_confirmed" may be described as
 * currently available; every other state says what is actually known.
 */
export type AvailabilityState =
  | "available_confirmed" // owner reports available and confirmed it within the source's freshness window
  | "available_unconfirmed" // owner reports available, never verified
  | "stale" // was confirmed, but not recently enough
  | "disputed"
  | "reserved"
  | "sold"
  | "not_offered";

export type Availability = { state: AvailabilityState; label: AvailabilityLabel; confirmedAt: Date | null };

export function unitAvailability(
  u: { status: string; sourceKind: SourceKind; verification: VerificationStatus; lastVerifiedAt: Date | null; lastUpdatedAt: Date; freshnessHours?: number | null; sourceAuthorized?: boolean },
  now: Date,
): Availability {
  const label = availabilityLabel(
    {
      sourceKind: u.sourceKind, sourceId: "", ownerOrgId: "", lastUpdatedAt: u.lastUpdatedAt.toISOString(), lastVerifiedAt: u.lastVerifiedAt?.toISOString(),
      verification: u.verification, version: 1, freshnessHours: u.freshnessHours, sourceAuthorized: u.sourceAuthorized,
    },
    now,
  );
  // A confirmation from a source that is no longer authorized isn't shown as one.
  const confirmedAt = u.verification === "verified" && u.sourceAuthorized !== false ? u.lastVerifiedAt : null;
  if (u.status === "reserved") return { state: "reserved", label, confirmedAt };
  if (u.status === "sold") return { state: "sold", label, confirmedAt };
  if (u.status !== "available") return { state: "not_offered", label, confirmedAt };
  const state: AvailabilityState =
    label === "live" || label === "recently_confirmed" ? "available_confirmed" : label === "stale" ? "stale" : label === "disputed" ? "disputed" : "available_unconfirmed";
  return { state, label, confirmedAt };
}

/** A rental listing counts as confirmed by the manager when published or reconfirmed (partner-portal freshness window). */
export function rentalAvailability(confirmedAt: Date, now: Date): Availability {
  const label = availabilityLabel(
    { sourceKind: "partner_portal", sourceId: "", ownerOrgId: "", lastUpdatedAt: confirmedAt.toISOString(), lastVerifiedAt: confirmedAt.toISOString(), verification: "verified", version: 1 },
    now,
  );
  return { state: label === "recently_confirmed" || label === "live" ? "available_confirmed" : "stale", label, confirmedAt };
}

// ---------------------------------------------------------------- shapes

export type PublicUnit = {
  kind: "unit";
  id: string;
  projectId: string;
  projectName: string;
  ownerName: string;
  market: MarketCode;
  city: string;
  location: string | null;
  phaseName: string | null;
  code: string;
  propertyType: string;
  bedrooms: number | null;
  areaSqm: string | null;
  floor: number | null;
  /** Approved price list in effect today, only when the developer chose to show prices. */
  price: { minor: string; currency: string; effectiveFrom: string } | null;
  /** Expected handover: the building's or phase's date if set, else the project's. Always an estimate unless the project is completed. */
  handover: { date: string; basis: "phase" | "project" } | null;
  verified: boolean;
  /** Where the unit's details come from (see provenance.ts). */
  sourceKind: SourceKind;
  availability: Availability;
  lastUpdatedAt: Date;
};

export type PublicRental = {
  kind: "rental";
  id: string;
  ownerName: string;
  propertyName: string;
  market: MarketCode;
  city: string;
  areaLabel: string | null;
  propertyType: string;
  unitType: string;
  bedrooms: number | null;
  areaSqm: string | null;
  floor: number | null;
  rent: { minor: string; currency: string; frequency: string };
  availableFrom: string | null;
  noticeGiven: boolean;
  description: string | null;
  availability: Availability;
  lastUpdatedAt: Date;
};

export type PublicProjectCard = {
  id: string;
  name: string;
  ownerName: string;
  market: MarketCode;
  city: string;
  location: string | null;
  propertyTypes: string[];
  status: string;
  handoverDate: string | null;
  currency: string;
  /** Lowest shown price among matching units; null when prices aren't shown or none match. */
  priceFrom: string | null;
  matchingUnits: number;
  confirmedAvailable: number;
  bedrooms: { min: number; max: number } | null;
  listingUpdatedAt: Date;
};

export type PublicPlan = {
  id: string;
  name: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  handoverTerms: string | null;
  milestones: { seq: number; label: string; trigger: string; dueDate: string | null; progressPercent: string | null; monthsAfterHandover: number | null; percent: string | null; amountMinor: string | null }[];
};

export type PublicProject = Omit<PublicProjectCard, "priceFrom" | "matchingUnits" | "confirmedAvailable" | "bedrooms"> & {
  description: string | null;
  launchDate: string | null;
  showPrices: boolean;
  showPaymentPlans: boolean;
  units: PublicUnit[];
  plans: PublicPlan[];
};

// ---------------------------------------------------------------- search

/** Types a customer can filter by: developer and rental vocabularies combined. */
export const PUBLIC_PROPERTY_TYPES = ["apartment", "villa", "townhouse", "penthouse", "duplex", "office", "retail", "plot", "storage"] as const;

export type SearchFilters = {
  purpose?: string;
  market?: string;
  q?: string;
  type?: string;
  minBedrooms?: string;
  minPrice?: string;
  maxPrice?: string;
  availability?: string; // "confirmed" | "" (any)
};

export type SearchResult =
  | { purpose: "buy"; projects: PublicProjectCard[]; priceFilter: "applied" | "needs_market" | "none" }
  | { purpose: "rent"; rentals: PublicRental[]; priceFilter: "applied" | "needs_market" | "none" };

const PERIODS_PER_YEAR: Record<string, number> = { monthly: 12, quarterly: 4, semi_annual: 2, annual: 1 };

function priceBounds(s: SearchFilters): { min: bigint | null; max: bigint | null; status: "applied" | "needs_market" | "none" } {
  const wants = Boolean(s.minPrice?.trim() || s.maxPrice?.trim());
  if (!wants) return { min: null, max: null, status: "none" };
  if (!s.market || !isMarketCode(s.market)) return { min: null, max: null, status: "needs_market" };
  const currency = MARKETS.find((m) => m.code === s.market)!.currency;
  return { min: f.parseMoney(s.minPrice, currency, "min_price"), max: f.parseMoney(s.maxPrice, currency, "max_price"), status: "applied" };
}

const mapUnit = (r: Record<string, any>, now: Date): PublicUnit => ({
  kind: "unit",
  id: r.id,
  projectId: r.project_id,
  projectName: r.project_name,
  ownerName: r.owner_name,
  market: r.market,
  city: r.city,
  location: r.location,
  phaseName: r.phase_name,
  code: r.code,
  propertyType: r.property_type,
  bedrooms: r.bedrooms,
  areaSqm: r.area_sqm,
  floor: r.floor,
  price: r.price_minor ? { minor: String(r.price_minor), currency: r.price_currency, effectiveFrom: r.price_effective_from } : null,
  handover: r.phase_expected_handover ? { date: r.phase_expected_handover, basis: "phase" } : r.project_handover_date ? { date: r.project_handover_date, basis: "project" } : null,
  verified: r.verification === "verified",
  sourceKind: r.source_kind,
  availability: unitAvailability({ status: r.status, sourceKind: r.source_kind, verification: r.verification, lastVerifiedAt: r.last_verified_at, lastUpdatedAt: r.last_updated_at, freshnessHours: r.source_freshness_hours, sourceAuthorized: r.source_authorized }, now),
  lastUpdatedAt: r.last_updated_at,
});

const mapRental = (r: Record<string, any>, now: Date): PublicRental => ({
  kind: "rental",
  id: r.id,
  ownerName: r.owner_name,
  propertyName: r.property_name,
  market: r.market,
  city: r.city,
  areaLabel: r.area_label,
  propertyType: r.property_type,
  unitType: r.unit_type,
  bedrooms: r.bedrooms,
  areaSqm: r.area_sqm,
  floor: r.floor,
  rent: { minor: r.asking_rent_minor, currency: r.currency, frequency: r.payment_frequency },
  availableFrom: r.available_from,
  noticeGiven: r.occupancy === "notice_given",
  description: r.description,
  availability: rentalAvailability(r.confirmed_at, now),
  lastUpdatedAt: r.listing_updated_at,
});

function unitWhere(s: SearchFilters, args: unknown[], alias = "u"): string[] {
  const w: string[] = [];
  if (s.market && isMarketCode(s.market)) w.push(`${alias}.market = $${args.push(s.market)}`);
  if (s.q?.trim()) {
    const n = args.push(like(s.q));
    w.push(`(${alias}.city ilike $${n} or ${alias}.location ilike $${n} or ${alias}.project_name ilike $${n})`);
  }
  if (s.type && (PUBLIC_PROPERTY_TYPES as readonly string[]).includes(s.type)) w.push(`${alias}.property_type = $${args.push(s.type)}`);
  const beds = Number(s.minBedrooms);
  if (s.minBedrooms && Number.isInteger(beds) && beds >= 0 && beds <= 20) w.push(`${alias}.bedrooms >= $${args.push(beds)}`);
  return w;
}

export async function searchListings(db: Db, s: SearchFilters, now = new Date()): Promise<SearchResult> {
  const purpose = s.purpose === "rent" ? "rent" : "buy";
  const bounds = priceBounds(s);
  return publicTx(db, async (c) => {
    if (purpose === "rent") {
      const args: unknown[] = [];
      const w = ["true"];
      if (s.market && isMarketCode(s.market)) w.push(`r.market = $${args.push(s.market)}`);
      if (s.q?.trim()) {
        const n = args.push(like(s.q));
        w.push(`(r.city ilike $${n} or r.area_label ilike $${n} or r.property_name ilike $${n})`);
      }
      if (s.type && (PUBLIC_PROPERTY_TYPES as readonly string[]).includes(s.type)) w.push(`r.unit_type = $${args.push(s.type)}`);
      const beds = Number(s.minBedrooms);
      if (s.minBedrooms && Number.isInteger(beds) && beds >= 0 && beds <= 20) w.push(`r.bedrooms >= $${args.push(beds)}`);
      const { rows } = await c.query(`select * from app.pub_rentals r where ${w.join(" and ")} order by r.listing_updated_at desc limit 200`, args);
      let rentals = rows.map((r) => mapRental(r, now));
      if (bounds.status === "applied") {
        // Price filter compares the yearly equivalent, since listings use different payment frequencies.
        rentals = rentals.filter((r) => {
          const per = PERIODS_PER_YEAR[r.rent.frequency];
          if (!per) return false;
          const yearly = BigInt(r.rent.minor) * BigInt(per);
          return (bounds.min === null || yearly >= bounds.min) && (bounds.max === null || yearly <= bounds.max);
        });
      }
      if (s.availability === "confirmed") rentals = rentals.filter((r) => r.availability.state === "available_confirmed");
      return { purpose, rentals, priceFilter: bounds.status };
    }

    const args: unknown[] = [];
    const w = unitWhere(s, args);
    const unitFilters = Boolean(s.type || s.minBedrooms || bounds.status === "applied" || s.availability === "confirmed");
    const { rows: unitRows } = await c.query(`select * from app.pub_units u ${w.length ? `where ${w.join(" and ")}` : ""} limit 2000`, args);
    let units = unitRows.map((r) => mapUnit(r, now));
    if (bounds.status === "applied") {
      units = units.filter((u) => u.price && (bounds.min === null || BigInt(u.price.minor) >= bounds.min) && (bounds.max === null || BigInt(u.price.minor) <= bounds.max));
    }
    if (s.availability === "confirmed") units = units.filter((u) => u.availability.state === "available_confirmed");

    const pargs: unknown[] = [];
    const pw: string[] = [];
    if (s.market && isMarketCode(s.market)) pw.push(`p.market = $${pargs.push(s.market)}`);
    if (s.q?.trim()) {
      const n = pargs.push(like(s.q));
      pw.push(`(p.city ilike $${n} or p.location ilike $${n} or p.name ilike $${n})`);
    }
    const { rows: projRows } = await c.query(`select * from app.pub_projects p ${pw.length ? `where ${pw.join(" and ")}` : ""} order by p.listing_updated_at desc limit 500`, pargs);
    const byProject = new Map<string, PublicUnit[]>();
    for (const u of units) byProject.set(u.projectId, [...(byProject.get(u.projectId) ?? []), u]);
    const projects: PublicProjectCard[] = [];
    for (const p of projRows) {
      const matching = byProject.get(p.id) ?? [];
      // With unit-level filters, a project appears only if some published unit matches them.
      if (unitFilters && matching.length === 0) continue;
      const prices = matching.map((u) => u.price && BigInt(u.price.minor)).filter((x): x is bigint => x !== null && x !== undefined);
      const beds = matching.map((u) => u.bedrooms).filter((x): x is number => x !== null);
      projects.push({
        id: p.id,
        name: p.name,
        ownerName: p.owner_name,
        market: p.market,
        city: p.city,
        location: p.location,
        propertyTypes: p.property_types,
        status: p.status,
        handoverDate: p.handover_date ? String(p.handover_date instanceof Date ? p.handover_date.toISOString().slice(0, 10) : p.handover_date) : null,
        currency: p.currency,
        priceFrom: prices.length ? prices.reduce((a, b) => (a < b ? a : b)).toString() : null,
        matchingUnits: matching.length,
        confirmedAvailable: matching.filter((u) => u.availability.state === "available_confirmed").length,
        bedrooms: beds.length ? { min: Math.min(...beds), max: Math.max(...beds) } : null,
        listingUpdatedAt: p.listing_updated_at,
      });
    }
    return { purpose, projects, priceFilter: bounds.status };
  });
}

// ---------------------------------------------------------------- detail pages

const dateText = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

export async function getPublicProject(db: Db, projectId: string, now = new Date()): Promise<PublicProject> {
  const pid = f.id(projectId);
  return publicTx(db, async (c) => {
    const { rows } = await c.query("select * from app.pub_projects where id = $1", [pid]);
    const p = rows[0];
    if (!p) throw new IdentityError("not_found");
    const units = (await c.query("select * from app.pub_units where project_id = $1 order by property_type, bedrooms nulls last, code", [pid])).rows.map((r) => mapUnit(r, now));
    const plans = p.show_payment_plans
      ? (await c.query("select * from app.pub_plans where project_id = $1 order by name", [pid])).rows.map((r) => ({
          id: r.id, name: r.name, currency: r.currency, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, handoverTerms: r.handover_terms, milestones: r.milestones,
        }))
      : [];
    return {
      id: p.id,
      name: p.name,
      ownerName: p.owner_name,
      market: p.market,
      city: p.city,
      location: p.location,
      propertyTypes: p.property_types,
      status: p.status,
      handoverDate: dateText(p.handover_date),
      launchDate: dateText(p.launch_date),
      currency: p.currency,
      description: p.description,
      showPrices: p.show_prices,
      showPaymentPlans: p.show_payment_plans,
      listingUpdatedAt: p.listing_updated_at,
      units,
      plans,
    };
  });
}

export async function getPublicRental(db: Db, unitId: string, now = new Date()): Promise<PublicRental> {
  const uid = f.id(unitId);
  return publicTx(db, async (c) => {
    const { rows } = await c.query("select * from app.pub_rentals where id = $1", [uid]);
    if (!rows[0]) throw new IdentityError("not_found");
    return mapRental(rows[0], now);
  });
}

// ---------------------------------------------------------------- comparison

/** Where a compared fact comes from. Only "confirmed" facts were checked by the owner or approved by two people. */
export type FactBasis = "confirmed" | "owner_reported" | "estimate" | "missing";
export type Fact<T> = { value: T | null; basis: FactBasis };

export type CompareItem = {
  ref: string; // "unit:<id>" | "rental:<id>"
  kind: "unit" | "rental";
  title: string;
  ownerName: string;
  market: MarketCode;
  href: { kind: "unit"; projectId: string; unitId: string } | { kind: "rental"; id: string };
  price: Fact<{ minor: string; currency: string; frequency?: string }>;
  location: Fact<string>;
  propertyType: Fact<string>;
  areaSqm: Fact<string>;
  bedrooms: Fact<number>;
  handover: Fact<{ date: string; basis: "phase" | "project"; completed: boolean }>;
  lease: Fact<{ frequency: string; availableFrom: string | null; noticeGiven: boolean }>;
  paymentPlans: Fact<{ name: string; milestones: number; handoverTerms: string | null }[]>;
  availability: Availability;
  lastUpdatedAt: Date;
};

const fact = <T>(value: T | null | undefined, basis: Exclude<FactBasis, "missing">): Fact<T> => (value === null || value === undefined || value === "" ? { value: null, basis: "missing" } : { value, basis });

/** Parses "unit:<uuid>,rental:<uuid>" style references; ignores anything malformed or duplicated; caps at COMPARE_LIMIT. */
export function parseCompareRefs(raw: string | string[] | undefined): { kind: "unit" | "rental"; id: string }[] {
  const parts = (Array.isArray(raw) ? raw.join(",") : raw ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const out: { kind: "unit" | "rental"; id: string }[] = [];
  for (const p of parts) {
    const [kind, id] = p.split(":");
    if ((kind !== "unit" && kind !== "rental") || !id || !/^[0-9a-f-]{36}$/i.test(id)) continue;
    if (out.some((o) => o.kind === kind && o.id === id)) continue;
    out.push({ kind, id });
    if (out.length >= COMPARE_LIMIT) break;
  }
  return out;
}

export async function compareListings(db: Db, refs: { kind: "unit" | "rental"; id: string }[], now = new Date()): Promise<CompareItem[]> {
  return publicTx(db, async (c) => {
    const items: CompareItem[] = [];
    for (const r of refs.slice(0, COMPARE_LIMIT)) {
      if (r.kind === "unit") {
        const row = (await c.query("select u.*, p.status as project_status from app.pub_units u join app.pub_projects p on p.id = u.project_id where u.id = $1", [r.id])).rows[0];
        if (!row) continue; // withdrawn since it was added: dropped, the page says so
        const u = mapUnit(row, now);
        const plans = (await c.query("select name, handover_terms, jsonb_array_length(milestones) as n from app.pub_plans where project_id = $1 order by name", [u.projectId])).rows;
        const basis = u.verified ? "confirmed" : "owner_reported";
        items.push({
          ref: `unit:${u.id}`,
          kind: "unit",
          title: `${u.projectName} · ${u.code}`,
          ownerName: u.ownerName,
          market: u.market,
          href: { kind: "unit", projectId: u.projectId, unitId: u.id },
          price: u.price ? { value: { minor: u.price.minor, currency: u.price.currency }, basis: "confirmed" } : { value: null, basis: "missing" },
          location: fact([u.location, u.city].filter(Boolean).join(", "), "owner_reported"),
          propertyType: fact(u.propertyType, basis),
          areaSqm: fact(u.areaSqm, basis),
          bedrooms: fact(u.bedrooms, basis),
          handover: u.handover ? { value: { ...u.handover, completed: row.project_status === "completed" }, basis: row.project_status === "completed" ? "owner_reported" : "estimate" } : { value: null, basis: "missing" },
          lease: { value: null, basis: "missing" },
          paymentPlans: plans.length ? { value: plans.map((p) => ({ name: p.name, milestones: p.n, handoverTerms: p.handover_terms })), basis: "confirmed" } : { value: null, basis: "missing" },
          availability: u.availability,
          lastUpdatedAt: u.lastUpdatedAt,
        });
      } else {
        const row = (await c.query("select * from app.pub_rentals where id = $1", [r.id])).rows[0];
        if (!row) continue;
        const x = mapRental(row, now);
        items.push({
          ref: `rental:${x.id}`,
          kind: "rental",
          title: `${x.propertyName}${x.areaLabel ? ` · ${x.areaLabel}` : ""}`,
          ownerName: x.ownerName,
          market: x.market,
          href: { kind: "rental", id: x.id },
          price: { value: { minor: x.rent.minor, currency: x.rent.currency, frequency: x.rent.frequency }, basis: "owner_reported" },
          location: fact([x.areaLabel, x.city].filter(Boolean).join(", "), "owner_reported"),
          propertyType: fact(x.unitType, "owner_reported"),
          areaSqm: fact(x.areaSqm, "owner_reported"),
          bedrooms: fact(x.bedrooms, "owner_reported"),
          handover: { value: null, basis: "missing" },
          lease: { value: { frequency: x.rent.frequency, availableFrom: x.availableFrom, noticeGiven: x.noticeGiven }, basis: "owner_reported" },
          paymentPlans: { value: null, basis: "missing" },
          availability: x.availability,
          lastUpdatedAt: x.lastUpdatedAt,
        });
      }
    }
    return items;
  });
}

// ---------------------------------------------------------------- market display settings

export type PublicMarket = { code: MarketCode; name: { en: string; ar: string }; currency: string; timeZone: string; numberingSystem: "latn" | "arab"; dateStyle: "short" | "medium" | "long" };

/** Enabled markets with their display settings, for formatting on public pages. */
export async function listPublicMarkets(db: Db): Promise<PublicMarket[]> {
  return publicTx(db, async (c) =>
    (await c.query("select * from app.pub_markets order by code")).rows.map((r) => ({
      code: r.code, name: { en: r.name_en, ar: r.name_ar }, currency: r.currency, timeZone: r.time_zone, numberingSystem: r.numbering_system, dateStyle: r.date_style,
    })),
  );
}

// ---------------------------------------------------------------- location profile (milestone 8)


export type PublicPlace = {
  id: string; kind: string; category: string; name: string; description: string | null; coordinates: _LatLng | null; distance: _PlaceDistance;
  stage: string | null; expectedDate: string | null; developerName: string | null; sourceKind: string; sourceReference: string | null;
  verification: "unverified" | "verified"; updatedAt: Date;
};
export type PublicLocation = {
  address: string | null; area: string | null; coordinates: _LatLng | null; sourceKind: string; sourceReference: string | null;
  verification: "unverified" | "verified"; verifiedAt: Date | null; updatedAt: Date; places: PublicPlace[];
};

/** The location profile of a published project, only when its developer chose to show it. Null otherwise. */
export async function getPublicLocation(db: Db, projectId: string): Promise<PublicLocation | null> {
  const pid = f.id(projectId);
  return publicTx(db, async (c) => {
    const l = (await c.query("select * from app.pub_locations where project_id = $1", [pid])).rows[0];
    const places = (await c.query("select * from app.pub_places where project_id = $1 order by name", [pid])).rows;
    if (!l && !places.length) return null;
    const origin = l ? _toLatLng(l.latitude, l.longitude) : null;
    return {
      address: l?.address ?? null, area: l?.area ?? null, coordinates: origin, sourceKind: l?.source_kind ?? "manual_entry", sourceReference: l?.source_reference ?? null,
      verification: l?.verification ?? "unverified", verifiedAt: l?.verified_at ?? null, updatedAt: l?.updated_at ?? new Date(0),
      places: places
        .map((r) => {
          const coordinates = _toLatLng(r.latitude, r.longitude);
          return {
            id: r.id, kind: r.kind, category: r.category, name: r.name, description: r.description, coordinates,
            distance: _placeDistance(origin, coordinates, r.recorded_distance_m), stage: r.stage, expectedDate: r.expected_date,
            developerName: r.developer_name, sourceKind: r.source_kind, sourceReference: r.source_reference, verification: r.verification, updatedAt: r.updated_at,
          };
        })
        .sort((a, b) => (a.distance?.meters ?? Infinity) - (b.distance?.meters ?? Infinity)),
    };
  });
}
