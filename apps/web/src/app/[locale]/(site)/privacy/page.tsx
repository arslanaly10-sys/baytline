import type { Metadata } from "next";
import { getDictionary } from "@/i18n";
import { siteMeta } from "@/lib/site-meta";
import { requireLocale } from "@/server/guards";
import { LegalPage } from "@/components/site/LegalPage";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const dict = await getDictionary(locale);
  const t = dict.site.legal.privacy;
  return siteMeta({ locale, path: "/privacy", title: `${t.title} · ${dict.brand.name}`, description: t.intro, brand: dict.brand.name, noindex: true });
}

export default async function Page({ params }: Params) {
  const dict = await getDictionary(requireLocale((await params).locale));
  return <LegalPage doc={dict.site.legal.privacy} legal={dict.site.legal} />;
}
