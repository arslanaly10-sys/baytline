import Link from "next/link";
import { listPlans, listPriceLists } from "@baytline/developer";
import { format } from "@/i18n/format";
import { actorOf, devSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { VersionChip } from "@/components/dev/parts";

/** Every price list and payment plan, with its latest version. Editing happens inside each project. */
export default async function PricingPage({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  const { page, allowed, section, isDeveloper } = await devSection(locale, orgId, "pricing");
  if (!allowed || !isDeveloper) return <SectionShell page={page} section={section} allowed={allowed} />;
  const { dict } = page;
  const t = dict.dev.pricing;
  const a = actorOf(page);
  const [lists, plans] = await Promise.all([listPriceLists(getDb(), a), listPlans(getDb(), a)]);
  const base = `/${locale}/o/${orgId}/projects`;
  const groups = [
    { title: t.lists, empty: t.noLists, kind: "prices", items: lists.map((l) => ({ id: l.id, name: l.name, projectId: l.projectId, projectName: l.projectName, latest: l.versions[0] })) },
    { title: t.plans, empty: t.noPlans, kind: "plans", items: plans.map((p) => ({ id: p.id, name: p.name, projectId: p.projectId, projectName: p.projectName, latest: p.versions[0] })) },
  ];
  return (
    <div className="space-y-10">
      <SectionHeader eyebrow={page.ctx.org.name} title={dict.workspaces.developer.sections.pricing.label} intro={t.intro} />
      {groups.map((g) => (
        <section key={g.kind} aria-labelledby={`g-${g.kind}`}>
          <h2 id={`g-${g.kind}`} className="text-lg">{g.title}</h2>
          {g.items.length === 0 ? (
            <p className="mt-3 rounded-panel border-2 border-dashed border-line px-6 py-6 text-center text-sm text-ink-muted">{g.empty}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-panel border border-line bg-surface">
              {g.items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <span>
                    <span className="font-medium">{i.name}</span>
                    <Link href={`${base}/${i.projectId}/pricing`} className="block text-sm text-gulf-strong underline-offset-4 hover:underline">{i.projectName}</Link>
                  </span>
                  {i.latest && (
                    <Link href={`${base}/${i.projectId}/pricing/${g.kind}/${i.latest.id}`} className="flex items-center gap-2 text-sm">
                      {format(t.version, { n: i.latest.version })} <VersionChip status={i.latest.status as never} dict={dict} />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <p className="max-w-[70ch] text-xs text-ink-muted">{t.rulesNote}</p>
    </div>
  );
}
