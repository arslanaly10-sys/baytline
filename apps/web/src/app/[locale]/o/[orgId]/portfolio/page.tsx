import Link from "next/link";
import { MANAGEMENT_BASES, PM_PROPERTY_TYPES } from "@baytline/core";
import { getPortfolioSummary, listProperties } from "@baytline/management";
import { pmSection } from "@/server/pm-page";
import { getDb } from "@/server/db";
import { getMarketsConfig, marketOptions } from "@/server/markets";
import { createPropertyAction } from "@/server/actions/management";
import { buttonClass } from "@/lib/button";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { SampleBadge } from "@/components/dev/parts";
import { Empty, Hidden, Panel, PropertyFields } from "@/components/pm/parts";
import { SummaryGrid } from "@/components/pm/Summary";

type Search = { q?: string; type?: string; basis?: string; market?: string; status?: string };

export default async function PortfolioPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<Search> }) {
  const { locale, orgId } = await params;
  const q = await searchParams;
  const { page, allowed, section, can, actor, base } = await pmSection(locale, orgId, "portfolio");
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const { dict } = page;
  const t = dict.pm.properties;
  const [summary, properties, markets] = await Promise.all([getPortfolioSummary(getDb(), actor), listProperties(getDb(), actor, q), getMarketsConfig()]);
  const filtered = Boolean(q.q || q.type || q.basis || q.market || q.status);
  const any = { value: "", label: dict.admin.any };

  return (
    <div className="space-y-10">
      <SectionHeader eyebrow={page.ctx.org.name} title={dict.workspaces.management.sections.portfolio.label} intro={t.intro} />
      <SummaryGrid s={summary} dict={dict} base={base} />

      <section aria-label={dict.workspaces.management.sections.portfolio.label} className="space-y-5">
        <form method="get" role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto] lg:items-end">
          <Field label={t.searchLabel} name="q" type="search" defaultValue={q.q ?? ""} />
          <SelectField label={t.fields.propertyType} name="type" defaultValue={q.type ?? ""} options={[any, ...PM_PROPERTY_TYPES.map((v) => ({ value: v, label: dict.pm.propertyTypes[v] }))]} />
          <SelectField label={t.fields.managementBasis} name="basis" defaultValue={q.basis ?? ""} options={[any, ...MANAGEMENT_BASES.map((v) => ({ value: v, label: dict.pm.bases[v] }))]} />
          <SelectField label={t.fields.market} name="market" defaultValue={q.market ?? ""} options={[any, ...marketOptions(markets, page.locale)]} />
          <SelectField label={t.fields.status} name="status" defaultValue={q.status ?? ""} options={[{ value: "", label: t.active }, { value: "archived", label: t.archived }, { value: "all", label: dict.admin.any }]} />
          <div className="flex gap-2">
            <button type="submit" className={buttonClass("quiet")}>{dict.admin.search}</button>
            {filtered && <Link href={`${base}/portfolio`} className="self-center text-sm text-gulf-strong underline underline-offset-4">{dict.admin.clear}</Link>}
          </div>
        </form>

        {properties.length === 0 ? (
          <Empty>{filtered ? t.noMatches : t.noProperties}</Empty>
        ) : (
          <ul className="grid gap-px overflow-hidden rounded-panel border border-line bg-line">
            {properties.map((p) => (
              <li key={p.id} className="bg-surface">
                <Link href={`${base}/portfolio/${p.id}`} className="grid gap-2 px-5 py-4 hover:bg-gulf-tint sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-6">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gulf-strong">{p.name}</span>
                      {p.isSample && <SampleBadge dict={dict} />}
                      {p.status === "archived" && <span className="text-xs text-ink-muted">{t.archived}</span>}
                    </span>
                    <span className="block text-sm text-ink-muted">{p.city}. {dict.pm.propertyTypes[p.propertyType]}, {dict.pm.bases[p.managementBasis]}</span>
                  </span>
                  <span className="text-sm text-ink-muted">{p.ownerName ?? ""}</span>
                  <span className="text-sm whitespace-nowrap text-ink-muted">{t.fields.units}: <span className="tabular-nums text-ink">{p.unitCount}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {can("property.manage") ? (
        <Panel title={t.addTitle}>
          <ActionForm action={createPropertyAction} submitLabel={t.create} pendingLabel={t.creating}>
            <Hidden values={{ locale: page.locale, orgId }} />
            <PropertyFields dict={dict} locale={page.locale} markets={markets} />
          </ActionForm>
        </Panel>
      ) : (
        <p className="text-sm text-ink-muted">{dict.pm.readOnly}</p>
      )}
    </div>
  );
}
