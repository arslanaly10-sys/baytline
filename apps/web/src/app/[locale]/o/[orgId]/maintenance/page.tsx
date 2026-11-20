import Link from "next/link";
import { WORK_ORDER_STATUSES } from "@baytline/core";
import { listPmUnits, listProperties, listStaff, listWorkOrders } from "@baytline/management";
import { pmSection } from "@/server/pm-page";
import { getDb } from "@/server/db";
import { createWorkOrderAction } from "@/server/actions/management";
import { buttonClass } from "@/lib/button";
import { day } from "@/lib/dev-format";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Chip } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { Empty, Hidden, Panel, WorkFields, workTone } from "@/components/pm/parts";

type Search = { q?: string; status?: string; assignee?: string; propertyId?: string };

export default async function MaintenancePage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<Search> }) {
  const { locale, orgId } = await params;
  const q = await searchParams;
  const { page, allowed, section, can, actor, base } = await pmSection(locale, orgId, "maintenance");
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const { dict } = page;
  const t = dict.pm.work;
  const canManage = can("maintenance.manage");
  const status = q.status ?? "open_all";
  const [orders, properties, units, staff] = await Promise.all([
    listWorkOrders(getDb(), actor, { ...q, status }),
    listProperties(getDb(), actor),
    canManage ? listPmUnits(getDb(), actor) : Promise.resolve([]),
    canManage ? listStaff(getDb(), actor) : Promise.resolve([]),
  ]);
  const filtered = Boolean(q.q || q.status || q.assignee || q.propertyId);
  const any = { value: "", label: dict.admin.any };

  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={dict.workspaces.management.sections.maintenance.label} intro={t.intro} />
      <form method="get" role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] lg:items-end">
        <Field label={t.searchLabel} name="q" type="search" defaultValue={q.q ?? ""} />
        <SelectField label={t.fields.status} name="status" defaultValue={status} options={[{ value: "open_all", label: t.openAll }, ...WORK_ORDER_STATUSES.map((s) => ({ value: s, label: dict.pm.workStatuses[s] })), { value: "all", label: dict.admin.any }]} />
        <SelectField label={t.fields.property} name="propertyId" defaultValue={q.propertyId ?? ""} options={[any, ...properties.map((p) => ({ value: p.id, label: p.name }))]} />
        <SelectField label={t.fields.assignee} name="assignee" defaultValue={q.assignee ?? ""} options={[any, { value: "me", label: dict.pm.me }, { value: "none", label: dict.pm.unassigned }]} />
        <div className="flex gap-2">
          <button type="submit" className={buttonClass("quiet")}>{dict.admin.search}</button>
          {filtered && <Link href={`${base}/maintenance`} className="self-center text-sm text-gulf-strong underline underline-offset-4">{dict.admin.clear}</Link>}
        </div>
      </form>

      {orders.length === 0 ? (
        <Empty action={!filtered && canManage && properties.length > 0 ? { href: "#add", label: t.addTitle } : undefined}>{filtered ? t.noMatches : t.noWork}</Empty>
      ) : (
        <ul className="grid gap-px overflow-hidden rounded-panel border border-line bg-line">
          {orders.map((w) => (
            <li key={w.id} className="bg-surface">
              <Link href={`${base}/maintenance/${w.id}`} className="grid gap-2 px-5 py-4 hover:bg-gulf-tint sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-6">
                <span className="min-w-0">
                  <span className="font-medium text-gulf-strong">{w.title}</span>
                  <span className="block text-sm text-ink-muted">{w.propertyName}{w.unitCode ? ` · ${w.unitCode}` : ""}{w.vendorName ? ` · ${w.vendorName}` : ""}</span>
                </span>
                <span className="text-sm text-ink-muted">
                  {w.assigneeName ?? dict.pm.unassigned}
                  {w.scheduledFor && <span className="block">{day(w.scheduledFor, locale)}</span>}
                </span>
                <span className="flex flex-wrap gap-2">
                  <Chip tone={workTone(w.status)}>{dict.pm.workStatuses[w.status]}</Chip>
                  {w.vendorName && !w.vendorConfirmed && w.status !== "completed" && w.status !== "cancelled" && <Chip tone="attention">{t.vendorNotConfirmed}</Chip>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <Panel title={t.addTitle} id="add">
          {properties.length === 0 ? (
            <p className="text-sm text-ink-muted">{dict.pm.properties.noProperties}</p>
          ) : (
            <ActionForm action={createWorkOrderAction} submitLabel={t.create} pendingLabel={t.creating}>
              <Hidden values={{ locale: page.locale, orgId }} />
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField label={t.fields.property} name="propertyId" options={properties.map((p) => ({ value: p.id, label: p.name }))} />
                <SelectField label={t.fields.unit} name="unitId" defaultValue="" options={[{ value: "", label: dict.pm.none }, ...units.map((u) => ({ value: u.id, label: `${u.propertyName} · ${u.code}` }))]} />
              </div>
              <WorkFields dict={dict} staff={staff} />
            </ActionForm>
          )}
        </Panel>
      ) : (
        <p className="text-sm text-ink-muted">{dict.pm.readOnly}</p>
      )}
    </div>
  );
}
