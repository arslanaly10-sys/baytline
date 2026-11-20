import Link from "next/link";
import { hasCapability, PERMISSIONS, requiresApproval, ROLE_GRANTS, workspaceForOrgType, type Permission } from "@baytline/core";
import { format } from "@/i18n/format";
import { loadOrgPage } from "@/server/guards";
import { sectionDescription, sectionLabel } from "@/lib/sections";
import { ProvenanceLegend } from "@/components/ui/ProvenanceLegend";
import { getPortfolioSummary } from "@baytline/management";
import { getDb } from "@/server/db";
import { SummaryGrid } from "@/components/pm/Summary";

export default async function Overview({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  const { session, ctx, dict, locale: l } = await loadOrgPage(locale, orgId);
  const workspace = workspaceForOrgType(ctx.org.type);
  const ws = dict.workspaces[workspace.id];
  const base = `/${l}/o/${orgId}`;
  const sections = workspace.sections.filter((s) => hasCapability(ctx.principal, s.requires));
  const roles = [ctx.org.role];

  // Derived from the real grant table — not illustrative.
  const binding = [
    ...new Set(
      roles.flatMap((r) =>
        ROLE_GRANTS[r].map(([p]) => p).filter((p) => PERMISSIONS[p].effect === "consequential"),
      ),
    ),
  ] as Permission[];

  const showTrust = workspace.id !== "management";
  const summary = workspace.id === "management" && hasCapability(ctx.principal, "property.view")
    ? await getPortfolioSummary(getDb(), { userId: session.user.id, orgId: ctx.org.id })
    : null;

  return (
    <div className="space-y-12">
      <header>
        <p className="text-sm text-ink-muted">
          {ctx.org.type === "individual" ? session.user.displayName : ctx.org.name}
        </p>
        <h1 className="mt-1 font-display text-4xl leading-[1.05] sm:text-5xl">{ws.name}</h1>
        <p className="mt-3 max-w-[60ch] text-ink-muted">{ws.summary}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-muted">{dict.common.roles}</span>
          {roles.map((r) => (
            <span key={r} className="rounded-chip bg-gulf-tint px-2 py-0.5 text-sm text-gulf-strong">{dict.roles[r]}</span>
          ))}
        </div>
      </header>

      {summary && <SummaryGrid s={summary} dict={dict} base={base} />}

      <section aria-labelledby="planned-title">
        <h2 id="planned-title" className="text-lg">{dict.overview.plannedTitle}</h2>
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {sections.map((s) => (
            <li key={s.id}>
              <Link href={`${base}/${s.id}`} className="grid gap-1 py-4 hover:bg-surface sm:grid-cols-[14rem_1fr_auto] sm:items-baseline sm:gap-6 sm:px-3">
                <span className="font-medium text-gulf-strong">{sectionLabel(ws, s.id)}</span>
                <span className="text-sm text-ink-muted">{sectionDescription(ws, s.id)}</span>
                <span className="text-xs whitespace-nowrap text-ink-muted">{format(dict.common.milestone, { n: s.milestone })}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section aria-labelledby="guard-title" className="rounded-panel border border-line bg-surface p-5 sm:p-6">
          <h2 id="guard-title" className="text-lg">{dict.overview.guardrailTitle}</h2>
          <p className="mt-1 text-sm text-ink-muted">{dict.overview.guardrailIntro}</p>
          {binding.length === 0 ? (
            <p className="mt-4 text-sm">{dict.overview.noGuardrails}</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {binding.map((p) => (
                <li key={p} className="flex flex-wrap items-center justify-between gap-2 border-s-2 border-gulf ps-3 text-sm">
                  <span>{(dict.permissions as Record<string, string>)[p] ?? p}</span>
                  {requiresApproval(p) && (
                    <span className="rounded-chip border border-saffron px-1.5 text-xs text-ink">{dict.overview.approvalGated}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        {showTrust && <ProvenanceLegend dict={dict} />}
      </div>
    </div>
  );
}
