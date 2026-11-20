import Link from "next/link";
import { hasCapability, workspaceForOrgType } from "@baytline/core";
import { DEMO_STATUSES, listDemoRequestsByStatus, type DemoStatus } from "@baytline/platform";
import { checkSection, loadOrgPage } from "@/server/guards";
import { getDb } from "@/server/db";
import { getMarketsConfig, timeZoneOf } from "@/server/markets";
import { setDemoRequestStatusAction } from "@/server/actions/platform";
import { sectionLabel } from "@/lib/sections";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ActionForm } from "@/components/forms/ActionForm";
import { SelectField } from "@/components/forms/Field";

const TONE: Record<DemoStatus, ChipTone> = { new: "attention", contacted: "good", closed: "muted" };

/** Leads from the website's demo form. Platform staff read; platform admins update the follow-up status. */
export default async function DemoRequestsPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { locale, orgId } = await params;
  const q = await searchParams;
  const page = await loadOrgPage(locale, orgId);
  const { allowed } = await checkSection(page, "demo-requests");
  const { dict } = page;
  const t = dict.demoRequests;
  const ws = dict.workspaces[workspaceForOrgType(page.ctx.org.type).id];
  const header = <SectionHeader eyebrow={page.ctx.org.name} title={sectionLabel(ws, "demo-requests")} intro={t.intro} />;
  if (!allowed) return <div className="space-y-10">{header}<AccessDenied dict={dict} orgName={page.ctx.org.name} /></div>;

  const canManage = hasCapability(page.ctx.principal, "platform.orgs.manage");
  const [rows, markets] = await Promise.all([listDemoRequestsByStatus(getDb(), { userId: page.session.user.id, orgId }, q.status), getMarketsConfig()]);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: timeZoneOf(markets, page.ctx.org.market) });
  const base = `/${locale}/o/${orgId}/demo-requests`;
  const orgTypes = dict.site.demo.roles;

  return (
    <div className="space-y-8">
      {header}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <SelectField label={t.filter} name="status" defaultValue={q.status ?? ""}
          options={[{ value: "", label: dict.admin.any }, ...DEMO_STATUSES.map((s) => ({ value: s, label: t.status[s] }))]} />
        <button type="submit" className="rounded-control border border-line bg-surface px-4 py-2 text-sm">{dict.admin.search}</button>
        {q.status && <Link href={base} className="self-center text-sm text-gulf-strong underline underline-offset-4">{dict.admin.clear}</Link>}
      </form>
      {!canManage && <p className="rounded-control border-s-4 border-gulf bg-surface px-3 py-2 text-sm">{t.readOnly}</p>}

      {rows.length === 0 ? (
        <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{q.status ? t.noMatches : t.empty}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-panel border border-line bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink"><bdi>{r.name}</bdi> · <bdi>{r.company}</bdi></p>
                  <p className="mt-1 text-sm text-ink-muted">
                    <bdi dir="ltr">{r.email}</bdi>
                    {r.phone && <> · <bdi dir="ltr">{r.phone}</bdi></>}
                  </p>
                </div>
                <Chip tone={TONE[r.status]}>{t.status[r.status]}</Chip>
              </div>
              <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <div><dt className="text-ink-muted">{t.columns.received}</dt><dd>{date.format(r.createdAt)}</dd></div>
                <div><dt className="text-ink-muted">{t.columns.country}</dt><dd>{dict.markets[r.market]}</dd></div>
                <div><dt className="text-ink-muted">{t.columns.type}</dt><dd>{orgTypes[r.orgType]}</dd></div>
                <div><dt className="text-ink-muted">{t.columns.language}</dt><dd>{r.locale === "ar" ? "العربية" : "English"}</dd></div>
              </dl>
              {canManage && (
                <div className="mt-4 border-t border-line pt-4">
                  <ActionForm action={setDemoRequestStatusAction} layout="inline" variant="quiet" submitLabel={t.save} pendingLabel={t.saving}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="orgId" value={orgId} />
                    <input type="hidden" name="requestId" value={r.id} />
                    <SelectField label={t.markAs} name="status" defaultValue={r.status}
                      options={DEMO_STATUSES.map((s) => ({ value: s, label: t.status[s] }))} />
                  </ActionForm>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
