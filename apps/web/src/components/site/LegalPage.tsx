import type { Dictionary } from "@/i18n";

type Doc = Dictionary["site"]["legal"]["privacy"];

export function LegalPage({ doc, legal }: { doc: Doc; legal: Dictionary["site"]["legal"] }) {
  return (
    <main id="main" className="bg-night text-sand">
      <article className="mx-auto max-w-3xl px-4 pb-24 pt-32 sm:px-8">
        <p role="note" className="rounded-2xl border border-gold/50 bg-panel px-4 py-3 text-sm text-gold-light">{legal.draftBanner}</p>
        <h1 className="mt-10 font-display text-5xl text-sand">{doc.title}</h1>
        <p className="mt-2 text-sm text-mist">{legal.updated}</p>
        <p className="mt-8 text-lg text-sand/90">{doc.intro}</p>
        {doc.sections.map((s) => (
          <section key={s.h} className="mt-10 border-t border-hairline pt-6">
            <h2 className="font-display text-2xl text-gold-light">{s.h}</h2>
            <p className="mt-3 leading-relaxed text-mist">{s.p}</p>
          </section>
        ))}
      </article>
    </main>
  );
}
