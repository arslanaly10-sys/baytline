"use server";

import { submitDemoRequest } from "@baytline/platform";
import type { FormState } from "@/lib/form-state";
import { getDb } from "../db";
import { localeAndDict, str } from "./helpers";

/** Public demo request. The hidden "website" field is a honeypot: bots fill it, people never see it. */
export async function demoRequestAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const t = dict.site.demo;
  if (str(fd, "website")) return { status: "success", message: t.sent };
  try {
    const r = await submitDemoRequest(getDb(), {
      name: str(fd, "name"),
      email: str(fd, "email"),
      phone: str(fd, "phone"),
      company: str(fd, "company"),
      market: str(fd, "market"),
      orgType: str(fd, "orgType"),
      locale,
      consent: str(fd, "consent") === "yes",
    });
    if (r.ok) return { status: "success", message: t.sent };
    return { status: "error", message: r.reason === "throttled" ? t.errors.throttled : t.errors[r.field] };
  } catch (e) {
    console.error("[demo] request failed:", e instanceof Error ? e.message : "unknown");
    return { status: "error", message: t.errors.generic };
  }
}
