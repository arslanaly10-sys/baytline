import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_UI_LOCALE, isUiLocale, UI_LOCALES } from "@baytline/core";

/** Ensures every page URL starts with a supported UI locale. */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const first = pathname.split("/")[1] ?? "";
  if (isUiLocale(first)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = `/${preferredLocale(req)}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

function preferredLocale(req: NextRequest): string {
  const saved = req.cookies.get("locale")?.value;
  if (saved && isUiLocale(saved)) return saved;
  const header = req.headers.get("accept-language") ?? "";
  for (const part of header.split(",")) {
    const tag = part.split(";")[0]?.trim().slice(0, 2).toLowerCase() ?? "";
    if ((UI_LOCALES as string[]).includes(tag)) return tag;
  }
  return DEFAULT_UI_LOCALE;
}

export const config = {
  matcher: ["/((?!_next|api|favicon.ico|.*\\..*).*)"],
};
