import Link from "next/link";
import { getDictionary } from "@/i18n";
import { requireLocale } from "@/server/guards";
import { BrandMark } from "@/components/ui/BrandMark";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";

export default async function AuthLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dict = await getDictionary(locale);
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="hidden bg-rail text-rail-ink md:flex md:flex-col md:justify-between md:p-10 lg:p-14">
        <Link href={`/${locale}`} className="flex items-center gap-2.5">
          <BrandMark className="size-8 text-[var(--focus)]" />
          <span className="text-xl font-medium tracking-tight">{dict.brand.name}</span>
        </Link>
        <p className="max-w-[28ch] text-2xl leading-snug">{dict.brand.tagline}</p>
        <p className="text-xs text-rail-muted">{dict.brand.workingName}</p>
      </div>
      <div className="flex flex-col px-4 py-6 sm:px-10">
        <header className="flex items-center justify-between gap-4">
          <Link href={`/${locale}`} className="flex items-center gap-2 text-gulf md:invisible">
            <BrandMark className="size-7" />
            <span className="text-lg font-medium text-ink">{dict.brand.name}</span>
          </Link>
          <LocaleSwitcher current={locale} label={dict.common.language} />
        </header>
        <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-12">
          {children}
        </main>
      </div>
    </div>
  );
}
