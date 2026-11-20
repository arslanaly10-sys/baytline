import pg from "pg";
import { runMigrations } from "./migrate";

/**
 * LOCAL DEVELOPMENT AND TESTS ONLY. Creates the three roles and a database
 * using a superuser connection, then migrates. Shared environments are
 * provisioned by infrastructure, never by this function.
 */
export type ProvisionOptions = {
  adminUrl: string;
  urls: { owner: string; auth: string; app: string };
  dbName: string;
  /** Drop and recreate the database first (tests). */
  reset?: boolean;
  log?: (m: string) => void;
};

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Unsafe identifier: ${s}`);
  return `"${s}"`;
};
const roleOf = (u: string) => decodeURIComponent(new URL(u).username);

export async function provisionLocal(o: ProvisionOptions): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("provisionLocal refuses to run in production");
  const log = o.log ?? (() => {});
  const admin = new pg.Client({ connectionString: o.adminUrl });
  await admin.connect();
  try {
    for (const u of Object.values(o.urls)) {
      const name = roleOf(u);
      const exists = (await admin.query("select 1 from pg_roles where rolname = $1", [name])).rowCount;
      const lit = (await admin.query<{ q: string }>("select quote_literal($1) as q", [decodeURIComponent(new URL(u).password)])).rows[0]!.q;
      await admin.query(
        `${exists ? "alter" : "create"} role ${ident(name)} with login nosuperuser nocreatedb nocreaterole nobypassrls password ${lit}`,
      );
    }
    const db = ident(o.dbName);
    if (o.reset) await admin.query(`drop database if exists ${db} with (force)`);
    if (!(await admin.query("select 1 from pg_database where datname = $1", [o.dbName])).rowCount) {
      await admin.query(`create database ${db} owner ${ident(roleOf(o.urls.owner))}`);
      log(`created database ${o.dbName}`);
    }
    await admin.query(`revoke all on database ${db} from public`);
    for (const u of Object.values(o.urls)) await admin.query(`grant connect on database ${db} to ${ident(roleOf(u))}`);
  } finally {
    await admin.end();
  }
  await runMigrations(withDb(o.urls.owner, o.dbName), log);
}

export function withDb(url: string, dbName: string): string {
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  return u.toString();
}
