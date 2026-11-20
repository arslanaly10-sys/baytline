import Link from "next/link";
import { workspaceForOrgType } from "@baytline/core";
import { searchUsers } from "@baytline/platform";
import { checkSection, loadOrgPage } from "@/server/guards";
import { getDb } from "@/server/db";
import { getMarketsConfig, timeZoneOf } from "@/server/markets";
import { sectionDescription, sectionLabel } from "@/lib/sections";
import { buttonClass } from "@/lib/button";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { Chip } from "@/components/ui/Chip";
import { PlaceholderBadge } from "@/components/ui/PlaceholderBadge";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Field, SelectField } from "@/components/forms/Field";

export default async function UsersPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<{ q?: string; status?: string }> }) {
  const { locale, orgId } = await params;
  const q = await searchParams;
  const page = await loadOrgPage(locale, orgId);
  const { allowed } = await checkSection(page, "users");
  const { dict } = page;
  const ws = dict.workspaces[workspaceForOrgType(page.ctx.org.type).id];
  const header = <SectionHeader eyebrow={page.ctx.org.name} title={sectionLabel(ws, "users")} intro={dict.users.intro} />;
  if (!allowed) return <div className="space-y-10">{header}<AccessDenied dict={dict} orgName={page.ctx.org.name} /></div>;

  const [users, markets] = await Promise.all([searchUsers(getDb(), { userId: page.session.user.id, mfa: page.session.mfaVerified, orgId }, q), getMarketsConfig()]);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: timeZoneOf(markets, page.ctx.org.market) });
  const base = `/${locale}/o/${orgId}/users`;
  const filtered = Boolean(q.q || q.status);

  return (
    <div className="space-y-8">
      {header}
      <p className="sr-only">{sectionDescription(ws, "users")}</p>
      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        <Field label={dict.users.searchLabel} name="q" type="search" defaultValue={q.q ?? ""} className="min-w-[16rem] flex-1" />
        <SelectField label={dict.users.statusFilter} name="status" defaultValue={q.status ?? ""}
          options={[{ value: "", label: dict.admin.any }, { value: "active", label: dict.users.status.active }, { value: "disabled", label: dict.users.status.disabled }]} />
        <button type="submit" className={buttonClass("quiet")}>{dict.admin.search}</button>
        {filtered && <Link href={base} className="self-center text-sm text-gulf-strong underline underline-offset-4">{dict.admin.clear}</Link>}
      </form>

      {users.length === 0 ? (
        <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{dict.users.noMatches}</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
          {users.map((u) => (
            <li key={u.id}>
              <Link href={`${base}/${u.id}`} className="grid gap-2 px-5 py-4 hover:bg-gulf-tint sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-6">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gulf-strong">{u.displayName}</span>
                    {u.isPlaceholder && <PlaceholderBadge label={dict.states.placeholder} hint={dict.states.placeholderHint} />}
                  </span>
                  <span className="block truncate text-sm text-ink-muted"><bdi dir="ltr">{u.email}</bdi></span>
                </span>
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <Chip tone={u.status === "active" ? "good" : "problem"}>{dict.users.status[u.status]}</Chip>
                  {!u.emailVerified && <Chip tone="muted">{dict.states.unverified}</Chip>}
                </span>
                <span className="text-sm text-ink-muted">
                  {dict.users.columns.memberships}: <span className="tabular-nums text-ink">{u.activeMemberships}</span>
                  <span className="block">{date.format(u.createdAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
