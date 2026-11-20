import { runMigrations } from "../src/migrate";

const url = process.env.DATABASE_OWNER_URL;
if (!url) {
  console.error("Set DATABASE_OWNER_URL to run migrations.");
  process.exit(1);
}
const applied = await runMigrations(url, console.log);
console.log(applied.length ? `Done: ${applied.length} migration(s).` : "Up to date.");
