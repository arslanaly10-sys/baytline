import { provisionLocal } from "@baytline/db";

// Runs in the main vitest process: process.env holds the base URLs loaded by vitest.config.ts.
export default async function setup() {
  const need = (k: string) => {
    const v = process.env[k];
    if (!v) throw new Error(`Integration tests need ${k} (see .env.example).`);
    return v;
  };
  await provisionLocal({
    adminUrl: need("DATABASE_ADMIN_URL"),
    urls: { owner: need("DATABASE_OWNER_URL"), auth: need("DATABASE_AUTH_URL"), app: need("DATABASE_APP_URL") },
    dbName: "baytline_test_management",
    reset: true,
  });
}
