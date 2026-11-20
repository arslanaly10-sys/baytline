"use server";

import { cookies } from "next/headers";
import { isMarketCode, isUiLocale } from "@baytline/core";
import { MARKET_COOKIE } from "./session";

// Display preferences only. Nothing here affects access.
const prefCookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

export async function setMarket(code: string) {
  if (!isMarketCode(code)) return;
  (await cookies()).set(MARKET_COOKIE, code, prefCookie);
}

export async function rememberLocale(locale: string) {
  if (!isUiLocale(locale)) return;
  (await cookies()).set("locale", locale, prefCookie);
}
