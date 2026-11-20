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

/** A rule's approved value. Stored as entered and approved; the platform never computes these. */
export type RuleValue = {
  summary: string;
  summaryAr: string | null;
  ratePercent: string | null;
  fixedAmountMinor: string | null;
  currency: string | null;
  payer: RulePayer | null;
};
export const RULE_PAYERS = ["buyer", "seller", "split", "tenant", "landlord", "developer", "broker", "not_applicable"] as const;
export type RulePayer = (typeof RULE_PAYERS)[number];

export type RuleChange = {
  id: string; status: "pending" | "approved" | "rejected" | "withdrawn" | "superseded"; value: RuleValue; sourceReference: string; effectiveFrom: string;
  proposedBy: string; proposedByName: string | null; proposedAt: Date; decidedByName: string | null; decidedAt: Date | null; decisionNote: string | null;
};

export type MarketRule = {
  category: RuleCategory;
  status: "needs_setup" | "configured";
  value: RuleValue | null;
  sourceReference: string | null;
  effectiveFrom: string | null;
  updatedAt: Date | null;
  updatedByName: string | null;
  pending: RuleChange | null;
  history: RuleChange[];
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

function mapValue(v: any): RuleValue | null {
  if (!v) return null;
  return { summary: v.summary, summaryAr: v.summary_ar ?? null, ratePercent: v.rate_percent ?? null, fixedAmountMinor: v.fixed_amount_minor ?? null, currency: v.currency ?? null, payer: v.payer ?? null };
}

function mapChange(r: Record<string, any>): RuleChange {
  return {
    id: r.id, status: r.status, value: mapValue(r.value)!, sourceReference: r.source_reference, effectiveFrom: r.effective_from, proposedBy: r.proposed_by,
    proposedByName: r.proposed_name, proposedAt: r.proposed_at, decidedByName: r.decided_name, decidedAt: r.decided_at, decisionNote: r.decision_note,
  };
}

export async function getMarketDetail(db: Db, actor: Actor, code: string): Promise<{ market: MarketConfig; rules: MarketRule[] }> {
  if (!isMarketCode(code)) throw new IdentityError("not_found");
  return withAppTx(db, actor, async (c) => {
    await requirePlatform(c, actor, "platform.markets.view");
    const { rows } = await c.query(`${SELECT} where k.code = $1`, [code]);
    if (!rows[0]) throw new IdentityError("not_found");
    const { rows: rules } = await c.query(
      `select r.category, r.status, r.value, r.source_reference, r.effective_from::text, r.updated_at, u.display_name
         from app.market_rules r left join app.users u on u.id = r.updated_by where r.market = $1 order by r.category`,
      [code],
    );
    const { rows: changes } = await c.query(
      `select ch.*, ch.effective_from::text as effective_from, pu.display_name as proposed_name, du.display_name as decided_name
         from app.market_rule_changes ch left join app.users pu on pu.id = ch.proposed_by left join app.users du on du.id = ch.decided_by
        where ch.market = $1 order by ch.proposed_at desc`,
      [code],
    );
    return {
      market: mapRow(rows[0]),
      rules: rules.map((r) => {
        const mine = changes.filter((ch) => ch.category === r.category).map(mapChange);
        return {
          category: r.category, status: r.status, value: mapValue(r.value), sourceReference: r.source_reference, effectiveFrom: r.effective_from,
          updatedAt: r.updated_at, updatedByName: r.display_name, pending: mine.find((x) => x.status === "pending") ?? null, history: mine.filter((x) => x.status !== "pending"),
        };
      }),
    };
  });
}

export type RuleProposalInput = {
  summary: unknown; summaryAr?: unknown; ratePercent?: unknown; fixedAmount?: unknown; payer?: unknown; sourceReference: unknown; effectiveFrom: unknown;
};

/**
 * Proposes a rule or fee for a market. It changes nothing until a different platform person approves it.
 * Amounts are in the market's currency, entered as written in the source; nothing is calculated.
 */
export async function proposeMarketRule(db: Db, actor: Actor, code: string, category: string, input: RuleProposalInput): Promise<string> {
  if (!isMarketCode(code) || !(RULE_CATEGORIES as readonly string[]).includes(category)) throw new IdentityError("not_found");
  const summary = text(input.summary, 500, "summary");
  const summaryAr = typeof input.summaryAr === "string" && input.summaryAr.trim() ? text(input.summaryAr, 500, "summary_ar") : null;
  const rate = typeof input.ratePercent === "string" && input.ratePercent.trim() ? input.ratePercent.trim() : null;
  if (rate !== null && (!/^\d{1,3}(\.\d{1,3})?$/.test(rate) || Number(rate) > 100)) throw new IdentityError("invalid_input", "rate_percent");
  const payer = typeof input.payer === "string" && input.payer ? input.payer : null;
  if (payer !== null && !(RULE_PAYERS as readonly string[]).includes(payer)) throw new IdentityError("invalid_input", "payer");
  const source = text(input.sourceReference, 500, "source_reference");
  if (source.length < 3) throw new IdentityError("invalid_input", "source_reference");
  const effective = typeof input.effectiveFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom) && !Number.isNaN(Date.parse(input.effectiveFrom)) ? input.effectiveFrom : null;
  if (!effective) throw new IdentityError("invalid_input", "effective_from");
  return withAppTx(db, actor, async (c) => {
    await requirePlatform(c, actor, "platform.market_rules.propose");
    const { rows: m } = await c.query<{ currency: string }>("select currency from app.markets where code = $1", [code]);
    const currency = m[0]!.currency;
    let fixed: string | null = null;
    if (typeof input.fixedAmount === "string" && input.fixedAmount.trim()) {
      const digits = currencyDigits(currency);
      const v = input.fixedAmount.trim().replace(/[,\s]/g, "");
      const parts = v.match(/^(\d{1,13})(?:\.(\d+))?$/);
      if (!parts || (parts[2] && parts[2].length > digits)) throw new IdentityError("invalid_input", "fixed_amount");
      fixed = (BigInt(parts[1]!) * 10n ** BigInt(digits) + BigInt((parts[2] ?? "").padEnd(digits, "0") || "0")).toString();
    }
    const value = { summary, summary_ar: summaryAr, rate_percent: rate, fixed_amount_minor: fixed, currency: fixed ? currency : null, payer };
    try {
      await c.query("savepoint s");
      const { rows } = await c.query<{ id: string }>("select app.propose_market_rule($1, $2, $3, $4, $5) as id", [code, category, JSON.stringify(value), source, effective]);
      await writeAudit(c, { type: "market_rule.proposed", outcome: "success", actorUserId: actor.userId, orgId: actor.orgId, target: { type: "market_rule", id: `${code}:${category}` }, metadata: { change: rows[0]!.id } });
      return rows[0]!.id;
    } catch (e) {
      const msg = (e as { message?: string }).message;
      await c.query("rollback to savepoint s");
      if (msg === "pending_exists") throw new IdentityError("conflict", "pending_exists");
      throw e;
    }
  });
}

