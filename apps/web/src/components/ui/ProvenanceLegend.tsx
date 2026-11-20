import type { AvailabilityLabel } from "@baytline/core";
import type { Dictionary } from "@/i18n";
import { ProvenanceChip } from "./ProvenanceChip";

const ORDER: AvailabilityLabel[] = ["live", "recently_confirmed", "stale", "unverified", "disputed"];

export function ProvenanceLegend({ dict }: { dict: Dictionary }) {
  return (
    <section aria-labelledby="trust-title" className="rounded-panel border border-line bg-surface p-5 sm:p-6">
      <h2 id="trust-title" className="text-lg">{dict.overview.trustTitle}</h2>
      <p className="mt-1 max-w-[65ch] text-sm text-ink-muted">{dict.overview.trustIntro}</p>
      <dl className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
        {ORDER.map((s) => (
          <div key={s} className="contents">
            <dt><ProvenanceChip status={s} label={dict.provenance[s]} /></dt>
            <dd className="text-sm text-ink-muted max-sm:mb-2">{dict.provenance.describe[s]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
