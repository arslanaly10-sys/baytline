import Link from "next/link";
import { MapPin } from "@phosphor-icons/react/dist/ssr";
import type { SharedProject } from "@baytline/developer";
import type { OrgPage } from "@/server/guards";
import { ago } from "@/lib/homes-format";
import { SectionHeader } from "@/components/ui/SectionHeader";

export function PartnerInventory({ page, projects }: { page: OrgPage; projects: SharedProject[] }) {
  const { dict } = page;
  const t = dict.loc.partnerInventory;
  const base = `/${page.locale}/o/${page.ctx.org.id}/inventory`;
  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={dict.workspaces.brokerage.sections.inventory.label} intro={t.intro} />
      {projects.length === 0 ? <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{t.empty}</p> : (
        <ul className="grid gap-px overflow-hidden rounded-panel border border-line bg-line">
          {projects.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 bg-surface px-5 py-4">
              <span>
                <span className="font-medium">{p.name}</span>
                <span className="block text-sm text-ink-muted">{p.city} · {ago(p.grantedAt, page.locale)}</span>
              </span>
              {p.includeLocation
                ? <Link href={`${base}/${p.id}/location`} className="inline-flex items-center gap-1.5 text-sm text-gulf-strong underline underline-offset-4"><MapPin aria-hidden="true" className="size-4" />{t.location}</Link>
                : <span className="text-sm text-ink-muted">{t.notShared}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
