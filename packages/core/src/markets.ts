import type { LocaleCode } from "./locales";

/**
 * Market (country) configuration.
 *
 * Only stable, non-commercial facts live in code: ISO codes, currency, IANA time
 * zone, weekend days and primary languages. Everything that is regulated or
 * changes over time — transaction fees, registration fees, VAT treatment,
 * escrow rules, payment-plan constraints, broker licensing rules — is
 * configured per market by platform administrators from verified sources and
 * stored with effective dates. Those values are intentionally empty here.
 * Verify all facts below with local counsel before launch.
 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

export type MarketDef = {
  code: "AE" | "SA" | "QA" | "KW" | "BH" | "OM";
  currency: "AED" | "SAR" | "QAR" | "KWD" | "BHD" | "OMR";
  timeZone: string;
  weekend: readonly Weekday[];
  /** Languages most expected in this market, beyond English. */
  languages: readonly LocaleCode[];
};

export const MARKETS = [
  { code: "AE", currency: "AED", timeZone: "Asia/Dubai", weekend: [6, 0], languages: ["ar", "en", "ur", "ru"] },
  { code: "SA", currency: "SAR", timeZone: "Asia/Riyadh", weekend: [5, 6], languages: ["ar", "en", "ur"] },
  { code: "QA", currency: "QAR", timeZone: "Asia/Qatar", weekend: [5, 6], languages: ["ar", "en"] },
  { code: "KW", currency: "KWD", timeZone: "Asia/Kuwait", weekend: [5, 6], languages: ["ar", "en"] },
  { code: "BH", currency: "BHD", timeZone: "Asia/Bahrain", weekend: [5, 6], languages: ["ar", "en"] },
  { code: "OM", currency: "OMR", timeZone: "Asia/Muscat", weekend: [5, 6], languages: ["ar", "en"] },
] as const satisfies readonly MarketDef[];

export type MarketCode = MarketDef["code"];
export const DEFAULT_MARKET: MarketCode = "AE";

export function isMarketCode(v: string): v is MarketCode {
  return MARKETS.some((m) => m.code === v);
}

export function getMarket(code: MarketCode): MarketDef {
  const m = MARKETS.find((x) => x.code === code);
  if (!m) throw new Error(`Unknown market ${code}`);
  return m;
}

/** Shape of the admin-managed rules (persisted in later milestones). */
export type MarketRule = {
  market: MarketCode;
  key: string; // e.g. "transfer_fee", "broker_registration_required"
  value: unknown;
  effectiveFrom: string; // ISO date
  effectiveTo?: string;
  sourceReference: string; // where the rule was verified
  approvedBy: string;
};

/** Money is always integer minor units + currency; KWD/BHD/OMR use 3 decimals. */
export type Money = { amountMinor: bigint; currency: MarketDef["currency"] };

export function formatMoney(m: Money, locale: string): string {
  const fmt = new Intl.NumberFormat(locale, { style: "currency", currency: m.currency });
  const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  const major = Number(m.amountMinor) / 10 ** digits;
  return fmt.format(major);
}
