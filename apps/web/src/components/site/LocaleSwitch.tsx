"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Same page, other language. */
export function LocaleSwitch({ locale }: { locale: "en" | "ar" }) {
  const path = usePathname() ?? `/${locale}`;
  const other = locale === "en" ? "ar" : "en";
  const href = path.replace(/^\/(en|ar)(?=\/|$)/, `/${other}`);
  return (
    <Link href={href} hrefLang={other} lang={other} className="rounded-full px-2.5 py-1 text-sm text-sand/80 hover:text-gold-light">
      {other === "ar" ? "العربية" : "English"}
    </Link>
  );
}
