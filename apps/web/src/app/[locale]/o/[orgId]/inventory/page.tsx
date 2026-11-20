import Link from "next/link";
import { UNIT_STATUSES } from "@baytline/core";
import { listProjects, listSharedProjects, listUnits } from "@baytline/developer";
import { PartnerInventory } from "@/components/location/PartnerInventory";
import { actorOf, devSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { buttonClass } from "@/lib/button";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Field, SelectField } from "@/components/forms/Field";
import { UnitTable } from "@/components/dev/parts";

type Search = { project?: string; status?: string; verification?: string; q?: string };

/** All units across the developer's projects. Brokerages see the projects shared with them (units and prices come in a later milestone). */
export default async function InventoryPage({ params, searchParams }: { params: Promise<{ locale: string; orgId: string }>; searchParams: Promise<Search> }) {
  const { locale, orgId } = await params;
  const q = await searchParams;
  const { page, allowed, section, isDeveloper } = await devSection(locale, orgId, "inventory");
  if (allowed && page.ctx.org.type === "brokerage") {
    return <PartnerInventory page={page} projects={await listSharedProjects(getDb(), actorOf(page))} />;
  }
  if (!allowed || !isDeveloper) return <SectionShell page={page} section={section} allowed={allowed} />;
  const { dict } = page;
  const t = dict.dev.units;
  const a = actorOf(page);
  const [projects, units] = await Promise.all([
    listProjects(getDb(), a),
    listUnits(getDb(), a, { projectId: q.project || undefined, status: q.status, verification: q.verification, q: q.q }),
  ]);
  const base = `/${locale}/o/${orgId}`;
  const filtered = Boolean(q.project || q.status || q.verification || q.q);
  const any = { value: "", label: dict.admin.any };
  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={dict.workspaces.developer.sections.inventory.label} intro={t.intro} />
      <form method="get" role="search" className="flex flex-wrap items-end gap-3">
        <Field label={t.filters.code} name="q" type="search" defaultValue={q.q ?? ""} dir="ltr" />
        <SelectField label={t.filters.project} name="project" defaultValue={q.project ?? ""} options={[any, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
        <SelectField label={t.filters.status} name="status" defaultValue={q.status ?? ""} options={[any, ...UNIT_STATUSES.map((s) => ({ value: s, label: t.statuses[s] }))]} />
        <SelectField label={t.filters.verification} name="verification" defaultValue={q.verification ?? ""}
          options={[any, ...(["verified", "owner_reported", "pending", "unverified", "disputed"] as const).map((v) => ({ value: v, label: t.verifications[v] }))]} />
        <button type="submit" className={buttonClass("quiet")}>{dict.admin.search}</button>
        {filtered && <Link href={`${base}/inventory`} className="self-center text-sm text-gulf-strong underline underline-offset-4">{dict.admin.clear}</Link>}
      </form>
      {units.length === 0 ? (
        <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{filtered ? t.noMatches : t.none}</p>
      ) : (
        <UnitTable dict={dict} units={units} base={base} locale={locale} showProject />
      )}
      <p className="text-xs text-ink-muted">{t.priceHint}</p>
    </div>
  );
}
