import type { AvailabilityLabel } from "@baytline/core";

export function ProvenanceChip({ status, label }: { status: AvailabilityLabel; label: string }) {
  return <span className={`prov prov-${status}`}>{label}</span>;
}
