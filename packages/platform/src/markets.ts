import { isMarketCode, LOCALES, type MarketCode, type UiLocale } from "@baytline/core";
import { withAppTx, type Db } from "@baytline/db";
import { IdentityError, writeAudit, type Actor } from "@baytline/identity";
import { requirePlatform } from "./guard";

/**
 * Market configuration lives in the database (app.markets) and is edited by
 * platform administrators. UI components read it from here; nothing country-specific
 * is hardcoded in pages.
 */
export type MarketConfig = {
  code: MarketCode;
  name: Record<UiLocale, string>;
  currency: string;
  /** Derived from the currency via Intl, e.g. 3 for KWD. */
  currencyDigits: number;
  timeZone: string;
  weekendDays: number[];
  defaultLocale: UiLocale;
  supportedLocales: string[];
  numberingSystem: "latn" | "arab";
  dateStyle: "short" | "medium" | "long";
  status: "enabled" | "disabled";
  notes: string | null;
  updatedAt: Date | null;
  updatedByName: string | null;
  rulesNeedingSetup: number;
  rulesTotal: number;
};

export const RULE_CATEGORIES = [
  "property_transfer_fee",
  "property_registration_fee",
  "vat_treatment",
  "broker_licensing",
  "broker_commission",
  "escrow_requirements",
  "off_plan_payment_plans",
  "foreign_ownership",
  "tenancy_registration",
  "rent_increase",
  "security_deposit",
  "mortgage_financing",
] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export type MarketRule = {
  category: RuleCategory;
  status: "needs_setup" | "configured";
  sourceReference: string | null;
  effectiveFrom: string | null;
};

const CURRENCIES = new Set(Intl.supportedValuesOf("currency"));
const ZONES = new Set(Intl.supportedValuesOf("timeZone"));
const LOCALE_CODES = LOCALES.map((l) => l.code) as string[];

export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

function mapRow(r: Record<string, any>): MarketConfig {
  return {
    code: r.code,
    name: { en: r.name_en, ar: r.name_ar },
    currency: r.currency,
    currencyDigits: currencyDigits(r.currency),
    timeZone: r.time_zone,
    weekendDays: r.weekend_days,
    defaultLocale: r.default_locale,
    supportedLocales: r.supported_locales,
    numberingSystem: r.numbering_system,
    dateStyle: r.date_style,
    status: r.status,
    notes: r.notes,
    updatedAt: r.updated_at,
    updatedByName: r.updated_by_name,
    rulesNeedingSetup: r.rules_needing_setup,
    rulesTotal: r.rules_total,
  };
}

const SELECT = `select k.*, u.display_name as updated_by_name,
       (select count(*) from app.market_rules r where r.market = k.code and r.status = 'needs_setup')::int as rules_needing_setup,
       (select count(*) from app.market_rules r where r.market = k.code)::int as rules_total
  from app.markets k left join app.users u on u.id = k.updated_by`;

/** Any signed-in user: markets drive formatting everywhere. */
export async function listMarkets(db: Db, userId: string): Promise<MarketConfig[]> {
  return withAppTx(db, { userId }, async (c) => (await c.query(`${SELECT} order by k.code`)).rows.map(mapRow));
}

export async function getMarketDetail(db: Db, actor: Actor, code: string): Promise<{ market: MarketConfig; rules: MarketRule[] }> {
  if (!isMarketCode(code)) throw new IdentityError("not_found");
  return withAppTx(db, actor, async (c) => {
    await requirePlatform(c, actor, "platform.markets.view");
    const { rows } = await c.query(`${SELECT} where k.code = $1`, [code]);
    if (!rows[0]) throw new IdentityError("not_found");
    const { rows: rules } = await c.query(
      "select category, status, source_reference, effective_from::text from app.market_rules where market = $1 order by category",
      [code],
    );
    return {
      market: mapRow(rows[0]),
      rules: rules.map((r) => ({ category: r.category, status: r.status, sourceReference: r.source_reference, effectiveFrom: r.effective_from })),
    };
  });
}

export type MarketInput = {
  nameEn: unknown;
  nameAr: unknown;
  currency: unknown;
  timeZone: unknown;
  weekendDays: unknown[];
  defaultLocale: unknown;
  supportedLocales: unknown[];
  numberingSystem: unknown;
  dateStyle: unknown;
  status: unknown;
  notes?: unknown;
};

