import "@fontsource-variable/readex-pro";
import "@fontsource-variable/cormorant-garamond";
import "@fontsource/amiri/400.css";
import "@fontsource/amiri/700.css";
import "../globals.css";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { isUiLocale, localeDir, UI_LOCALES } from "@baytline/core";
import { getDictionary } from "@/i18n";

export function generateStaticParams() {
  return UI_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isUiLocale(locale)) return {};
  const dict = await getDictionary(locale);
  return {
    title: { default: dict.brand.name, template: `%s | ${dict.brand.name}` },
    description: dict.brand.tagline,
    robots: { index: false, follow: false }, // pre-launch
  };
}

export const viewport: Viewport = {
  themeColor: [
    { color: "#0a0f14" },
  ],
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isUiLocale(locale)) notFound();
  return (
    <html lang={locale} dir={localeDir(locale)}>
      <body className="bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
