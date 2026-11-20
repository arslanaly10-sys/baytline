"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LOCALES, UI_LOCALES } from "@baytline/core";
import { rememberLocale } from "@/server/actions";

export function LocaleSwitcher({ current, label }: { current: string; label: string }) {
  const pathname = usePathname();
  const rest = pathname.split("/").slice(2).join("/");
  return (
    <nav aria-label={label} className="flex items-center rounded-control border border-line p-0.5">
      {UI_LOCALES.map((code) => {
        const def = LOCALES.find((l) => l.code === code)!;
        const active = code === current;
        return (
          <Link
            key={code}
            href={`/${code}${rest ? `/${rest}` : ""}`}
            hrefLang={code}
            lang={code}
            aria-current={active ? "true" : undefined}
            onClick={() => void rememberLocale(code)}
            className={`rounded-[6px] px-2.5 py-1 text-sm ${active ? "bg-gulf text-gulf-ink" : "text-ink-muted hover:text-ink"}`}
          >
            {def.nativeName}
          </Link>
        );
      })}
    </nav>
  );
}
