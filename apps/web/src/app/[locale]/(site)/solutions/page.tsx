import type { Metadata } from "next";
import { getDictionary } from "@/i18n";
import { requireLocale } from "@/server/guards";
import { AI_CAPABILITIES, type WorkspaceId } from "@baytline/core";
import { AVAILABLE_AUDIENCES, PageHero, Status } from "@/components/site/sections";
import { Photo } from "@/components/site/Photo";
import { AUDIENCE_PHOTO } from "@/lib/photos";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const dict = await getDictionary(requireLocale((await params).locale));
  const t = dict.site.pages.solutions;
  return { title: { absolute: `${t.title} · ${dict.brand.name}` }, description: t.intro };
}

const AUDIENCES = [
  ["developer", "developer"],
  ["brokerage", "brokerage"],
  ["management", "management"],
  ["personal", "personal"],
] as const satisfies readonly (readonly [string, WorkspaceId])[];

export default async function SolutionsPage({ params }: Params) {
  const locale = requireLocale((await params).locale);
  const dict = await getDictionary(locale);
  const s = dict.site;
  const t = s.pages.solutions;
  return (
    <main id="main" className="bg-night text-sand">
      <PageHero eyebrow={t.eyebrow} title={t.title} intro={t.intro} />
      {AUDIENCES.map(([key, ws], i) => {
        const a = s.audiences[key];
        const x = t.audiences[key];
        const ai = AI_CAPABILITIES.filter((c) => (c.workspaces as readonly string[]).includes(ws));
        const available = AVAILABLE_AUDIENCES.has(key);
        return (
          <section key={key} id={key} className="scroll-mt-20 border-b border-hairline">
            <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-8 md:py-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
              <div>
                <p className="font-display text-2xl text-gold">{String(i + 1).padStart(2, "0")}</p>
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  <h2 className="font-display text-5xl text-sand">{a.name}</h2>
                  <Status available={available} label={available ? s.status.available : s.status.building} />
                </div>
                <p className="mt-5 text-xl text-sand/90">{x.lead}</p>
                <p className="mt-4 border-s-2 border-gold/50 ps-4 text-mist">{x.challenge}</p>
                <ul className="mt-8 space-y-3 text-sand/90">
                  {a.points.map((p) => (
                    <li key={p} className="flex gap-3"><span aria-hidden="true" className="mt-2.5 h-px w-4 shrink-0 bg-gold" />{p}</li>
                  ))}
                </ul>
              </div>
              <div className="space-y-5">
              <Photo slug={AUDIENCE_PHOTO[key]} alt={s.photos.alt[AUDIENCE_PHOTO[key]]} ratio="3 / 2" className="rounded-3xl" sizes="(min-width: 1024px) 680px, 100vw" />
              <div className="rounded-3xl border border-hairline bg-night-2 p-6 sm:p-8">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm tracking-[0.14em] text-gold-light uppercase">{t.aiTitle}</h3>
                  <Status available={false} label={s.status.building} />
                </div>
                <ul className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  {ai.map((c) => {
                    const ct = s.ai.capabilities[c.id as keyof typeof s.ai.capabilities];
                    return (
                      <li key={c.id}>
                        <p className="text-sand">{ct.name}</p>
                        <p className="mt-0.5 text-sm text-mist">{ct.desc}</p>
                      </li>
                    );
                  })}
                </ul>
              </div>
              </div>
            </div>
          </section>
        );
      })}
    </main>
  );
}
