import "server-only";
import { cache } from "react";
import type { MarketCode, UiLocale } from "@baytline/core";
import { listMarkets, type MarketConfig } from "@baytline/platform";
import { getDb } from "./db";
import { getSession } from "./session";

/**
 * Market settings come from the database (edited in Platform > Markets), loaded
 * once per request. Pages never hardcode currencies, time zones or formats.
 */
export const getMarketsConfig = cache(async (): Promise<MarketConfig[]> => {
  const session = await getSession();
  if (!session) return [];
  return listMarkets(getDb(), session.user.id);
});

export function findMarket(markets: MarketConfig[], code: string | null | undefined): MarketConfig | undefined {
  return markets.find((m) => m.code === code);
}

/** Falls back to UTC rather than guessing a country when a market is missing. */
export function timeZoneOf(markets: MarketConfig[], code: string | null | undefined): string {
  return findMarket(markets, code)?.timeZone ?? "UTC";
}

export function marketOptions(markets: MarketConfig[], locale: UiLocale, opts: { enabledOnly?: boolean; current?: MarketCode | null } = {}) {
  return markets
    .filter((m) => !opts.enabledOnly || m.status === "enabled" || m.code === opts.current)
    .map((m) => ({ value: m.code, label: m.name[locale], currency: m.currency }));
}

/** Locale string for Intl that honours the market's digit style, e.g. "ar-u-nu-latn". */
export function formattingLocale(locale: UiLocale, market: MarketConfig | undefined): string {
  return market ? `${locale}-u-nu-${market.numberingSystem}` : locale;
}
