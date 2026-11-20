import Link from "next/link";
import { LOCALES, workspaceForOrgType } from "@baytline/core";
import { checkSection, loadOrgPage } from "@/server/guards";
import { getMarketsConfig } from "@/server/markets";
import { sectionLabel } from "@/lib/sections";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { Chip } from "@/components/ui/Chip";
import { SectionHeader } from "@/components/ui/SectionHeader";

export default async function MarketsPage({ params }: { params: Promise<{ locale: string; orgId: string }> }) {
  const { locale, orgId } = await params;
  const page = await loadOrgPage(locale, orgId);
  const { allowed } = await checkSection(page, "markets");
  const { dict } = page;
  const ws = dict.workspaces[workspaceForOrgType(page.ctx.org.type).id];
  const header = <SectionHeader eyebrow={page.ctx.org.name} title={sectionLabel(ws, "markets")} intro={dict.marketsAdmin.intro} />;
  if (!allowed) return <div className="space-y-10">{header}<AccessDenied dict={dict} orgName={page.ctx.org.name} /></div>;

  const markets = await getMarketsConfig();
  const langName = (code: string) => LOCALES.find((l) => l.code === code)?.nativeName ?? code;
  const cols = dict.marketsAdmin.columns;

  return (
    <div className="space-y-8">
      {header}
      <div className="overflow-x-auto rounded-panel border border-line bg-surface">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-surface-sunk text-ink-muted">
            <tr>
              {[cols.market, cols.currency, cols.timeZone, cols.locale, cols.status, cols.rules].map((c) => (
                <th key={c} scope="col" className="px-4 py-2.5 text-start font-medium">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {markets.map((m) => (
              <tr key={m.code}>
                <td className="px-4 py-3">
                  <Link href={`/${locale}/o/${orgId}/markets/${m.code}`} className="font-medium text-gulf-strong underline-offset-4 hover:underline">{m.name[page.locale]}</Link>
                  <span className="block text-xs text-ink-muted" dir="ltr">{m.code}</span>
                </td>
                <td className="px-4 py-3" dir="ltr">{m.currency}</td>
                <td className="px-4 py-3" dir="ltr">{m.timeZone}</td>
                <td className="px-4 py-3">{langName(m.defaultLocale)}</td>
                <td className="px-4 py-3"><Chip tone={m.status === "enabled" ? "good" : "muted"}>{dict.marketsAdmin.status[m.status]}</Chip></td>
                <td className="px-4 py-3">
                  {m.rulesNeedingSetup > 0 ? (
                    <Chip tone="attention"><span className="tabular-nums">{m.rulesNeedingSetup} / {m.rulesTotal}</span> {dict.marketsAdmin.needsSetup}</Chip>
                  ) : (
                    <Chip tone="good">{dict.marketsAdmin.configured}</Chip>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="max-w-[70ch] text-sm text-ink-muted">{dict.marketsAdmin.seedNote}</p>
    </div>
  );
}
