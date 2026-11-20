import { formatMoney } from "@baytline/core";

/** Minor units (string from the database) -> localized currency text. */
export function money(minor: string | null | undefined, currency: string, locale: string): string {
  if (!minor) return "";
  return formatMoney({ amountMinor: BigInt(minor), currency: currency as never }, locale);
}

/** Calendar dates are stored without a time zone; format them as such (no shifting). */
export function day(value: string | null | undefined, locale: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
