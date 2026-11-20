import Link from "next/link";
import type { AuthorizationStatus, SourceHealth } from "@baytline/core";
import type { Dictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { Chip, type ChipTone } from "@/components/ui/Chip";

export function SourcesTabs({ dict, base, current }: { dict: Dictionary; base: string; current: "sources" | "imports" | "history" }) {
  const tabs = [
    { id: "sources", href: `${base}/sources`, label: dict.src.tabs.sources },
    { id: "imports", href: `${base}/sources/imports`, label: dict.src.tabs.imports },
    { id: "history", href: `${base}/sources/history`, label: dict.src.tabs.history },
  ] as const;
  return (
    <nav aria-label={dict.workspaces.developer.sections.sources.label} className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link key={t.id} href={t.href} aria-current={t.id === current ? "page" : undefined}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${t.id === current ? "border-gulf font-medium text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

const AUTH_TONE: Record<AuthorizationStatus, ChipTone> = {
  draft: "muted", pending_approval: "attention", authorized: "good", rejected: "problem", suspended: "attention", revoked: "problem",
};
export function AuthChip({ dict, status }: { dict: Dictionary; status: AuthorizationStatus }) {
  return <Chip tone={AUTH_TONE[status]}>{dict.src.auth[status]}</Chip>;
}

const HEALTH_TONE: Record<SourceHealth, ChipTone> = {
  not_applicable: "muted", no_adapter: "muted", not_authorized: "muted", platform_disabled: "attention", not_configured: "attention",
  never_synced: "muted", failing: "problem", stale: "attention", healthy: "good",
};
export function HealthChip({ dict, health }: { dict: Dictionary; health: SourceHealth }) {
  return <Chip tone={HEALTH_TONE[health]}>{dict.src.health[health]}</Chip>;
}

const BATCH_TONE: Record<string, ChipTone> = { submitted: "attention", uploaded: "attention", validated: "neutral", applied: "good", cancelled: "muted" };
export function BatchStatusChip({ dict, status }: { dict: Dictionary; status: keyof Dictionary["src"]["imports"]["status"] }) {
  return <Chip tone={BATCH_TONE[status] ?? "muted"}>{dict.src.imports.status[status]}</Chip>;
}

/** A row issue in words. Field names and row numbers come from the validator; the sentence from the dictionary. */
export function issueText(dict: Dictionary, i: { field: string; code: string; rows?: number[] }, kind: "issues" | "warnings" = "issues"): string {
  const b = dict.src.batch;
  const table = b[kind] as Record<string, string>;
  const field = (b.fields as Record<string, string>)[i.field] ?? i.field;
  // Data rows are numbered from 1 after the header; people see spreadsheet lines, where the header is line 1.
  return format(table[i.code] ?? i.code, { field, rows: (i.rows ?? []).map((r) => r + 1).join(", ") });
}

/** Short result line for a finished or validated batch. */
export function summaryText(dict: Dictionary, s: Record<string, number> | null): string {
  if (!s) return "—";
  const labels = dict.src.batch.summary as Record<string, string>;
  return (["create", "update", "unchanged", "conflict", "duplicate", "error"] as const)
    .filter((k) => s[k])
    .map((k) => `${labels[k]} ${s[k]}`)
    .join(" · ") || (labels.unchanged ?? "");
}

export function valueText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).filter(([, x]) => x != null && x !== "").map(([k, x]) => `${k}: ${String(x)}`).join(", ");
  return String(v);
}
