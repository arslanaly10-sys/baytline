"use client";

import { Check, Plus } from "@phosphor-icons/react";
import { useCompare } from "./compare-store";

export function CompareToggle({ refId, label, addedLabel, fullLabel }: { refId: string; label: string; addedLabel: string; fullLabel: string }) {
  const { has, toggle, full } = useCompare();
  const on = has(refId);
  const disabled = !on && full;
  return (
    <button
      type="button"
      onClick={() => toggle(refId)}
      aria-pressed={on}
      disabled={disabled}
      title={disabled ? fullLabel : undefined}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-gold bg-gold/15 text-gold-light" : "border-hairline text-sand hover:border-gold-light"}`}
    >
      {on ? <Check aria-hidden="true" weight="bold" className="size-3.5" /> : <Plus aria-hidden="true" weight="bold" className="size-3.5" />}
      {on ? addedLabel : label}
    </button>
  );
}
