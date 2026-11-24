import Link from "next/link";
import type { ScoreBand } from "@baytline/core";
import type { Dictionary } from "@/i18n";
import { Chip, type ChipTone } from "@/components/ui/Chip";

const BAND_TONE: Record<ScoreBand, ChipTone> = { hot: "problem", warm: "attention", cold: "muted" };
export function BandChip({ dict, band, overridden }: { dict: Dictionary; band: ScoreBand; overridden?: boolean }) {
  return <Chip tone={BAND_TONE[band]}>{dict.crm.leads.bands[band]}{overridden ? ` · ${dict.crm.leads.overridden}` : ""}</Chip>;
}

export function LeadTabs({ dict, base, current }: { dict: Dictionary; base: string; current: "leads" | "requests" }) {
  const tabs = [
    { id: "leads", href: `${base}/leads`, label: dict.crm.tabs.leads },
    { id: "requests", href: `${base}/leads?tab=requests`, label: dict.crm.tabs.requests },
  ] as const;
  return (
    <nav aria-label={dict.crm.tabs.leads} className="flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <Link key={t.id} href={t.href} aria-current={t.id === current ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${t.id === current ? "border-gulf font-medium text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}>{t.label}</Link>
      ))}
    </nav>
  );
}

export const money = (minor: string | null | undefined, currency: string | null | undefined, locale: string) => {
  if (!minor || !currency) return "—";
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: digits }).format(Number(minor) / 10 ** digits);
};
export const inputMoney = (minor: string | null | undefined, currency: string | null | undefined) => {
  if (!minor || !currency) return "";
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return (Number(minor) / 10 ** digits).toFixed(digits);
};
