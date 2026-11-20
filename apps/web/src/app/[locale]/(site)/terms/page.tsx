import type { Metadata } from "next";
import { getDictionary } from "@/i18n";
import { requireLocale } from "@/server/guards";
import { LegalPage } from "@/components/site/LegalPage";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const dict = await getDictionary(requireLocale((await params).locale));
  return { title: `${dict.site.legal.terms.title} · ${dict.brand.name}`, robots: { index: false } };
}

export default async function Page({ params }: Params) {
  const dict = await getDictionary(requireLocale((await params).locale));
  return <LegalPage doc={dict.site.legal.terms} legal={dict.site.legal} />;
}
