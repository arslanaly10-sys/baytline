import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { DEFAULT_MARKET, isMarketCode, isUiLocale, type MarketCode, type UiLocale } from "@baytline/core";
import { SESSION_DAYS, validateSession, type ValidSession } from "@baytline/identity";
import { dbConfigured, getDb } from "./db";

const PROD = process.env.NODE_ENV === "production";
/** __Host- prefix in production: Secure, path=/, no Domain — can't be set by subdomains. */
export const SESSION_COOKIE = PROD ? "__Host-bl_session" : "bl_session";
export const MARKET_COOKIE = "market";

/** The signed-in session for this request, or null. Validated against the database every request. */
export const getSession = cache(async (): Promise<ValidSession | null> => {
  if (!dbConfigured()) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return validateSession(getDb(), token);
});

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** Only callable from server actions and route handlers. */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: PROD,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export const SESSION_MAX_AGE_DAYS = SESSION_DAYS;

export async function getMarket(fallback: MarketCode = DEFAULT_MARKET): Promise<MarketCode> {
  const v = (await cookies()).get(MARKET_COOKIE)?.value;
  return v && isMarketCode(v) ? v : fallback;
}

/**
 * Only same-site paths under a supported locale are accepted as return targets,
 * so ?next= can't be used to redirect people to another site.
 */
export function safeNext(next: unknown, locale: UiLocale): string {
  // Default destination after signing in: the workspace picker, not the marketing site.
  if (typeof next !== "string") return `/${locale}/app`;
  const [, first] = next.split("/");
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || !first || !isUiLocale(first)) return `/${locale}/app`;
  return next;
}

/** Base URL for links in emails and invitations. */
export async function appUrl(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (PROD) throw new Error("APP_URL must be set in production");
  const h = await headers();
  return `http://${h.get("host") ?? "localhost:3000"}`;
}
