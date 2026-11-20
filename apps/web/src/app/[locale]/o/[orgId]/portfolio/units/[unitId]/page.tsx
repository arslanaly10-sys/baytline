import Link from "next/link";
import { getPmUnit } from "@baytline/management";
import { format } from "@/i18n/format";
import { orNotFound, pmSection } from "@/server/pm-page";
import { getDb } from "@/server/db";
import { updatePmUnitAction } from "@/server/actions/management";
import { day } from "@/lib/dev-format";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Chip } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { SampleBadge } from "@/components/dev/parts";
import { Back, Facts, Hidden, leaseTone, occupancyTone, Panel, priorityTone, requestTone, UnitFields, workTone } from "@/components/pm/parts";

export default async function UnitPage({ params }: { params: Promise<{ locale: string; orgId: string; unitId: string }> }) {
  const { locale, orgId, unitId } = await params;
  const { page, allowed, section, actor, base } = await pmSection(locale, orgId, "portfolio");
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const { dict } = page;
  const t = dict.pm.units;
  const u = await orNotFound(getPmUnit(getDb(), actor, unitId));
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  const List = ({ title, items }: { title: string; items: { key: string; href: string; label: string; chips: React.ReactNode }[] | null }) =>
    items === null ? null : (
      <section aria-label={title}>
        <h2 className="text-lg">{title}</h2>
        {items.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">{t.nothingYet}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-panel border border-line bg-surface">
            {items.map((i) => (
              <li key={i.key}>
                <Link href={i.href} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-gulf-tint">
                  <span className="text-gulf-strong">{i.label}</span>
                  <span className="flex flex-wrap gap-2">{i.chips}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    );

  return (
    <div className="space-y-10">
      <Back href={`${base}/portfolio/${u.propertyId}`} label={u.propertyName} />
      <SectionHeader eyebrow={u.propertyName} title={u.code} intro={t.intro}>
        <div className="flex flex-wrap gap-2">
          {u.isSample && <SampleBadge dict={dict} />}
          {u.occupancy && <Chip tone={occupancyTone(u.occupancy)}>{dict.pm.occupancy[u.occupancy]}</Chip>}
        </div>
      </SectionHeader>

      <Facts items={[
        [t.fields.unitType, dict.pm.unitTypes[u.unitType]],
        [t.fields.bedrooms, u.bedrooms === 0 ? t.studio : u.bedrooms?.toString()],
        [t.fields.areaSqm, u.areaSqm],
        [t.fields.floor, u.floor?.toString()],
        [t.fields.occupancy, u.occupancy && u.occupancyUpdatedAt ? format(t.occupancyBy, { name: u.occupancyUpdatedByName ?? "—", when: when.format(u.occupancyUpdatedAt) }) : null],
        [t.fields.notes, u.notes],
      ]} />

      {(u.canEditDetails || u.canRecordOccupancy) && (
        <Panel title={u.canEditDetails ? t.save : t.recordOccupancy}>
          <ActionForm action={updatePmUnitAction} submitLabel={u.canEditDetails ? t.save : t.recordOccupancy} pendingLabel={t.saving}>
            <Hidden values={{ locale: page.locale, orgId, unitId: u.id }} />
            <UnitFields dict={dict} u={u} occupancyOnly={!u.canEditDetails} />
          </ActionForm>
        </Panel>
      )}

      <div className="grid gap-8 lg:grid-cols-3">
        <List title={t.leases} items={u.leases && u.leases.map((l) => ({ key: l.id, href: `${base}/leasing/${l.id}`, label: `${l.tenantName} · ${day(l.startDate, locale)} – ${day(l.endDate, locale)}`, chips: <Chip tone={leaseTone(l.status as never)}>{dict.pm.leaseStatuses[l.status as keyof typeof dict.pm.leaseStatuses]}</Chip> }))} />
        <List title={t.requests} items={u.requests && u.requests.map((r) => ({ key: r.id, href: `${base}/requests/${r.id}`, label: r.title, chips: <><Chip tone={priorityTone(r.priority as never)}>{dict.pm.priorities[r.priority as keyof typeof dict.pm.priorities]}</Chip><Chip tone={requestTone(r.status as never)}>{dict.pm.requestStatuses[r.status as keyof typeof dict.pm.requestStatuses]}</Chip></> }))} />
        <List title={t.workOrders} items={u.workOrders && u.workOrders.map((w) => ({ key: w.id, href: `${base}/maintenance/${w.id}`, label: w.title, chips: <Chip tone={workTone(w.status as never)}>{dict.pm.workStatuses[w.status as keyof typeof dict.pm.workStatuses]}</Chip> }))} />
      </div>
    </div>
  );
}
