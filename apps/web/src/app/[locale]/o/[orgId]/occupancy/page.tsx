import Link from "next/link";
import { OCCUPANCY_STATUSES, PM_UNIT_TYPES } from "@baytline/core";
import { listPmUnits, listProperties } from "@baytline/management";
import { pmSection } from "@/server/pm-page";
import { getDb } from "@/server/db";
import { buttonClass } from "@/lib/button";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Field, SelectField } from "@/components/forms/Field";
import { Empty } from "@/components/pm/parts";
import { UnitTable } from "@/components/pm/UnitTable";

type Search = { propertyId?: string; occupancy?: string; type?: string; q?: string };

export default async function OccupancyPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<Search> }) {
  const { locale, orgId } = await params;
  const q = await searchParams;
  const { page, allowed, section, actor, base } = await pmSection(locale, orgId, "occupancy");
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const { dict } = page;
  const [units, properties] = await Promise.all([listPmUnits(getDb(), actor, q), listProperties(getDb(), actor)]);
  const filtered = Boolean(q.propertyId || q.occupancy || q.type || q.q);
  const any = { value: "", label: dict.admin.any };
  const f = dict.pm.units.fields;

  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={dict.workspaces.management.sections.occupancy.label} intro={dict.pm.units.intro} />
      <form method="get" role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,1fr))_auto] lg:items-end">
        <Field label={dict.pm.units.searchLabel} name="q" type="search" defaultValue={q.q ?? ""} />
        <SelectField label={f.property} name="propertyId" defaultValue={q.propertyId ?? ""} options={[any, ...properties.map((p) => ({ value: p.id, label: p.name }))]} />
        <SelectField label={f.occupancy} name="occupancy" defaultValue={q.occupancy ?? ""} options={[any, ...OCCUPANCY_STATUSES.map((o) => ({ value: o, label: dict.pm.occupancy[o] }))]} />
        <SelectField label={f.unitType} name="type" defaultValue={q.type ?? ""} options={[any, ...PM_UNIT_TYPES.map((o) => ({ value: o, label: dict.pm.unitTypes[o] }))]} />
        <div className="flex gap-2">
          <button type="submit" className={buttonClass("quiet")}>{dict.admin.search}</button>
          {filtered && <Link href={`${base}/occupancy`} className="self-center text-sm text-gulf-strong underline underline-offset-4">{dict.admin.clear}</Link>}
        </div>
      </form>
      {units.length === 0 ? <Empty>{filtered ? dict.pm.units.noMatches : dict.pm.units.nothingYet}</Empty> : <UnitTable dict={dict} units={units} base={base} locale={locale} showProperty />}
    </div>
  );
}
