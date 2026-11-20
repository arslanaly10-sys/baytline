import "server-only";
import { redirect } from "next/navigation";
import { DEFAULT_UI_LOCALE, isUiLocale, type UiLocale } from "@baytline/core";
import { IdentityError, type Actor } from "@baytline/identity";
import { getDictionary, type Dictionary } from "@/i18n";
import { signInPath } from "../guards";
import { getSession } from "../session";

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

export async function localeAndDict(fd: FormData): Promise<{ locale: UiLocale; dict: Dictionary }> {
  const raw = str(fd, "locale");
  const locale = isUiLocale(raw) ? raw : DEFAULT_UI_LOCALE;
  return { locale, dict: await getDictionary(locale) };
}

/**
 * The acting user comes from the session cookie, never from the form.
 * The org ID from the form is only a claim: services verify membership in the database.
 */
export async function requireActor(locale: UiLocale, orgId: string): Promise<Actor> {
  const session = await getSession();
  if (!session) redirect(signInPath(locale, `/${locale}/o/${orgId}`));
  return { userId: session.user.id, orgId };
}

type ErrorMessages = Record<string, string> & { generic: string };

/** Maps service errors to a translated message. Unexpected errors are logged without user data. */
export function messageFor(e: unknown, messages: ErrorMessages): string {
  if (e instanceof IdentityError) {
    if (e.code === "last_admin") return messages.last_admin ?? messages.generic;
    if (e.code === "not_found") return messages.not_found ?? messages.generic;
    if (e.detail && messages[e.detail]) return messages[e.detail]!;
    if (e.code === "forbidden") return messages.no_permission ?? messages.generic;
    return messages.generic;
  }
  // Next uses thrown errors for redirect()/notFound(); let those through.
  if (e && typeof e === "object" && "digest" in e) throw e;
  console.error("[action] unexpected error:", e instanceof Error ? e.message : "unknown");
  return messages.generic;
}
