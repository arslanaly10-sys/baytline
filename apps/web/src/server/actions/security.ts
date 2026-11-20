"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { confirmMfaEnrollment, disableMfa, resetUserMfa, startMfaEnrollment, verifyMfa } from "@baytline/identity";
import { decideMarketRule, proposeMarketRule, withdrawMarketRule } from "@baytline/platform";
import type { FormState } from "@/lib/form-state";
import { getDb } from "../db";
import { getAnySession, getSession, readSessionToken, safeNext } from "../session";
import { signInPath } from "../guards";
import { failed, localeAndDict, requireActor, str } from "./helpers";

// ---------------------------------------------------------------- sign-in second step

export async function verifyMfaAction(_p: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const token = await readSessionToken();
  const s = await getAnySession();
  if (!token || !s) redirect(signInPath(locale, safeNext(str(fd, "next"), locale)));
  const r = await verifyMfa(getDb(), token, str(fd, "code"));
  if (!r.ok) return { status: "error", message: r.reason === "throttled" ? dict.sec.errors.mfa_throttled : dict.sec.errors.code, field: "code" };
  const next = safeNext(str(fd, "next"), locale);
  if (r.method === "recovery") redirect(`/${locale}/app/security?recovered=${r.recoveryCodesLeft}`);
  redirect(next);
}

// ---------------------------------------------------------------- your own MFA

export type EnrollState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "started"; secret: string; qrSvg: string }
  | { status: "done"; codes: string[] };

export async function startMfaAction(_p: EnrollState, fd: FormData): Promise<EnrollState> {
  const { locale, dict } = await localeAndDict(fd);
  const s = await getSession();
  if (!s) redirect(signInPath(locale, `/${locale}/app/security`));
  try {
    const r = await startMfaEnrollment(getDb(), { id: s.user.id, email: s.user.email });
    // Rendered on the server: the secret never goes to a third-party QR service.
    const qrSvg = await QRCode.toString(r.otpauthUri, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0b0f14", light: "#ffffff" } });
    return { status: "started", secret: r.secret, qrSvg };
  } catch (e) {
    return { status: "error", message: failed(e, dict.sec.errors).message };
  }
}

export async function confirmMfaAction(_p: EnrollState, fd: FormData): Promise<EnrollState> {
  const { locale, dict } = await localeAndDict(fd);
  const s = await getSession();
  if (!s) redirect(signInPath(locale, `/${locale}/app/security`));
  try {
    // No revalidation here: re-rendering the page would replace this form before the one-time recovery
    // codes are shown. The status refreshes on the next page load.
    const codes = await confirmMfaEnrollment(getDb(), s.user.id, s.sessionId, str(fd, "code"));
    return { status: "done", codes };
  } catch (e) {
    return { status: "error", message: failed(e, dict.sec.errors).message };
  }
}

export async function disableMfaAction(_p: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const s = await getSession();
  if (!s) redirect(signInPath(locale, `/${locale}/app/security`));
  try {
    await disableMfa(getDb(), s.user.id, str(fd, "code"));
    revalidatePath(`/${locale}/app`, "layout");
    return { status: "success", message: dict.sec.mfa.disabled };
  } catch (e) {
    return failed(e, dict.sec.errors);
  }
}

// ---------------------------------------------------------------- platform

async function run(fd: FormData, fn: (actor: Awaited<ReturnType<typeof requireActor>>, dict: Awaited<ReturnType<typeof localeAndDict>>["dict"]) => Promise<string>): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  try {
    const message = await fn(actor, dict);
    revalidatePath(`/${locale}/o/${actor.orgId}`, "layout");
    return { status: "success", message };
  } catch (e) {
    return failed(e, dict.sec.errors);
  }
}

export const resetUserMfaAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await resetUserMfa(getDb(), a, str(fd, "userId"));
    return d.sec.reset.done;
  });

export const proposeRuleAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await proposeMarketRule(getDb(), a, str(fd, "market"), str(fd, "category"), {
      summary: str(fd, "summary"), summaryAr: str(fd, "summaryAr"), ratePercent: str(fd, "ratePercent"), fixedAmount: str(fd, "fixedAmount"),
      payer: str(fd, "payer"), sourceReference: str(fd, "sourceReference"), effectiveFrom: str(fd, "effectiveFrom"),
    });
    return d.sec.rules.proposed;
  });

export const decideRuleAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    const decision = str(fd, "decision");
    await decideMarketRule(getDb(), a, str(fd, "changeId"), decision, str(fd, "note"));
    return decision === "approve" ? d.sec.rules.approved : d.sec.rules.rejected;
  });

export const withdrawRuleAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await withdrawMarketRule(getDb(), a, str(fd, "changeId"));
    return d.sec.rules.withdrawn;
  });

