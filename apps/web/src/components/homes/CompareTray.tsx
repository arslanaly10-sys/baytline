"use client";

import Link from "next/link";
import { Scales } from "@phosphor-icons/react";
import { COMPARE_LIMIT } from "@baytline/core";
import { useCompare } from "./compare-store";

/** Fixed bar showing what's selected for comparison. Hidden when nothing is selected. */
export function CompareTray({ locale, t }: { locale: string; t: { tray: string; open: string; clear: string } }) {
  const { items, clear } = useCompare();
  if (items.length === 0) return null;
  return (
    <div role="region" aria-label={t.open} className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-night-2/95 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-8">
        <Scales aria-hidden="true" className="size-5 text-gold" />
        <p className="text-sm text-sand" aria-live="polite">{t.tray.replace("{n}", String(items.length)).replace("{max}", String(COMPARE_LIMIT))}</p>
        <div className="ms-auto flex items-center gap-2">
          <button type="button" onClick={clear} className="rounded-full px-3 py-2 text-sm text-mist hover:text-sand">{t.clear}</button>
          <Link href={`/${locale}/homes/compare?items=${items.join(",")}`} className="rounded-full bg-gold px-4 py-2 text-sm font-medium text-night hover:bg-gold-light">{t.open}</Link>
        </div>
      </div>
    </div>
  );
}
