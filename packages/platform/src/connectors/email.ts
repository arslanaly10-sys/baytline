import nodemailer, { type Transporter } from "nodemailer";
import type { Mailer, OutgoingMail } from "@baytline/identity";

/**
 * Email connector: any SMTP service, configured by two server secrets:
 *   MAIL_SMTP_URL  smtps://user:password@host:465  (or smtp://... with STARTTLS on 587)
 *   MAIL_FROM      the From address, e.g. "Baytline <no-reply@example.com>"
 * Values stay on the server. The connection check logs in to the server and sends nothing.
 */
export const EMAIL_SECRETS = ["MAIL_SMTP_URL", "MAIL_FROM"] as const;

export type EmailFailure = "not_configured" | "bad_url" | "auth" | "connection" | "tls" | "timeout" | "unknown";
export class EmailError extends Error {
  constructor(public code: EmailFailure) { super(code); }
}

/** Fixed codes only: SMTP replies can echo user names and host details. */
function mapError(e: unknown): EmailFailure {
  const err = e as { code?: string; responseCode?: number };
  if (err?.code === "EAUTH" || err?.responseCode === 535) return "auth";
  if (err?.code === "ETIMEDOUT" || err?.code === "ETIMEOUT") return "timeout";
  if (err?.code === "ESOCKET" && /tls|certificate|ssl/i.test(String((e as Error).message))) return "tls";
  if (err?.code === "ECONNECTION" || err?.code === "ESOCKET" || err?.code === "EDNS" || err?.code === "ECONNREFUSED") return "connection";
  return "unknown";
}

export function smtpUrl(raw: string | undefined, env: NodeJS.ProcessEnv = process.env): URL {
  if (!raw) throw new EmailError("not_configured");
  let u: URL;
  try { u = new URL(raw); } catch { throw new EmailError("bad_url"); }
  // Credentials never cross the network in the clear: smtps, or smtp that must upgrade with STARTTLS.
  if (u.protocol !== "smtps:" && u.protocol !== "smtp:") throw new EmailError("bad_url");
  if (u.protocol === "smtp:" && env.NODE_ENV === "production" && u.port !== "587") throw new EmailError("bad_url");
  return u;
}

export function createSmtpTransport(env: NodeJS.ProcessEnv = process.env): Transporter {
  const u = smtpUrl(env.MAIL_SMTP_URL, env);
  return nodemailer.createTransport({
    host: u.hostname,
    port: Number(u.port || (u.protocol === "smtps:" ? 465 : 587)),
    secure: u.protocol === "smtps:",
    requireTLS: u.protocol === "smtp:",
    auth: u.username ? { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

export async function checkEmail(env: NodeJS.ProcessEnv = process.env, transport?: Transporter): Promise<{ ok: boolean; summary: string }> {
  try {
    if (!env.MAIL_FROM) throw new EmailError("not_configured");
    const t = transport ?? createSmtpTransport(env);
    await t.verify(); // connects, upgrades to TLS, authenticates; sends no message
    return { ok: true, summary: "Signed in to the mail server. No message was sent." };
  } catch (e) {
    const code = e instanceof EmailError ? e.code : mapError(e);
    const words: Record<EmailFailure, string> = {
      not_configured: "MAIL_SMTP_URL or MAIL_FROM is not set.", bad_url: "MAIL_SMTP_URL isn't a valid smtps:// or smtp:// (port 587) address.",
      auth: "The mail server rejected the user name or password.", connection: "Couldn't connect to the mail server.", tls: "The secure connection to the mail server failed.",
      timeout: "The mail server didn't answer in time.", unknown: "The mail server check failed.",
    };
    return { ok: false, summary: words[code] };
  }
}

/** Real delivery through SMTP. Errors carry fixed codes, never server replies. */
export function smtpMailer(env: NodeJS.ProcessEnv = process.env, transport?: Transporter): Mailer {
  const from = env.MAIL_FROM;
  const t = transport ?? createSmtpTransport(env);
  return {
    configured: true,
    kind: "smtp",
    async send(m: OutgoingMail) {
      try {
        await t.sendMail({ from, to: m.to, subject: m.subject, text: m.text });
      } catch (e) {
        throw new EmailError(mapError(e));
      }
    },
  };
}
