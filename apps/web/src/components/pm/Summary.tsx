import Link from "next/link";
import { OCCUPANCY_STATUSES } from "@baytline/core";
import type { PortfolioSummary } from "@baytline/management";
import type { Dictionary } from "@/i18n";
import { format } from "@/i18n/format";

/** Figures straight from stored records; blocks a role can't see are left out entirely, never shown as zero. */
export function SummaryGrid({ s, dict, base }: { s: PortfolioSummary; dict: Dictionary; base: string }) {
  const t = dict.pm.summary;
  const Stat = ({ label, value, href }: { label: string; value: number; href?: string }) => {
    const inner = (
      <>
        <span className="block font-display text-4xl leading-none text-gulf-strong tabular-nums">{value}</span>
        <span className="mt-2 block text-sm text-ink-muted">{label}</span>
      </>
    );
    return href ? <Link href={href} className="block rounded-control p-3 hover:bg-gulf-tint">{inner}</Link> : <div className="p-3">{inner}</div>;
  };
  return (
    <section aria-labelledby="summary-title" className="space-y-4">
      <div>
        <h2 id="summary-title" className="text-lg">{t.title}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t.intro}</p>
      </div>
      <div className="grid gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-surface p-3">
          <div className="grid grid-cols-2">
            <Stat label={t.properties} value={s.properties} href={`${base}/portfolio`} />
            <Stat label={t.units} value={s.units} />
          </div>
        </div>
        {s.occupancy && (
          <div className="bg-surface p-3">
            <p className="px-3 pt-2 text-xs tracking-[0.14em] text-gulf uppercase">{t.occupancy}</p>
            <ul className="mt-2 space-y-1 px-3 pb-2 text-sm">
              {OCCUPANCY_STATUSES.map((o) => (
                <li key={o} className="flex justify-between gap-3">
                  <Link href={`${base}/occupancy?occupancy=${o}`} className="text-ink-muted hover:text-gulf-strong">{dict.pm.occupancy[o]}</Link>
                  <span className="tabular-nums">{s.occupancy![o]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {s.leases && (
          <div className="bg-surface p-3">
            <p className="px-3 pt-2 text-xs tracking-[0.14em] text-gulf uppercase">{t.leases}</p>
            <div className="grid grid-cols-3">
              <Stat label={t.activeLeases} value={s.leases.active} href={`${base}/leasing?status=active`} />
              <Stat label={format(t.endingSoon, { days: s.windowDays.endingSoon })} value={s.leases.endingSoon} href={`${base}/leasing?ending=${s.windowDays.endingSoon}`} />
              <Stat label={format(t.renewalsDue, { days: s.windowDays.renewalsDue })} value={s.leases.renewalsDue} href={`${base}/leasing?renewal=${s.windowDays.renewalsDue}`} />
            </div>
          </div>
        )}
        {(s.requests || s.workOrders) && (
          <div className="bg-surface p-3">
            {s.requests && (
              <>
                <p className="px-3 pt-2 text-xs tracking-[0.14em] text-gulf uppercase">{t.requests}</p>
                <div className="grid grid-cols-3">
                  <Stat label={t.openRequests} value={s.requests.open} href={`${base}/requests`} />
                  <Stat label={t.urgent} value={s.requests.urgent} href={`${base}/requests?priority=urgent`} />
                  <Stat label={t.unassignedRequests} value={s.requests.unassigned} href={`${base}/requests?assignee=none`} />
                </div>
              </>
            )}
            {s.workOrders && (
              <>
                <p className="px-3 pt-2 text-xs tracking-[0.14em] text-gulf uppercase">{t.workOrders}</p>
                <div className="grid grid-cols-2">
                  <Stat label={t.openWork} value={s.workOrders.open} href={`${base}/maintenance`} />
                  <Stat label={t.thisWeek} value={s.workOrders.scheduledThisWeek} href={`${base}/maintenance?status=scheduled`} />
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {s.properties === 0 && <p className="text-sm text-ink-muted">{t.empty}</p>}
    </section>
  );
}
