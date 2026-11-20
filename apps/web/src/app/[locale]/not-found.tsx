import Link from "next/link";
import en from "@/i18n/en";
import ar from "@/i18n/ar";

// not-found receives no params; show both enabled languages so it reads correctly either way.
export default function NotFound() {
  return (
    <main id="main" className="mx-auto grid max-w-3xl gap-10 px-4 py-20 sm:px-8 md:grid-cols-2">
      {[{ d: en, lang: "en", dir: "ltr" }, { d: ar, lang: "ar", dir: "rtl" }].map(({ d, lang, dir }) => (
        <section key={lang} lang={lang} dir={dir}>
          <h1 className="text-xl">{d.errors.notFoundTitle}</h1>
          <p className="mt-2 text-ink-muted">{d.errors.notFoundBody}</p>
          <Link href={`/${lang}`} className="mt-4 inline-block text-gulf underline underline-offset-4">
            {d.errors.back}
          </Link>
        </section>
      ))}
    </main>
  );
}
