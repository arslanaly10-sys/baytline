import { getProperty, listPmUnits } from "@baytline/management";
import { orNotFound, pmSection } from "@/server/pm-page";
import { getDb } from "@/server/db";
import { findMarket, getMarketsConfig } from "@/server/markets";
import { createPmUnitAction, updatePropertyAction } from "@/server/actions/management";
import { day } from "@/lib/dev-format";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ActionForm } from "@/components/forms/ActionForm";
import { SampleBadge } from "@/components/dev/parts";
import { Back, Empty, Facts, Hidden, Panel, PropertyFields, UnitFields } from "@/components/pm/parts";
import { UnitTable } from "@/components/pm/UnitTable";

export default async function PropertyPage({ params }: { params: Promise<{ locale: string; orgId: string; propertyId: string }> }) {
  const { locale, orgId, propertyId } = await params;
  const { page, allowed, section, can, actor, base } = await pmSection(locale, orgId, "portfolio");
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const { dict } = page;
  const t = dict.pm.properties;
  const [p, units, markets] = await Promise.all([
    orNotFound(getProperty(getDb(), actor, propertyId)),
    listPmUnits(getDb(), actor, { propertyId }),
    getMarketsConfig(),
  ]);
  const market = findMarket(markets, p.market);
  const hidden = { locale: page.locale, orgId, propertyId: p.id };

  return (
    <div className="space-y-10">
      <Back href={`${base}/portfolio`} label={dict.workspaces.management.sections.portfolio.label} />
      <SectionHeader eyebrow={`${p.city}${p.address ? `, ${p.address}` : ""}`} title={p.name} intro={dict.pm.recordedNote}>
        <div className="flex flex-wrap gap-2">{p.isSample && <SampleBadge dict={dict} />}{p.status === "archived" && <span className="text-sm text-ink-muted">{t.archived}</span>}</div>
      </SectionHeader>

      <Facts items={[
        [t.fields.market, market?.name[page.locale] ?? p.market],
        [t.fields.propertyType, dict.pm.propertyTypes[p.propertyType]],
        [t.fields.managementBasis, dict.pm.bases[p.managementBasis]],
        [t.fields.ownerName, p.ownerName],
        [t.fields.agreementRef, p.agreementRef],
        [t.fields.agreementStart, p.agreementStart && `${day(p.agreementStart, locale)}${p.agreementEnd ? ` – ${day(p.agreementEnd, locale)}` : ""}`],
      ]} />

      <section aria-labelledby="units-title" className="space-y-4">
        <div>
          <h2 id="units-title" className="text-lg">{dict.pm.units.title}</h2>
          <p className="mt-1 text-sm text-ink-muted">{dict.pm.units.intro}</p>
        </div>
        {units.length === 0 ? <Empty>{dict.pm.units.noUnits}</Empty> : <UnitTable dict={dict} units={units} base={base} locale={locale} />}
      </section>

      {can("property.manage") && (
        <>
          <Panel title={dict.pm.units.addTitle}>
            <ActionForm action={createPmUnitAction} submitLabel={dict.pm.units.create} pendingLabel={dict.pm.units.creating}>
              <Hidden values={hidden} />
              <UnitFields dict={dict} />
            </ActionForm>
          </Panel>
          <Panel title={t.editTitle}>
            <ActionForm action={updatePropertyAction} submitLabel={t.save} pendingLabel={t.saving}>
              <Hidden values={hidden} />
              <PropertyFields dict={dict} locale={page.locale} markets={markets} p={p} />
            </ActionForm>
          </Panel>
        </>
      )}
      {!p.canManage && <p className="text-sm text-ink-muted">{dict.pm.readOnly}</p>}
    </div>
  );
}
