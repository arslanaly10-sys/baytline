import pg from "pg";

export type Client = pg.PoolClient;

/**
 * Two runtime pools with different database roles:
 *  - auth: credentials, sessions, reset tokens. Used only by @baytline/identity auth code.
 *  - app:  everything else, always inside withAppTx() so row-level security applies.
 * The owner role (migrations) is never used at runtime.
 */
export type Db = { app: pg.Pool; auth: pg.Pool };

export class DbConfigError extends Error {}

const REQUIRED = ["DATABASE_APP_URL", "DATABASE_AUTH_URL"] as const;

export function missingDbConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  return REQUIRED.filter((k) => !env[k]);
}

export function createDb(env: NodeJS.ProcessEnv = process.env): Db {
  const missing = missingDbConfig(env);
  if (missing.length) throw new DbConfigError(`Database is not configured: set ${missing.join(", ")}`);
  const opts = { max: 10, idleTimeoutMillis: 30_000, application_name: "baytline" };
  return {
    app: new pg.Pool({ connectionString: env.DATABASE_APP_URL, ...opts }),
    auth: new pg.Pool({ connectionString: env.DATABASE_AUTH_URL, ...opts }),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

export type RlsContext = { userId: string | null; orgId?: string | null };

/**
 * Runs fn in a transaction on the app pool with the RLS settings applied
 * (transaction-local, so pooled connections never carry them over).
 */
export async function withAppTx<T>(db: Db, ctx: RlsContext, fn: (c: Client) => Promise<T>): Promise<T> {
  if (ctx.userId !== null && !isUuid(ctx.userId)) throw new Error("withAppTx: invalid userId");
  if (ctx.orgId && !isUuid(ctx.orgId)) throw new Error("withAppTx: invalid orgId");
  const c = await db.app.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [
      ctx.userId ?? "",
      ctx.orgId ?? "",
    ]);
    const result = await fn(c);
    await c.query("commit");
    return result;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function withAuthTx<T>(db: Db, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await db.auth.connect();
  try {
    await c.query("begin");
    const result = await fn(c);
    await c.query("commit");
    return result;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Postgres raises our domain errors as `raise exception '<code>'`. */
export function dbErrorCode(e: unknown): string | undefined {
  return e instanceof Error && "code" in e ? (e as pg.DatabaseError).message : undefined;
}

export { runMigrations } from "./migrate";
export { provisionLocal, withDb } from "./provision";
