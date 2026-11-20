import type { Db } from "@baytline/db";

/**
 * Providers the platform knows about. Credentials are NEVER stored here or in the
 * database: they're injected by the deployment's secret manager as environment
 * variables. Only the variable NAMES appear in the UI, with present/missing.
 */
export type IntegrationKind = "infrastructure" | "messaging" | "storage" | "ai" | "data_feed" | "advertising" | "location";

export type CheckResult = { ok: boolean; summary: string; latencyMs: number };

export type ProviderDef = {
  key: string;
  kind: IntegrationKind;
  /** Roadmap milestone that delivers the adapter (docs/roadmap.md). */
  milestone: number;
  /** Secret names the adapter needs. Values are never read beyond "is it set?". */
  secrets: readonly string[];
  /** True once an adapter exists in code. */
  adapterAvailable: boolean;
  /** Core infrastructure the app can't run without. Can't be "turned off" (that would only mislabel it). */
  required?: boolean;
  /** Local stand-in that does nothing real, e.g. printing emails to a log. */
  developmentOnly?: (env: NodeJS.ProcessEnv) => boolean;
  /** Real connection test. Must not return secret values in its summary. */
  check?: (ctx: { db: Db }) => Promise<CheckResult>;
};

async function timed(fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  return Math.round(performance.now() - start);
}

export const PROVIDERS: readonly ProviderDef[] = [
  {
    key: "database",
    kind: "infrastructure",
    milestone: 2,
    secrets: ["DATABASE_APP_URL", "DATABASE_AUTH_URL"],
    adapterAvailable: true,
    required: true,
    async check({ db }) {
      try {
        const latencyMs = await timed(async () => {
          await db.app.query("select 1");
          await db.auth.query("select 1");
        });
        return { ok: true, latencyMs, summary: "App and auth connections answered." };
      } catch (e) {
        // Error codes only: driver messages can echo host names or user names.
        const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "unknown";
        return { ok: false, latencyMs: 0, summary: `Connection failed (code ${code}).` };
      }
    },
  },
  {
    key: "email",
    kind: "messaging",
    milestone: 8,
    secrets: ["MAIL_PROVIDER"],
    // No real provider adapter exists yet. The console outbox is a development stand-in only.
    adapterAvailable: false,
    developmentOnly: (env) => env.MAIL_DEV_OUTBOX === "console" && env.NODE_ENV !== "production",
  },
  { key: "whatsapp", kind: "messaging", milestone: 8, secrets: ["WHATSAPP_BUSINESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"], adapterAvailable: false },
  { key: "sms", kind: "messaging", milestone: 8, secrets: ["SMS_PROVIDER_KEY"], adapterAvailable: false },
  { key: "document_storage", kind: "storage", milestone: 8, secrets: ["STORAGE_BUCKET", "STORAGE_ACCESS_KEY"], adapterAvailable: false },
  { key: "ai_gateway", kind: "ai", milestone: 7, secrets: ["AI_PROVIDER_API_KEY"], adapterAvailable: false },
  { key: "developer_feeds", kind: "data_feed", milestone: 8, secrets: [], adapterAvailable: false },
  { key: "ad_channels", kind: "advertising", milestone: 11, secrets: [], adapterAvailable: false },
  { key: "maps_places", kind: "location", milestone: 9, secrets: ["MAPS_API_KEY"], adapterAvailable: false },
];

export function providerByKey(key: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.key === key);
}
