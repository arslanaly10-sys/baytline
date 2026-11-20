import Link from "next/link";
import { getRequest, listStaff } from "@baytline/management";
import { orNotFound, pmSection } from "@/server/pm-page";
import { getDb } from "@/server/db";
import { addRequestNoteAction, createWorkOrderAction, updateRequestAction } from "@/server/actions/management";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Chip } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { Back, Facts, Hidden, Panel, priorityTone, RequestFields, requestTone, TextArea, WorkFields, workTone } from "@/components/pm/parts";

export default async function RequestPage({ params }: { params: Promise<{ locale: string; orgId: string; requestId: string }> }) {
  const { locale, orgId, requestId } = await params;
  const { page, allowed, section, actor, base } = await pmSection(locale, orgId, "requests");
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const { dict } = page;
  const t = dict.pm.requests;
  const r = await orNotFound(getRequest(getDb(), actor, requestId));
  const staff = r.canManage || r.canCreateWorkOrder ? await listStaff(getDb(), actor) : [];
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const hidden = { locale: page.locale, orgId, requestId: r.id };

  return (
    <div className="space-y-10">
      <Back href={`${base}/requests`} label={dict.workspaces.management.sections.requests.label} />
      <SectionHeader eyebrow={`${r.propertyName}${r.unitCode ? ` · ${r.unitCode}` : ""}`} title={r.title}>
        <div className="flex flex-wrap gap-2">
          <Chip tone={priorityTone(r.priority)}>{dict.pm.priorities[r.priority]}</Chip>
          <Chip tone={requestTone(r.status)}>{dict.pm.requestStatuses[r.status]}</Chip>
        </div>
      </SectionHeader>

      <Facts items={[
        [t.fields.category, dict.pm.categories[r.category]],
        [t.fields.unit, r.unitId && <Link key="u" href={`${base}/portfolio/units/${r.unitId}`} className="text-gulf-strong underline underline-offset-4">{r.unitCode}</Link>],
        [t.fields.tenant, r.tenantName],
        [t.fields.assignee, r.assigneeName ?? dict.pm.unassigned],
        [t.fields.reportedAt, `${when.format(r.reportedAt)}${r.createdByName ? ` · ${r.createdByName}` : ""}`],
        [t.fields.resolvedAt, r.resolvedAt && when.format(r.resolvedAt)],
      ]} />
      {r.description && <p className="max-w-[70ch] whitespace-pre-line text-ink">{r.description}</p>}

      <section aria-labelledby="notes-title" className="space-y-4">
        <h2 id="notes-title" className="text-lg">{t.notesTitle}</h2>
        {r.notes.length === 0 ? <p className="text-sm text-ink-muted">{t.noNotes}</p> : (
          <ol className="space-y-3">
            {r.notes.map((n) => (
              <li key={n.id} className="rounded-panel border border-line bg-surface p-4">
                <p className="whitespace-pre-line">{n.body}</p>
                <p className="mt-2 text-xs text-ink-muted">{n.authorName ?? "—"} · {when.format(n.at)}</p>
              </li>
            ))}
          </ol>
        )}
        {r.canManage && (
          <ActionForm action={addRequestNoteAction} submitLabel={t.addNote} pendingLabel={t.addingNote}>
            <Hidden values={hidden} />
            <TextArea label={t.noteLabel} name="body" maxLength={2000} required />
          </ActionForm>
        )}
      </section>

      {r.workOrders && (
        <section aria-labelledby="wo-title" className="space-y-3">
          <h2 id="wo-title" className="text-lg">{t.workOrdersTitle}</h2>
          {r.workOrders.length === 0 ? <p className="text-sm text-ink-muted">{dict.pm.units.nothingYet}</p> : (
            <ul className="divide-y divide-line rounded-panel border border-line bg-surface">
              {r.workOrders.map((w) => (
                <li key={w.id}>
                  <Link href={`${base}/maintenance/${w.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gulf-tint">
                    <span className="text-gulf-strong">{w.title}</span>
                    <Chip tone={workTone(w.status as never)}>{dict.pm.workStatuses[w.status as keyof typeof dict.pm.workStatuses]}</Chip>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {r.canCreateWorkOrder && r.status !== "closed" && (
        <Panel title={t.createWorkOrder}>
          <ActionForm action={createWorkOrderAction} submitLabel={dict.pm.work.create} pendingLabel={dict.pm.work.creating}>
            <Hidden values={hidden} />
            <WorkFields dict={dict} staff={staff} />
          </ActionForm>
        </Panel>
      )}

      {r.canManage ? (
        <Panel title={t.save}>
          <ActionForm action={updateRequestAction} submitLabel={t.save} pendingLabel={t.saving}>
            <Hidden values={hidden} />
            <RequestFields dict={dict} r={r} staff={staff} withStatus />
          </ActionForm>
        </Panel>
      ) : (
        <p className="text-sm text-ink-muted">{dict.pm.readOnly}</p>
      )}
    </div>
  );
}
