/**
 * LOCAL DEVELOPMENT ONLY. Creates roles + database and runs migrations.
 *   pnpm db:setup              create or migrate
 *   pnpm db:setup -- --reset   drop the local database first (destroys local data)
 */
import { provisionLocal } from "../src/provision";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing ${k}. Copy .env.example to apps/web/.env.local and fill it in.`);
    process.exit(1);
  }
  return v;
};
const owner = need("DATABASE_OWNER_URL");
await provisionLocal({
  adminUrl: need("DATABASE_ADMIN_URL"),
  urls: { owner, auth: need("DATABASE_AUTH_URL"), app: need("DATABASE_APP_URL") },
  dbName: new URL(owner).pathname.slice(1),
  reset: process.argv.includes("--reset"),
  log: console.log,
});
console.log("Database ready.");
