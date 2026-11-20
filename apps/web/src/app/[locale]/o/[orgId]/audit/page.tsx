import Link from "next/link";
import { AUDIT_EVENT_TYPES, ROLES, workspaceForOrgType, type AuditOutcome } from "@baytline/core";
import { searchOrganizations } from "@baytline/platform";
import { listAuditEvents, type AuditRow } from "@baytline/identity";
import type { Dictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { checkSection, loadOrgPage } from "@/server/guards";
import { getDb } from "@/server/db";
import { getMarketsConfig, timeZoneOf } from "@/server/markets";
import { sectionLabel } from "@/lib/sections";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Field, SelectField } from "@/components/forms/Field";
import { buttonClass } from "@/lib/button";

const OUTCOMES: AuditOutcome[] = ["success", "failure", "denied"];
const PAGE = 50;

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orgId: string }>;
  searchParams: Promise<{ event?: string; outcome?: string; before?: string; actor?: string; org?: string; from?: string; to?: string }>;
}) {
  const { locale, orgId } = await params;
  const q = await searchParams;
  const page = await loadOrgPage(locale, orgId);
  const { allowed } = await checkSection(page, "audit");
  const { dict } = page;
  const ws = dict.workspaces[workspaceForOrgType(page.ctx.org.type).id];
  if (!allowed) {
    return (
      <div className="space-y-10">
        <SectionHeader eyebrow={page.ctx.org.name} title={sectionLabel(ws, "audit")} />
        <AccessDenied dict={dict} orgName={page.ctx.org.name} />
      </div>
    );
  }

  const outcome = OUTCOMES.find((o) => o === q.outcome);
  // Dates are read in the viewing organization's market time zone (from market settings).
  const timeZone = timeZoneOf(await getMarketsConfig(), page.ctx.org.market);
  const actor = { userId: page.session.user.id, orgId };
  const { scope, rows } = await listAuditEvents(getDb(), actor, {
    limit: PAGE,
    eventType: q.event,
    outcome,
    beforeId: q.before,
    actor: q.actor,
    orgId: q.org,
    from: q.from,
    to: q.to,
    timeZone,
  });
  // Organization filter is only offered to platform-wide viewers; for others the server ignores it anyway.
  const orgChoices = scope === "platform" ? await searchOrganizations(getDb(), actor).catch(() => []) : [];
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone });
  const base = `/${locale}/o/${orgId}/audit`;
  const filterQs = new URLSearchParams(
    Object.entries({ event: q.event, outcome, actor: q.actor, org: q.org, from: q.from, to: q.to }).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const filtered = filterQs.size > 0;
  const last = rows.at(-1);

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={page.ctx.org.name}
        title={sectionLabel(ws, "audit")}
        intro={scope === "platform" ? dict.audit.introPlatform : format(dict.audit.introOrg, { org: page.ctx.org.name })}
      />

      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        <SelectField
          label={dict.audit.eventFilter}
          name="event"
          defaultValue={q.event ?? ""}
          options={[{ value: "", label: dict.audit.allEvents }, ...AUDIT_EVENT_TYPES.map((t) => ({ value: t, label: dict.audit.events[t] }))]}
        />
        <SelectField
          label={dict.audit.outcomeFilter}
          name="outcome"
          defaultValue={outcome ?? ""}
          options={[{ value: "", label: dict.audit.allOutcomes }, ...OUTCOMES.map((o) => ({ value: o, label: dict.audit.outcomes[o] }))]}
        />
        <Field label={dict.audit.actorFilter} name="actor" type="search" placeholder={dict.audit.actorHint} defaultValue={q.actor ?? ""} className="min-w-[12rem]" />
        {scope === "platform" && (
          <SelectField
            label={dict.audit.orgFilter}
            name="org"
            defaultValue={q.org ?? ""}
            options={[{ value: "", label: dict.audit.allOrgs }, ...orgChoices.map((o) => ({ value: o.id, label: o.name }))]}
          />
        )}
        <Field label={dict.audit.fromDate} name="from" type="date" defaultValue={q.from ?? ""} />
        <Field label={dict.audit.toDate} name="to" type="date" defaultValue={q.to ?? ""} />
        <button type="submit" className={buttonClass("quiet")}>{dict.audit.apply}</button>
        {filtered && <Link href={base} className="self-center text-sm text-gulf-strong underline underline-offset-4">{dict.audit.clear}</Link>}
        <p className="basis-full text-xs text-ink-muted">{format(dict.audit.dateHint, { zone: timeZone })}</p>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{dict.audit.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-panel border border-line bg-surface">
          <table className="w-full min-w-[44rem] text-start text-sm">
            <thead className="bg-surface-sunk text-ink-muted">
              <tr>
                {(["when", "event", "outcome", "actor", "details"] as const).map((c) => (
                  <th key={c} scope="col" className="px-4 py-2.5 text-start font-medium">{dict.audit.columns[c]}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-ink-muted">
                    <time dateTime={r.occurredAt.toISOString()}>{when.format(r.occurredAt)}</time>
                  </td>
                  <td className="px-4 py-3">
                    {(dict.audit.events as Record<string, string>)[r.eventType] ?? r.eventType}
                    {scope === "platform" && r.orgName && <span className="block text-xs text-ink-muted">{r.orgName}</span>}
                  </td>
                  <td className="px-4 py-3"><OutcomeChip outcome={r.outcome} dict={dict} /></td>
                  <td className="px-4 py-3">{actorLabel(r, dict)}</td>
                  <td className="px-4 py-3 text-ink-muted">{details(r, dict, ws)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav className="flex gap-4 text-sm">
        {q.before && <Link href={`${base}?${filterQs}`} className="text-gulf-strong underline underline-offset-4">{dict.audit.newest}</Link>}
        {rows.length === PAGE && last && (
          <Link href={`${base}?${new URLSearchParams({ ...Object.fromEntries(filterQs), before: last.id })}`} className="text-gulf-strong underline underline-offset-4">
            {dict.audit.older}
          </Link>
        )}
      </nav>
    </div>
  );
}

function OutcomeChip({ outcome, dict }: { outcome: AuditOutcome; dict: Dictionary }) {
  const cls =
    outcome === "success" ? "border-mangrove text-mangrove" : outcome === "denied" ? "border-coral text-coral" : "border-saffron text-ink";
  return <span className={`inline-block rounded-chip border px-1.5 text-xs whitespace-nowrap ${cls}`}>{dict.audit.outcomes[outcome]}</span>;
}

function actorLabel(r: AuditRow, dict: Dictionary): string {
  if (r.actorKind === "system") return dict.audit.system;
  if (!r.actorUserId) return dict.audit.anonymous;
  return r.actorName ?? dict.audit.unknownUser;
}

/** Metadata is structured and non-sensitive by construction; codes are translated for people. */
function details(r: AuditRow, dict: Dictionary, ws: Dictionary["workspaces"][keyof Dictionary["workspaces"]]): string {
  const roleName = (v: unknown) => (typeof v === "string" && v in ROLES ? dict.roles[v as keyof typeof ROLES] : String(v));
  const reasons = dict.audit.reasons as Record<string, string>;
  const reasonText = (v: unknown) => {
    const code = String(v);
    if (code.startsWith("missing_")) return reasons.missing_permission!;
    return reasons[code] ?? code.replaceAll("_", " ");
  };
  const m = r.metadata ?? {};
  const parts: string[] = [];
  if (m.from !== undefined && m.to !== undefined && r.eventType.startsWith("membership.")) parts.push(`${roleName(m.from)} → ${roleName(m.to)}`);
  if (m.role) parts.push(roleName(m.role));
  if (m.reason) parts.push(reasonText(m.reason));
  if (m.via) parts.push(reasonText(m.via));
  // For section denials, name the section rather than printing a path with IDs.
  if (r.eventType === "access.denied" && r.targetId?.startsWith("/o/")) {
    const section = r.targetId.split("/")[3];
    if (section) parts.push(sectionLabel(ws, section));
  }
  return parts.join(". ");
}
