import Link from "next/link";
import { REQUEST_CATEGORIES, REQUEST_PRIORITIES, REQUEST_STATUSES } from "@baytline/core";
import { listPmUnits, listProperties, listRequests, listStaff, listTenants } from "@baytline/management";
import { pmSection } from "@/server/pm-page";
import { getDb } from "@/server/db";
import { createRequestAction } from "@/server/actions/management";
import { buttonClass } from "@/lib/button";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Chip } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";
import { Empty, Hidden, Panel, priorityTone, RequestFields, requestTone } from "@/components/pm/parts";

type Search = { q?: string; status?: string; priority?: string; category?: string; assignee?: string; propertyId?: string };

export default async function RequestsPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<Search> }) {
  const { locale, orgId } = await params;
  const q = await searchParams;
  const { page, allowed, section, can, actor, base } = await pmSection(locale, orgId, "requests");
  if (!allowed) return <SectionShell page={page} section={section} allowed={false} />;
  const { dict } = page;
  const t = dict.pm.requests;
  const canManage = can("tenant_request.manage");
  const status = q.status ?? "open_all";
  const [requests, properties, units, tenants, staff] = await Promise.all([
    listRequests(getDb(), actor, { ...q, status }),
    listProperties(getDb(), actor),
    canManage ? listPmUnits(getDb(), actor) : Promise.resolve([]),
    canManage ? listTenants(getDb(), actor) : Promise.resolve([]),
    canManage ? listStaff(getDb(), actor) : Promise.resolve([]),
  ]);
  const filtered = Boolean(q.q || q.status || q.priority || q.category || q.assignee || q.propertyId);
  const any = { value: "", label: dict.admin.any };
  const reported = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={dict.workspaces.management.sections.requests.label} intro={t.intro} />
      <form method="get" role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto] lg:items-end">
        <Field label={t.searchLabel} name="q" type="search" defaultValue={q.q ?? ""} />
        <SelectField label={t.fields.status} name="status" defaultValue={status} options={[{ value: "open_all", label: t.openAll }, ...REQUEST_STATUSES.map((s) => ({ value: s, label: dict.pm.requestStatuses[s] })), { value: "all", label: dict.admin.any }]} />
        <SelectField label={t.fields.priority} name="priority" defaultValue={q.priority ?? ""} options={[any, ...REQUEST_PRIORITIES.map((s) => ({ value: s, label: dict.pm.priorities[s] }))]} />
        <SelectField label={t.fields.category} name="category" defaultValue={q.category ?? ""} options={[any, ...REQUEST_CATEGORIES.map((s) => ({ value: s, label: dict.pm.categories[s] }))]} />
        <SelectField label={t.fields.assignee} name="assignee" defaultValue={q.assignee ?? ""} options={[any, { value: "me", label: dict.pm.me }, { value: "none", label: dict.pm.unassigned }]} />
        <div className="flex gap-2">
          <button type="submit" className={buttonClass("quiet")}>{dict.admin.search}</button>
          {filtered && <Link href={`${base}/requests`} className="self-center text-sm text-gulf-strong underline underline-offset-4">{dict.admin.clear}</Link>}
        </div>
      </form>

      {requests.length === 0 ? (
        <Empty action={!filtered && canManage && properties.length > 0 ? { href: "#add", label: t.addTitle } : undefined}>{filtered ? t.noMatches : t.noRequests}</Empty>
      ) : (
        <ul className="grid gap-px overflow-hidden rounded-panel border border-line bg-line">
          {requests.map((r) => (
            <li key={r.id} className="bg-surface">
              <Link href={`${base}/requests/${r.id}`} className="grid gap-2 px-5 py-4 hover:bg-gulf-tint sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-6">
                <span className="min-w-0">
                  <span className="font-medium text-gulf-strong">{r.title}</span>
                  <span className="block text-sm text-ink-muted">{r.propertyName}{r.unitCode ? ` · ${r.unitCode}` : ""} · {dict.pm.categories[r.category]}</span>
                </span>
                <span className="text-sm text-ink-muted">
                  {r.assigneeName ?? dict.pm.unassigned}
                  <span className="block">{reported.format(r.reportedAt)}</span>
                </span>
                <span className="flex flex-wrap gap-2">
                  <Chip tone={priorityTone(r.priority)}>{dict.pm.priorities[r.priority]}</Chip>
                  <Chip tone={requestTone(r.status)}>{dict.pm.requestStatuses[r.status]}</Chip>
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
            <ActionForm action={createRequestAction} submitLabel={t.create} pendingLabel={t.creating}>
              <Hidden values={{ locale: page.locale, orgId }} />
              <div className="grid gap-4 sm:grid-cols-3">
                <SelectField label={t.fields.property} name="propertyId" options={properties.map((p) => ({ value: p.id, label: p.name }))} />
                <SelectField label={t.fields.unit} name="unitId" defaultValue="" options={[{ value: "", label: dict.pm.none }, ...units.map((u) => ({ value: u.id, label: `${u.propertyName} · ${u.code}` }))]} />
                <SelectField label={t.fields.tenant} name="tenantId" defaultValue="" options={[{ value: "", label: dict.pm.none }, ...tenants.map((x) => ({ value: x.id, label: x.name }))]} />
              </div>
              <RequestFields dict={dict} staff={staff} />
            </ActionForm>
          )}
        </Panel>
      ) : (
        <p className="text-sm text-ink-muted">{dict.pm.readOnly}</p>
      )}
    </div>
  );
}
