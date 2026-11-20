import { workspaceForOrgType, type WorkspaceSection } from "@baytline/core";
import type { OrgPage } from "@/server/guards";
import { format } from "@/i18n/format";
import { sectionDescription, sectionLabel } from "@/lib/sections";
import { AccessDenied } from "./AccessDenied";
import { SectionHeader } from "./SectionHeader";

/** A workspace section that isn't built yet, or that this role can't open. */
export function SectionShell({ page, section, allowed }: { page: OrgPage; section: WorkspaceSection; allowed: boolean }) {
  const ws = page.dict.workspaces[workspaceForOrgType(page.ctx.org.type).id];
  return (
    <div className="space-y-10">
      <SectionHeader eyebrow={ws.name} title={sectionLabel(ws, section.id)} intro={sectionDescription(ws, section.id)} />
      {!allowed ? (
        <AccessDenied dict={page.dict} orgName={page.ctx.org.name} />
      ) : (
        <div className="rounded-panel border-2 border-dashed border-line px-6 py-14 text-center">
          <p className="text-ink">{page.dict.common.notBuiltYet}</p>
          <p className="mt-1 text-sm text-ink-muted">{format(page.dict.common.milestone, { n: section.milestone })}</p>
        </div>
      )}
    </div>
  );
}