const text = (v: unknown, max: number, field: string) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length < 1 || s.length > max) throw new IdentityError("invalid_input", field);
  return s;
};

export function validateMarketInput(i: MarketInput) {
  const currency = String(i.currency).toUpperCase();
  if (!CURRENCIES.has(currency)) throw new IdentityError("invalid_input", "currency");
  const timeZone = String(i.timeZone);
  if (!ZONES.has(timeZone)) throw new IdentityError("invalid_input", "time_zone");
  const weekendDays = [...new Set(i.weekendDays.map(Number))].sort();
  if (weekendDays.length < 1 || weekendDays.length > 3 || weekendDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new IdentityError("invalid_input", "weekend_days");
  }
  const supportedLocales = [...new Set(i.supportedLocales.map(String))];
  if (!supportedLocales.length || supportedLocales.some((l) => !LOCALE_CODES.includes(l))) throw new IdentityError("invalid_input", "supported_locales");
  const defaultLocale = String(i.defaultLocale);
  if ((defaultLocale !== "en" && defaultLocale !== "ar") || !supportedLocales.includes(defaultLocale)) throw new IdentityError("invalid_input", "default_locale");
  const numberingSystem = String(i.numberingSystem);
  if (numberingSystem !== "latn" && numberingSystem !== "arab") throw new IdentityError("invalid_input", "numbering_system");
  const dateStyle = String(i.dateStyle);
  if (!["short", "medium", "long"].includes(dateStyle)) throw new IdentityError("invalid_input", "date_style");
  const status = String(i.status);
  if (status !== "enabled" && status !== "disabled") throw new IdentityError("invalid_input", "status");
  const notesRaw = typeof i.notes === "string" ? i.notes.trim() : "";
  if (notesRaw.length > 500) throw new IdentityError("invalid_input", "notes");
  return {
    name_en: text(i.nameEn, 80, "name_en"),
    name_ar: text(i.nameAr, 80, "name_ar"),
    currency,
    time_zone: timeZone,
    weekend_days: weekendDays,
    default_locale: defaultLocale,
    supported_locales: supportedLocales,
    numbering_system: numberingSystem,
    date_style: dateStyle,
    status,
    notes: notesRaw || null,
  };
}

// Weekend days are a set: [6,0] and [0,6] are the same weekend.
const normalize = (k: string, v: unknown) => (k === "weekend_days" && Array.isArray(v) ? [...v].map(Number).sort() : v);
const same = (k: string, a: unknown, b: unknown) => JSON.stringify(normalize(k, a)) === JSON.stringify(normalize(k, b));

export async function updateMarket(db: Db, actor: Actor, code: string, input: MarketInput): Promise<string[]> {
  if (!isMarketCode(code)) throw new IdentityError("not_found");
  const next = validateMarketInput(input);
  return withAppTx(db, actor, async (c) => {
    await requirePlatform(c, actor, "platform.markets.configure");
    const { rows } = await c.query("select * from app.markets where code = $1 for update", [code]);
    const before = rows[0];
    if (!before) throw new IdentityError("not_found");
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => !same(k, before[k], next[k]));
    if (!changed.length) return [];
    const res = await c.query(
      `update app.markets set name_en = $2, name_ar = $3, currency = $4, time_zone = $5, weekend_days = $6,
              default_locale = $7, supported_locales = $8, numbering_system = $9, date_style = $10, status = $11,
              notes = $12, updated_at = now(), updated_by = $13
        where code = $1`,
      [code, next.name_en, next.name_ar, next.currency, next.time_zone, next.weekend_days, next.default_locale,
        next.supported_locales, next.numbering_system, next.date_style, next.status, next.notes, actor.userId],
    );
    if (res.rowCount !== 1) throw new IdentityError("forbidden", "rls");
    await writeAudit(c, {
      type: "market.updated",
      outcome: "success",
      actorUserId: actor.userId,
      orgId: actor.orgId,
      target: { type: "market", id: code },
      metadata: { fields: changed.join(",") },
    });
    return changed;
  });
}
