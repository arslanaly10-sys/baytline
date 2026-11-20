/**
 * Email delivery seam. No provider is integrated yet, and nothing pretends one is:
 *  - MAIL_PROVIDER set to anything: startup error (not implemented yet).
 *  - MAIL_DEV_OUTBOX=console outside production: messages are printed to the
 *    server log, clearly marked as not delivered. Local development only.
 *  - otherwise: not configured, and callers must tell the user.
 */
export type OutgoingMail = { to: string; subject: string; text: string };

export interface Mailer {
  readonly configured: boolean;
  readonly kind: "none" | "dev-console";
  send(mail: OutgoingMail): Promise<void>;
}

const none: Mailer = {
  configured: false,
  kind: "none",
  async send() {
    throw new Error("Email delivery is not configured");
  },
};

const devConsole: Mailer = {
  configured: true,
  kind: "dev-console",
  async send(m) {
    console.info(["", "[dev mail outbox: NOT DELIVERED]", `To: ${m.to}`, `Subject: ${m.subject}`, "", m.text, ""].join("\n"));
  },
};

export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  if (env.MAIL_PROVIDER) throw new Error(`MAIL_PROVIDER=${env.MAIL_PROVIDER} is not supported yet. Unset it.`);
  if (env.MAIL_DEV_OUTBOX === "console" && env.NODE_ENV !== "production") return devConsole;
  return none;
}
