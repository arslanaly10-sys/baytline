/** US dollars from micro-dollars, with enough precision for small AI costs. Plain module: server and client. */
export function usd(micro: number, locale: string): string {
  const v = micro / 1_000_000;
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: v > 0 && v < 1 ? 4 : 2 }).format(v);
}

/** Micro-dollars as a plain dollar amount for a form field ("25.50"). */
export const usdInput = (micro: number) => (micro / 1_000_000).toFixed(2);