/** A different platform administrator or compliance officer approves or rejects. Rejection needs a reason. */
export async function decideMarketRule(db: Db, actor: Actor, changeId: string, decision: unknown, note?: unknown): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(changeId)) throw new IdentityError("not_found");
  if (decision !== "approve" && decision !== "reject") throw new IdentityError("invalid_input", "decision");
  const n = typeof note === "string" && note.trim() ? text(note, 500, "decision_note") : null;
  if (decision === "reject" && !n) throw new IdentityError("invalid_input", "decision_note_required");
  await withAppTx(db, actor, async (c) => {
    await requirePlatform(c, actor, "platform.market_rules.approve");
    try {
      await c.query("savepoint s");
      await c.query("select app.decide_market_rule($1, $2, $3)", [changeId, decision, n]);
    } catch (e) {
      const msg = (e as { message?: string }).message;
      await c.query("rollback to savepoint s");
      if (msg === "own_proposal") throw new IdentityError("forbidden", "own_proposal");
      if (msg === "not_pending") throw new IdentityError("invalid_input", "not_pending");
      if (msg === "not_found") throw new IdentityError("not_found");
      throw e;
    }
    await writeAudit(c, { type: decision === "approve" ? "market_rule.approved" : "market_rule.rejected", outcome: "success", actorUserId: actor.userId, orgId: actor.orgId, target: { type: "market_rule_change", id: changeId } });
  });
}

export async function withdrawMarketRule(db: Db, actor: Actor, changeId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(changeId)) throw new IdentityError("not_found");
  await withAppTx(db, actor, async (c) => {
    await requirePlatform(c, actor, "platform.market_rules.propose");
    try {
      await c.query("savepoint s");
      await c.query("select app.withdraw_market_rule($1)", [changeId]);
    } catch (e) {
      await c.query("rollback to savepoint s");
      if ((e as { message?: string }).message === "not_pending") throw new IdentityError("invalid_input", "not_pending");
      throw e;
    }
    await writeAudit(c, { type: "market_rule.withdrawn", outcome: "success", actorUserId: actor.userId, orgId: actor.orgId, target: { type: "market_rule_change", id: changeId } });
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
