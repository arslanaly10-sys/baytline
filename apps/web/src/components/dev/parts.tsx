import Link from "next/link";
import { PROJECT_STATUSES, PROPERTY_TYPES, UNIT_STATUSES, type Permission, type VersionStatus } from "@baytline/core";
import type { Phase, ProjectDetail, UnitRow } from "@baytline/developer";
import type { MarketConfig } from "@baytline/platform";
import type { Dictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { money } from "@/lib/dev-format";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { ProvenanceChip } from "@/components/ui/ProvenanceChip";
import { SampleStamp } from "@/components/ui/SampleStamp";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Field, SelectField } from "@/components/forms/Field";
import { ProjectNav } from "./ProjectNav";

export function SampleBadge({ dict }: { dict: Dictionary }) {
  return <SampleStamp label={dict.dev.sample} title={dict.dev.sampleHint} />;
}

/** Header and tabs shared by every page of one project. */
export function ProjectFrame({
  dict,
  base,
  project,
  can,
  children,
}: {
  dict: Dictionary;
  base: string;
  project: ProjectDetail;
  can: (p: Permission) => boolean;
  children: React.ReactNode;
}) {
  const p = `${base}/projects/${project.id}`;
  const t = dict.dev.projects.nav;
  const tabs = [
    { href: p, label: t.overview, exact: true },
    ...(can("inventory.view") ? [{ href: `${p}/units`, label: t.units }] : []),
    ...(can("price.view") ? [{ href: `${p}/pricing`, label: t.pricing }] : []),
    ...(can("document.view") ? [{ href: `${p}/documents`, label: t.documents }] : []),
    ...(can("partner.view") ? [{ href: `${p}/partners`, label: t.partners }] : []),
    ...(can("area_profile.view") ? [{ href: `${p}/location`, label: dict.loc.tab }] : []),
    { href: `${p}/listing`, label: dict.cx.org.publish.tab },
  ];
  return (
    <div className="space-y-8">
      <p>
        <Link href={`${base}/projects`} className="text-sm text-gulf-strong underline underline-offset-4">{dict.dev.projects.allProjects}</Link>
      </p>
      <SectionHeader eyebrow={`${project.city}${project.location ? `, ${project.location}` : ""}`} title={project.name}>
        <div className="flex flex-wrap items-center gap-2">
          {project.isSample && <SampleBadge dict={dict} />}
          <Chip tone={projectTone(project.status)}>{dict.dev.projects.statuses[project.status]}</Chip>
        </div>
      </SectionHeader>
      {project.isSample && <p className="rounded-control border-s-4 border-saffron bg-surface px-3 py-2 text-sm">{dict.dev.sampleHint}</p>}
      <ProjectNav items={tabs} label={project.name} />
      {children}
    </div>
  );
}

export function projectTone(s: ProjectDetail["status"]): ChipTone {
  return s === "cancelled" ? "muted" : s === "on_hold" ? "attention" : s === "completed" ? "good" : "neutral";
}

export function unitTone(s: UnitRow["status"]): ChipTone {
  return s === "available" ? "good" : s === "reserved" ? "attention" : s === "sold" ? "neutral" : "muted";
}

export function versionTone(s: VersionStatus): ChipTone {
  return s === "approved" ? "good" : s === "submitted" ? "attention" : s === "rejected" ? "problem" : "muted";
}

export function VersionChip({ status, dict }: { status: VersionStatus; dict: Dictionary }) {
  return <Chip tone={versionTone(status)}>{dict.dev.pricing.statuses[status]}</Chip>;
}

