"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setMarket } from "@/server/actions";

export function MarketSwitcher({
  current,
  label,
  options,
}: {
  current: string;
  label: string;
  options: { code: string; name: string; currency: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-ink-muted max-sm:sr-only">{label}</span>
      <select
        value={current}
        disabled={pending}
        onChange={(e) => {
          const code = e.target.value;
          start(async () => {
            await setMarket(code);
            router.refresh();
          });
        }}
        className="rounded-control border border-line bg-surface px-2 py-1.5 text-sm text-ink disabled:opacity-60"
      >
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.name} ({o.currency})
          </option>
        ))}
      </select>
    </label>
  );
}
