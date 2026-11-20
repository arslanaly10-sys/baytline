import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Integration tests run against a real local PostgreSQL in a throwaway database.
const envFile = new URL("../../apps/web/.env.local", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const TEST_DB = "baytline_test_management";
const toTest = (url: string | undefined) => {
  if (!url) return "";
  const u = new URL(url);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
};

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      TEST_DB,
      DATABASE_APP_URL: toTest(process.env.DATABASE_APP_URL),
      DATABASE_AUTH_URL: toTest(process.env.DATABASE_AUTH_URL),
      DATABASE_OWNER_URL: toTest(process.env.DATABASE_OWNER_URL),
      DATABASE_OWNER_BASE_URL: process.env.DATABASE_OWNER_URL ?? "",
      DATABASE_AUTH_BASE_URL: process.env.DATABASE_AUTH_URL ?? "",
      DATABASE_APP_BASE_URL: process.env.DATABASE_APP_URL ?? "",
      DATABASE_ADMIN_URL: process.env.DATABASE_ADMIN_URL ?? "",
      BAYTLINE_SCRYPT_LOG2: "14", // faster hashing in tests only
    },
  },
});