/** Fields shared by create and edit. Markets come from platform configuration. */
export function ProjectFields({ dict, locale, markets, project }: { dict: Dictionary; locale: "en" | "ar"; markets: MarketConfig[]; project?: ProjectDetail }) {
  const f = dict.dev.projects.fields;
  const marketOpts = markets.filter((m) => m.status === "enabled" || m.code === project?.market).map((m) => ({ value: m.code, label: m.name[locale] }));
  return (
    <>
      <Field label={f.name} name="name" defaultValue={project?.name} required maxLength={160} />
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField label={f.market} name="market" defaultValue={project?.market ?? marketOpts[0]?.value} options={marketOpts} />
        <Field label={f.city} name="city" defaultValue={project?.city} required maxLength={80} />
        <Field label={f.location} name="location" defaultValue={project?.location ?? ""} maxLength={200} />
      </div>
      <fieldset>
        <legend className="text-sm font-medium">{f.propertyTypes}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {PROPERTY_TYPES.map((t) => (
            <label key={t} className="inline-flex cursor-pointer items-center gap-2 rounded-control border border-line px-2.5 py-1.5 text-sm has-[:checked]:border-gulf has-[:checked]:bg-gulf-tint">
              <input type="checkbox" name="propertyTypes" value={t} defaultChecked={project?.propertyTypes.includes(t)} className="accent-[var(--gulf)]" />
              {dict.dev.projects.propertyTypes[t]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={f.launchDate} name="launchDate" type="date" defaultValue={project?.launchDate ?? ""} />
        <Field label={f.handoverDate} name="handoverDate" type="date" defaultValue={project?.handoverDate ?? ""} />
        <SelectField label={f.status} name="status" defaultValue={project?.status ?? "planning"} options={PROJECT_STATUSES.map((s) => ({ value: s, label: dict.dev.projects.statuses[s] }))} />
      </div>
      <label className="block">
        <span className="block text-sm font-medium">{f.description}</span>
        <textarea name="description" defaultValue={project?.description ?? ""} maxLength={4000} rows={4} className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-sm" />
      </label>
    </>
  );
}

export function UnitFields({ dict, phases, unit, canSetBinding }: { dict: Dictionary; phases: Phase[]; unit?: UnitRow; canSetBinding: boolean }) {
  const t = dict.dev.units;
  // Binding statuses are only offered to people who may set them (the server enforces it regardless).
  const statuses = UNIT_STATUSES.filter((s) => canSetBinding || (s !== "reserved" && s !== "sold") || s === unit?.status);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t.code} name="code" defaultValue={unit?.code} required maxLength={40} dir="ltr" />
        <SelectField label={t.phase} name="phaseId" defaultValue={unit?.phaseId ?? ""} options={[{ value: "", label: t.noPhase }, ...phases.map((p) => ({ value: p.id, label: p.name }))]} />
        <SelectField label={t.propertyType} name="propertyType" defaultValue={unit?.propertyType} options={PROPERTY_TYPES.map((p) => ({ value: p, label: dict.dev.projects.propertyTypes[p] }))} />
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label={t.bedrooms} hint={t.bedroomsHint} name="bedrooms" type="number" min={0} max={20} defaultValue={unit?.bedrooms ?? ""} />
        <Field label={t.area} name="areaSqm" inputMode="decimal" defaultValue={unit?.areaSqm ?? ""} pattern="\d+(\.\d{1,2})?" />
        <Field label={t.floor} name="floor" type="number" min={-5} max={200} defaultValue={unit?.floor ?? ""} />
        <SelectField label={t.status} name="status" defaultValue={unit?.status ?? "draft"} disabled={!canSetBinding && (unit?.status === "reserved" || unit?.status === "sold")}
          options={statuses.map((s) => ({ value: s, label: t.statuses[s] }))} />
      </div>
      {!canSetBinding && (unit?.status === "reserved" || unit?.status === "sold") && <input type="hidden" name="status" value={unit.status} />}
      <p className="text-xs text-ink-muted">{t.bindingHint}</p>
      <Field label={t.sourceRef} hint={t.sourceRefHint} name="sourceRef" defaultValue={unit?.sourceRef ?? ""} maxLength={120} dir="ltr" />
    </>
  );
}

export function UnitTable({ dict, units, base, locale, showProject }: { dict: Dictionary; units: UnitRow[]; base: string; locale: string; showProject?: boolean }) {
  const t = dict.dev.units;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  return (
    <div className="overflow-x-auto rounded-panel border border-line bg-surface">
      <table className="w-full min-w-[56rem] text-sm">
        <thead className="bg-surface-sunk text-ink-muted">
          <tr>
            {[t.code, ...(showProject ? [t.filters.project] : []), t.phase, t.propertyType, t.bedrooms, t.area, t.status, t.price, t.availability, t.lastUpdated].map((c) => (
              <th key={c} scope="col" className="px-3 py-2.5 text-start font-medium">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {units.map((u) => (
            <tr key={u.id} className="align-top">
              <td className="px-3 py-2.5">
                <Link href={`${base}/projects/${u.projectId}/units/${u.id}`} className="font-medium text-gulf-strong underline-offset-4 hover:underline" dir="ltr">{u.code}</Link>
                {u.isSample && <span className="ms-2"><SampleBadge dict={dict} /></span>}
              </td>
              {showProject && <td className="px-3 py-2.5">{u.projectName}</td>}
              <td className="px-3 py-2.5">{u.phaseName ?? <span className="text-ink-muted">{t.noPhase}</span>}</td>
              <td className="px-3 py-2.5">{dict.dev.projects.propertyTypes[u.propertyType]}</td>
              <td className="px-3 py-2.5 tabular-nums">{u.bedrooms === 0 ? t.studio : (u.bedrooms ?? "")}</td>
              <td className="px-3 py-2.5 tabular-nums">{u.areaSqm ?? ""}</td>
              <td className="px-3 py-2.5"><Chip tone={unitTone(u.status)}>{t.statuses[u.status]}</Chip></td>
              <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">{u.price ? money(u.price.minor, u.price.currency, locale) : <span className="text-ink-muted">{t.noPrice}</span>}</td>
              <td className="px-3 py-2.5"><ProvenanceChip status={u.availability} label={dict.provenance[u.availability]} /></td>
              <td className="px-3 py-2.5 whitespace-nowrap text-ink-muted">{date.format(u.lastUpdatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function unitsSummary(dict: Dictionary, c: ProjectDetail["unitCounts"]) {
  return format(dict.dev.projects.unitsSummary, { available: c.available, reserved: c.reserved, sold: c.sold });
}
