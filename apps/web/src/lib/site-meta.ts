import type { Metadata } from "next";
import type { UiLocale } from "@baytline/core";

/** Rendered by app/og/route.tsx. */
const OG_IMAGE = { url: "/og", width: 1200, height: 630, alt: "Baytline: Every property enquiry answered." };

const OG_LOCALE: Record<UiLocale, string> = { en: "en_US", ar: "ar_AE" };

/**
 * Metadata for a marketing page. One place defines title, description, canonical URL, the
 * English/Arabic alternates and the share card, so they always agree. `path` is the page path
 * after the locale ("" for the homepage, "/pricing", ...).
 */
export function siteMeta(o: { locale: UiLocale; path: string; title: string; description: string; brand: string; noindex?: boolean }): Metadata {
  const url = `/${o.locale}${o.path}`;
  const other: UiLocale = o.locale === "en" ? "ar" : "en";
  return {
    title: { absolute: o.title },
    description: o.description,
    alternates: { canonical: url, languages: { en: `/en${o.path}`, ar: `/ar${o.path}`, "x-default": `/en${o.path}` } },
    openGraph: { type: "website", siteName: o.brand, title: o.title, description: o.description, url, locale: OG_LOCALE[o.locale], alternateLocale: [OG_LOCALE[other]], images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title: o.title, description: o.description, images: [OG_IMAGE.url] },
    ...(o.noindex ? { robots: { index: false } } : {}),
  };
}
