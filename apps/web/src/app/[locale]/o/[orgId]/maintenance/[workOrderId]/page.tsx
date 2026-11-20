import Link from "next/link";
import { getWorkOrder, listStaff } from "@baytline/management";
import { format } from "@/i18n/format";
import { orNotFound, pmSection } from "@/server/pm-page";
import { getDb } from "@/server/db";
import { recordCompletionAction, recordVendorConfirmationAction, updateWorkOrderAction } from "@/server/actions/management";
import { day, money } from "@/lib/dev-format";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Chip } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field } from "@/components/forms/Field";
import { Back, Facts, Hidden, Panel, TextArea, WorkFields, workTone } from "@/components/pm/parts";

export default async function WorkOrderPage({ params }: { params: Promise<{ locale: string; orgId: string; workOrderId: string }> }) {
  const { locale, orgId, workOrderId } = await params;
  const { page, allowed, section, actor, base } = await pmSection(locale, orgId, "maintenance");
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const { dict } = page;
  const t = dict.pm.work;
  const w = await orNotFound(getWorkOrder(getDb(), actor, workOrderId));
  const closed = w.status === "completed" || w.status === "cancelled";
  const staff = w.canManage && !closed ? await listStaff(getDb(), actor) : [];
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const hidden = { locale: page.locale, orgId, workOrderId: w.id };

  return (
    <div className="space-y-10">
      <Back href={`${base}/maintenance`} label={dict.workspaces.management.sections.maintenance.label} />
      <SectionHeader eyebrow={`${w.propertyName}${w.unitCode ? ` · ${w.unitCode}` : ""}`} title={w.title} intro={t.intro}>
        <div className="flex flex-wrap gap-2">
          <Chip tone={workTone(w.status)}>{dict.pm.workStatuses[w.status]}</Chip>
          {w.vendorName && (w.vendorConfirmed ? <Chip tone="good">{format(t.vendorConfirmed, { name: w.vendorConfirmedByName ?? "—", when: w.vendorConfirmedAt ? when.format(w.vendorConfirmedAt) : "" })}</Chip> : <Chip tone="attention">{t.vendorNotConfirmed}</Chip>)}
        </div>
      </SectionHeader>

      <Facts items={[
        [t.fields.request, w.requestId && <Link key="r" href={`${base}/requests/${w.requestId}`} className="text-gulf-strong underline underline-offset-4">{w.requestTitle}</Link>],
        [t.fields.unit, w.unitId && <Link key="u" href={`${base}/portfolio/units/${w.unitId}`} className="text-gulf-strong underline underline-offset-4">{w.unitCode}</Link>],
        [t.fields.assignee, w.assigneeName ?? dict.pm.unassigned],
        [t.fields.vendorName, w.vendorName],
        [t.fields.scheduledFor, day(w.scheduledFor, locale)],
        [t.fields.cost, w.costMinor && w.costCurrency ? money(w.costMinor, w.costCurrency, locale) : null],
      ]} />
      {w.description && <p className="max-w-[70ch] whitespace-pre-line">{w.description}</p>}

      {w.status === "completed" && (
        <section aria-labelledby="done-title" className="rounded-panel border border-mangrove/60 bg-surface p-5">
          <h2 id="done-title" className="text-lg">{format(t.completedBy, { name: w.completedByName ?? "—", when: w.completedAt ? when.format(w.completedAt) : "" })}</h2>
          <p className="mt-2 whitespace-pre-line text-ink">{w.completionNotes}</p>
        </section>
      )}

      {w.canManage && !closed && (
        <>
          {w.vendorName && !w.vendorConfirmed && (
            <ActionForm action={recordVendorConfirmationAction} submitLabel={t.confirmVendor} pendingLabel={t.confirming} variant="quiet" layout="inline">
              <Hidden values={hidden} />
            </ActionForm>
          )}
          <Panel title={t.completeTitle}>
            <p className="-mt-2 mb-4 text-sm text-ink-muted">{t.completeHint}</p>
            <ActionForm action={recordCompletionAction} submitLabel={t.complete} pendingLabel={t.completing}>
              <Hidden values={hidden} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextArea label={t.fields.completionNotes} name="notes" maxLength={2000} required />
                <Field label={t.fields.cost} name="cost" inputMode="decimal" hint={w.marketCurrency} />
              </div>
            </ActionForm>
          </Panel>
          <Panel title={t.save}>
            <ActionForm action={updateWorkOrderAction} submitLabel={t.save} pendingLabel={t.saving}>
              <Hidden values={hidden} />
              <WorkFields dict={dict} w={w} staff={staff} />
            </ActionForm>
          </Panel>
        </>
      )}
      {!w.canManage && <p className="text-sm text-ink-muted">{dict.pm.readOnly}</p>}
    </div>
  );
}
