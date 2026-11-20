import "@fontsource-variable/cormorant-garamond";
import "@fontsource/amiri/400.css";
import "@fontsource/amiri/700.css";
import { Analytics } from "@vercel/analytics/next";
import { getDictionary } from "@/i18n";
import { requireLocale } from "@/server/guards";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SmoothScroll } from "@/components/site/SmoothScroll";

/** Marketing site: dark-and-gold theme, smooth scrolling. The 3D code loads only on the homepage. */
export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dict = await getDictionary(locale);
  return (
    <div data-site className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-night-2 focus:px-3 focus:py-2">
        {dict.common.skipToContent}
      </a>
      <SmoothScroll />
      <SiteHeader dict={dict} locale={locale} />
      {children}
      <SiteFooter dict={dict} locale={locale} />
      <Analytics />
    </div>
  );
}
