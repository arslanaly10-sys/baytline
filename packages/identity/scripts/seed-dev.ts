/**
 * LOCAL DEVELOPMENT ONLY: creates labelled placeholder accounts and organizations.
 *   pnpm db:seed-dev
 * All emails use the reserved .test domain; all names start with "Placeholder".
 * The password comes from DEV_SEED_PASSWORD (your choice, never committed).
 */
import pg from "pg";
import type { MarketCode, OrgType, Role } from "@baytline/core";
import { hashPassword } from "../src/crypto";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to create placeholder accounts with NODE_ENV=production.");
  process.exit(1);
}
const ownerUrl = process.env.DATABASE_OWNER_URL;
const password = process.env.DEV_SEED_PASSWORD;
if (!ownerUrl || !password || password.length < 12) {
  console.error("Set DATABASE_OWNER_URL and DEV_SEED_PASSWORD (min 12 characters) in apps/web/.env.local.");
  process.exit(1);
}

const ORGS: { key: string; type: Exclude<OrgType, "individual">; name: string; market: MarketCode }[] = [
  { key: "platform", type: "platform", name: "Platform operations", market: "AE" },
  { key: "dev", type: "developer", name: "Placeholder Developer", market: "AE" },
  { key: "pm", type: "property_manager", name: "Placeholder Property Management", market: "QA" },
  { key: "brk", type: "brokerage", name: "Placeholder Brokerage", market: "AE" },
];

const USERS: { email: string; name: string; memberships: [string, Role][]; personal?: boolean }[] = [
  { email: "platform-admin@placeholder.test", name: "Placeholder platform admin", memberships: [["platform", "platform_admin"]] },
  { email: "platform-support@placeholder.test", name: "Placeholder platform support", memberships: [["platform", "platform_support"]] },
  { email: "developer-admin@placeholder.test", name: "Placeholder developer admin", memberships: [["dev", "developer_admin"]] },
  { email: "developer-sales@placeholder.test", name: "Placeholder sales manager", memberships: [["dev", "developer_sales_manager"]] },
  { email: "developer-inventory@placeholder.test", name: "Placeholder inventory manager", memberships: [["dev", "developer_inventory_manager"]] },
  { email: "developer-finance@placeholder.test", name: "Placeholder finance", memberships: [["dev", "developer_finance"]] },
  { email: "pm-admin@placeholder.test", name: "Placeholder management admin", memberships: [["pm", "pm_admin"]] },
  { email: "broker-admin@placeholder.test", name: "Placeholder brokerage admin", memberships: [["brk", "brokerage_admin"]] },
  { email: "agent@placeholder.test", name: "Placeholder agent", memberships: [["brk", "brokerage_agent"]], personal: true },
  { email: "customer@placeholder.test", name: "Placeholder customer", memberships: [], personal: true },
];

const c = new pg.Client({ connectionString: ownerUrl });
await c.connect();
try {
  await c.query("begin");
  const orgIds: Record<string, string> = {};
  for (const o of ORGS) {
    const found = await c.query<{ id: string }>(
      o.type === "platform" ? "select id from app.organizations where type = 'platform'" : "select id from app.organizations where type = $1 and name = $2",
      o.type === "platform" ? [] : [o.type, o.name],
    );
    orgIds[o.key] =
      found.rows[0]?.id ??
      (await c.query<{ id: string }>("insert into app.organizations (type, name, market) values ($1, $2, $3) returning id", [o.type, o.name, o.market])).rows[0]!.id;
  }
  const hash = await hashPassword(password);
  for (const u of USERS) {
    if ((await c.query("select 1 from app.users where email = $1", [u.email])).rowCount) {
      console.log(`exists  ${u.email}`);
      continue;
    }
    const { rows } = await c.query<{ id: string }>(
      "insert into app.users (email, display_name, is_placeholder, email_verified_at) values ($1, $2, true, now()) returning id",
      [u.email, u.name],
    );
    const id = rows[0]!.id;
    await c.query("insert into auth.credentials (user_id, password_hash) values ($1, $2)", [id, hash]);
    for (const [org, role] of u.memberships) {
      await c.query("insert into app.memberships (org_id, user_id, role, updated_by) values ($1, $2, $3, $2)", [orgIds[org], id, role]);
    }
    if (u.personal) {
      const p = await c.query<{ id: string }>("insert into app.organizations (type, name, created_by) values ('individual', $1, $2) returning id", [u.name, id]);
      await c.query("insert into app.memberships (org_id, user_id, role, updated_by) values ($1, $2, 'individual', $2)", [p.rows[0]!.id, id]);
    }
    console.log(`created ${u.email}`);
  }
  // Development-only sample project: flagged is_sample, so it's labelled everywhere, can't be
  // verified or shared, and its availability is never shown as confirmed. No prices are seeded.
  const devOrg = orgIds["dev"]!;
  const hasSample = await c.query("select 1 from app.projects where org_id = $1 and is_sample", [devOrg]);
  if (!hasSample.rowCount) {
    const { rows: pr } = await c.query<{ id: string }>(
      `insert into app.projects (org_id, name, market, city, location, property_types, description, status, is_sample)
       values ($1, 'Sample project (not real)', 'AE', 'Sample city', 'Sample district', '{apartment,penthouse}',
               'Development-only sample record for trying the workspace. Not a real project.', 'planning', true) returning id`,
      [devOrg],
    );
    const { rows: ph } = await c.query<{ id: string }>(
      "insert into app.project_phases (org_id, project_id, kind, name, sort_order) values ($1, $2, 'building', 'Sample building', 1) returning id",
      [devOrg, pr[0]!.id],
    );
    for (const [code, type, beds, area, floor, status] of [
      ["S-101", "apartment", 1, "75", 1, "available"],
      ["S-102", "apartment", 2, "110", 1, "available"],
      ["S-201", "apartment", 0, "48", 2, "draft"],
      ["S-PH1", "penthouse", 4, "310", 20, "unavailable"],
    ] as const) {
      await c.query(
        `insert into app.units (org_id, project_id, phase_id, code, property_type, bedrooms, area_sqm, floor, status, is_sample, source_ref)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, 'sample-seed')`,
        [devOrg, pr[0]!.id, ph[0]!.id, code, type, beds, area, floor, status],
      );
    }
    console.log("created sample project (flagged as sample)");
  }

  await c.query("commit");
  console.log("\nPlaceholder accounts ready. Sign in with any address above and DEV_SEED_PASSWORD.");
} catch (e) {
  await c.query("rollback");
  throw e;
} finally {
  await c.end();
}
