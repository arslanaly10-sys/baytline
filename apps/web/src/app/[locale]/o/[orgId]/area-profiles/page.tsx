import Link from "next/link";
import { listLocationSummaries } from "@baytline/developer";
import { actorOf, devSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { ago } from "@/lib/homes-format";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Chip } from "@/components/ui/Chip";
import { SampleBadge } from "@/components/dev/parts";

export default async function AreaProfilesPage({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  const { page, allowed, section, isDeveloper } = await devSection(locale, orgId, "area-profiles");
  if (!allowed || !isDeveloper) return <SectionShell page={page} section={section} allowed={allowed} />;
  const { dict } = page;
  const t = dict.loc.summary;
  const rows = await listLocationSummaries(getDb(), actorOf(page));
  const base = `/${page.locale}/o/${orgId}/projects`;
  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={dict.workspaces.developer.sections["area-profiles"].label} intro={t.intro} />
      <p className="max-w-[75ch] text-sm text-ink-muted">{dict.loc.providerNone}</p>
      {rows.length === 0 ? <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{t.empty}</p> : (
        <div className="overflow-x-auto rounded-panel border border-line">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-surface-sunk text-ink-muted"><tr>{(["project", "coords", "places", "verification", "updated"] as const).map((c) => <th key={c} scope="col" className="px-4 py-3 text-start font-medium">{t.columns[c]}</th>)}</tr></thead>
            <tbody className="divide-y divide-line bg-surface">
              {rows.map((r) => (
                <tr key={r.projectId} className="hover:bg-gulf-tint">
                  <th scope="row" className="px-4 py-3 text-start font-medium"><Link href={`${base}/${r.projectId}/location`} className="text-gulf-strong underline-offset-4 hover:underline">{r.name}</Link>{r.isSample && <span className="ms-2"><SampleBadge dict={dict} /></span>}<span className="block text-xs font-normal text-ink-muted">{r.city}</span></th>
                  <td className="px-4 py-3">{r.hasCoordinates ? t.hasCoords : <span className="text-ink-muted">{t.noCoords}</span>}</td>
                  <td className="px-4 py-3">{r.places}</td>
                  <td className="px-4 py-3">{r.verification ? <Chip tone={r.verification === "verified" ? "good" : "muted"}>{dict.loc.verification[r.verification]}</Chip> : <span className="text-ink-muted">{t.none}</span>}</td>
                  <td className="px-4 py-3 text-ink-muted">{r.updatedAt ? ago(r.updatedAt, page.locale) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
