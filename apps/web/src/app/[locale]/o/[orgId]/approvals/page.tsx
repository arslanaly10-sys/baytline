import Link from "next/link";
import { listPendingApprovals } from "@baytline/developer";
import { format } from "@/i18n/format";
import { actorOf, devSection } from "@/server/dev-page";
import { getDb } from "@/server/db";
import { day } from "@/lib/dev-format";
import { buttonClass } from "@/lib/button";
import { Chip } from "@/components/ui/Chip";
import { SectionShell } from "@/components/ui/SectionShell";
import { SectionHeader } from "@/components/ui/SectionHeader";

/** Versions awaiting a decision. Decisions are made on the version page, after reviewing it. */
export default async function ApprovalsPage({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  const { page, allowed, section, isDeveloper } = await devSection(locale, orgId, "approvals");
  if (!allowed || !isDeveloper) return <SectionShell page={page} section={section} allowed={allowed} />;
  const { dict } = page;
  const t = dict.dev.approvals;
  const items = await listPendingApprovals(getDb(), actorOf(page));
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="space-y-8">
      <SectionHeader eyebrow={page.ctx.org.name} title={dict.workspaces.developer.sections.approvals.label} intro={t.intro} />
      {items.length === 0 ? (
        <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{t.none}</p>
      ) : (
        <ul className="divide-y divide-line rounded-panel border border-line bg-surface">
          {items.map((i) => (
            <li key={i.versionId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <p className="flex flex-wrap items-center gap-2">
                  <Chip tone="neutral">{t.kinds[i.kind]}</Chip>
                  <span className="font-medium">{i.parentName}</span>
                  <span className="text-ink-muted">{format(dict.dev.pricing.version, { n: i.version })}</span>
                  {i.isOwnSubmission && <Chip tone="muted">{t.yours}</Chip>}
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  {i.projectName}. {format(t.effective, { date: day(i.effectiveFrom, locale) })}. {format(t.waiting, { date: when.format(i.submittedAt), name: i.submittedByName ?? "" })}
                </p>
              </div>
              <Link href={`/${locale}/o/${orgId}/projects/${i.projectId}/pricing/${i.kind === "price" ? "prices" : "plans"}/${i.versionId}`} className={buttonClass(i.canDecide ? "primary" : "quiet")}>
                {t.review}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
