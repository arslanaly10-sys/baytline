import { formatMoney, type UiLocale } from "@baytline/core";
import type { PublicMarket } from "@baytline/marketplace";

/** Intl locale honouring the market's digit style (configured in Platform > Markets). */
export function marketLocale(locale: UiLocale, markets: PublicMarket[], code: string | null | undefined): string {
  const m = markets.find((x) => x.code === code);
  return m ? `${locale}-u-nu-${m.numberingSystem}` : locale;
}

export function price(minor: string | bigint, currency: string, intlLocale: string): string {
  return formatMoney({ amountMinor: BigInt(minor), currency: currency as never }, intlLocale);
}

/** Calendar dates are stored without a time zone; format them as such. */
export function calendarDay(value: string | null | undefined, intlLocale: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export function moment(value: Date | null | undefined, intlLocale: string, timeZone = "UTC"): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(value);
}

/** "3 hours ago", "2 days ago", in the visitor's language. */
export function ago(value: Date, locale: UiLocale, now = new Date()): string {
  const s = (value.getTime() - now.getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(s);
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86_400 * 45) return rtf.format(Math.round(s / 86_400), "day");
  return rtf.format(Math.round(s / (86_400 * 30)), "month");
}

/** Joins short items with the language's own comma ("، " in Arabic). */
export const list = (items: (string | null | undefined)[], locale: UiLocale) => items.filter(Boolean).join(locale === "ar" ? "، " : ", ");

/** "450 m" / "1.8 km" in the given Intl locale. */
export function distanceText(meters: number, intlLocale: string): string {
  if (meters < 1000) return new Intl.NumberFormat(intlLocale, { style: "unit", unit: "meter", maximumFractionDigits: 0 }).format(Math.round(meters / 10) * 10);
  return new Intl.NumberFormat(intlLocale, { style: "unit", unit: "kilometer", maximumFractionDigits: 1 }).format(meters / 1000);
}
