import { AppShell } from "@/components/shell/AppShell";
import { loadOrgPage } from "@/server/guards";
import { getMarket } from "@/server/session";
import { getMarketsConfig } from "@/server/markets";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; orgId: string }>;
}) {
  const { locale, orgId } = await params;
  const page = await loadOrgPage(locale, orgId);
  const [market, markets] = await Promise.all([getMarket(page.ctx.org.market ?? undefined), getMarketsConfig()]);
  return (
    <AppShell dict={page.dict} locale={page.locale} session={page.session} ctx={page.ctx} market={market} markets={markets}>
      {children}
    </AppShell>
  );
}
