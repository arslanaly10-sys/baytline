"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Tabs for one project. Only tabs the role can open are passed in; pages re-check on the server. */
export function ProjectNav({ items, label }: { items: { href: string; label: string; exact?: boolean }[]; label: string }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto border-b border-line">
      <ul className="flex gap-1 px-1">
        {items.map((i) => {
          const active = i.exact ? path === i.href : path === i.href || path.startsWith(`${i.href}/`);
          return (
            <li key={i.href} className="shrink-0">
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={`block border-b-2 px-3 py-2 text-sm ${active ? "border-gulf font-medium text-gulf-strong" : "border-transparent text-ink-muted hover:text-ink"}`}
              >
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
