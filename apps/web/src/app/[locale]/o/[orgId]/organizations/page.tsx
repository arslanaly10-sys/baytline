import Link from "next/link";
import { hasCapability, workspaceForOrgType } from "@baytline/core";
import { CREATABLE_ORG_TYPES } from "@baytline/identity";
import { searchOrganizations } from "@baytline/platform";
import { checkSection, loadOrgPage } from "@/server/guards";
import { getDb } from "@/server/db";
import { getMarketsConfig, marketOptions } from "@/server/markets";
import { createOrganizationAction } from "@/server/actions/team";
import { sectionDescription, sectionLabel } from "@/lib/sections";
import { buttonClass } from "@/lib/button";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { Chip } from "@/components/ui/Chip";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ActionForm } from "@/components/forms/ActionForm";
import { Field, SelectField } from "@/components/forms/Field";

type Search = { q?: string; type?: string; status?: string; market?: string };

export default async function OrganizationsPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<Search> }) {
  const { locale, orgId } = await params;
  const q = await searchParams;
  const page = await loadOrgPage(locale, orgId);
  const { allowed } = await checkSection(page, "organizations");
  const { dict } = page;
  const ws = dict.workspaces[workspaceForOrgType(page.ctx.org.type).id];
  const header = <SectionHeader eyebrow={page.ctx.org.name} title={sectionLabel(ws, "organizations")} intro={sectionDescription(ws, "organizations")} />;
  if (!allowed) return <div className="space-y-10">{header}<AccessDenied dict={dict} orgName={page.ctx.org.name} /></div>;

  const canManage = hasCapability(page.ctx.principal, "platform.orgs.manage");
  const [orgs, markets] = await Promise.all([searchOrganizations(getDb(), { userId: page.session.user.id, orgId }, q), getMarketsConfig()]);
  const marketName = (code: string | null) => markets.find((m) => m.code === code)?.name[page.locale] ?? "";
  const filtered = Boolean(q.q || q.type || q.status || q.market);
  const base = `/${locale}/o/${orgId}/organizations`;
  const any = { value: "", label: dict.admin.any };

  return (
    <div className="space-y-10">
      {header}
      {!canManage && <p className="rounded-control border-s-4 border-gulf bg-surface px-3 py-2 text-sm">{dict.admin.readOnly}</p>}

      <form method="get" role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] lg:items-end">
        <Field label={dict.orgs.searchLabel} name="q" type="search" defaultValue={q.q ?? ""} />
        <SelectField label={dict.orgs.typeFilter} name="type" defaultValue={q.type ?? ""}
          options={[any, ...(["platform", ...CREATABLE_ORG_TYPES] as const).map((t) => ({ value: t, label: dict.orgTypes[t] }))]} />
        <SelectField label={dict.orgs.statusFilter} name="status" defaultValue={q.status ?? ""}
          options={[any, { value: "active", label: dict.orgs.status.active }, { value: "suspended", label: dict.orgs.status.suspended }]} />
        <SelectField label={dict.orgs.marketFilter} name="market" defaultValue={q.market ?? ""} options={[any, ...marketOptions(markets, page.locale)]} />
        <div className="flex gap-2">
          <button type="submit" className={buttonClass("quiet")}>{dict.admin.search}</button>
          {filtered && <Link href={base} className="self-center text-sm text-gulf-strong underline underline-offset-4">{dict.admin.clear}</Link>}
        </div>
      </form>

      {orgs.length === 0 ? (
        <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{filtered ? dict.orgs.noMatches : dict.orgs.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-panel border border-line bg-surface">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="bg-surface-sunk text-ink-muted">
              <tr>
                {[dict.orgs.columns.name, dict.orgs.columns.type, dict.orgs.columns.market, dict.orgs.columns.status, dict.orgs.columns.members, dict.orgs.suspendedMembers, dict.orgs.columns.invitations].map((c) => (
                  <th key={c} scope="col" className="px-4 py-2.5 text-start font-medium">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orgs.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-3">
                    <Link href={`${base}/${o.id}`} className="font-medium text-gulf-strong underline-offset-4 hover:underline">{o.name}</Link>
                    {o.legalName && <span className="block text-xs text-ink-muted">{o.legalName}</span>}
                  </td>
                  <td className="px-4 py-3">{dict.orgTypes[o.type]}</td>
                  <td className="px-4 py-3">{marketName(o.market)}</td>
                  <td className="px-4 py-3"><Chip tone={o.status === "active" ? "good" : "attention"}>{dict.orgs.status[o.status]}</Chip></td>
                  <td className="px-4 py-3 tabular-nums">{o.activeMembers}</td>
                  <td className="px-4 py-3 tabular-nums">{o.suspendedMembers}</td>
                  <td className="px-4 py-3 tabular-nums">{o.pendingInvitations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && (
        <section aria-labelledby="add-org" className="max-w-xl rounded-panel border border-line bg-surface p-5 sm:p-6">
          <h2 id="add-org" className="text-lg">{dict.orgs.addTitle}</h2>
          <p className="mt-1 text-sm text-ink-muted">{dict.orgs.intro}</p>
          <ActionForm action={createOrganizationAction} submitLabel={dict.orgs.add} pendingLabel={dict.orgs.adding} className="mt-5">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orgId" value={orgId} />
            <Field label={dict.orgs.name} name="name" required maxLength={160} autoComplete="organization" />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label={dict.orgs.type} name="type" options={CREATABLE_ORG_TYPES.map((t) => ({ value: t, label: dict.orgTypes[t] }))} />
              <SelectField label={dict.orgs.market} name="market" options={marketOptions(markets, page.locale, { enabledOnly: true })} />
            </div>
            <Field label={dict.orgs.adminEmail} name="adminEmail" type="email" required dir="ltr" autoComplete="off" />
          </ActionForm>
        </section>
      )}
    </div>
  );
}
