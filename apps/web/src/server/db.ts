import "server-only";
import { createDb, missingDbConfig, type Db } from "@baytline/db";
import { mailerFromEnv, type Mailer } from "@baytline/identity";
import { smtpMailer } from "@baytline/platform";

// One pool set per server process (kept across dev hot reloads).
const g = globalThis as { __baytlineDb?: Db; __baytlineMailer?: Mailer };

export function dbConfigured(): boolean {
  return missingDbConfig().length === 0;
}

export function getDb(): Db {
  g.__baytlineDb ??= createDb();
  return g.__baytlineDb;
}

export function getMailer(): Mailer {
  // Real delivery through the SMTP connector when it's configured; otherwise the development outbox or nothing.
  g.__baytlineMailer ??= process.env.MAIL_SMTP_URL && process.env.MAIL_FROM ? smtpMailer() : mailerFromEnv();
  return g.__baytlineMailer;
}
