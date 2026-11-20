/**
 * Creates a one-time invitation for a platform administrator.
 *   pnpm db:bootstrap-admin -- --email ops@yourcompany.example [--market AE]
 * Prints the invitation link. Treat it like a password: it lets the holder create the account.
 */
import { createBootstrapInvitation } from "../src/bootstrap";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const ownerUrl = process.env.DATABASE_OWNER_URL;
const email = arg("email");
if (!ownerUrl || !email) {
  console.error("Usage: pnpm db:bootstrap-admin -- --email <address> [--market AE]\nRequires DATABASE_OWNER_URL.");
  process.exit(1);
}
const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const { token } = await createBootstrapInvitation(ownerUrl, { email, market: arg("market") });
console.log(`\nPlatform administrator invitation for ${email} (valid 7 days, single use):\n\n  ${appUrl}/en/invite/${token}\n`);
