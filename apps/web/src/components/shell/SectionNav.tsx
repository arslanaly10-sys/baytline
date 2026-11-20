"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; milestone?: string };

export function SectionNav({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      <ul className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
        {items.map((item) => {
          const current = pathname === item.href;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`flex items-center justify-between gap-3 rounded-control px-3 py-2 text-sm transition-colors ${
                  current
                    ? "bg-rail-active font-medium text-rail-ink shadow-[inset_3px_0_0_var(--focus)] rtl:shadow-[inset_-3px_0_0_var(--focus)]"
                    : "text-rail-muted hover:bg-rail-active/60 hover:text-rail-ink"
                }`}
              >
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
