"use server";

import { revalidatePath } from "next/cache";
import { previewAi, saveOrgAiPolicy, savePlatformAi, setOrgAiBlocked, type AiPreview } from "@baytline/ai";
import type { FormState } from "@/lib/form-state";
import { getDb } from "../db";
import { failed, localeAndDict, requireActor, str } from "./helpers";

// The actor comes from the session; @baytline/ai re-checks membership and permissions on every call.

type D = Awaited<ReturnType<typeof localeAndDict>>["dict"];

async function run(fd: FormData, fn: (actor: Awaited<ReturnType<typeof requireActor>>, dict: D) => Promise<string>): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  try {
    const message = await fn(actor, dict);
    revalidatePath(`/${locale}/o/${actor.orgId}`, "layout");
    return { status: "success", message };
  } catch (e) {
    return failed(e, dict.ai.errors);
  }
}

export const saveOrgAiPolicyAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    const autonomy: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("level_")) autonomy[k.slice(6)] = String(v);
    const changed = await saveOrgAiPolicy(getDb(), a, {
      enabled: str(fd, "enabled"), allowedModels: fd.getAll("models").map(String), defaultModel: str(fd, "defaultModel"),
      monthlyBudgetUsd: str(fd, "budget"), maxOutputTokens: str(fd, "maxTokens"), storeText: str(fd, "storeText"), autonomy,
    });
    return changed.length ? d.ai.policy.saved : d.ai.policy.unchanged;
  });

export const savePlatformAiAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    const changed = await savePlatformAi(getDb(), a, {
      enabled: str(fd, "enabled"), allowedModels: fd.getAll("models").map(String), defaultModel: str(fd, "defaultModel"),
      orgBudgetCeilingUsd: str(fd, "ceiling"), platformMonthlyCapUsd: str(fd, "cap"), maxOutputTokensCeiling: str(fd, "maxTokens"), logRetentionDays: str(fd, "retention"),
    });
    return changed.length ? d.ai.platform.saved : d.ai.policy.unchanged;
  });

export const setOrgAiBlockedAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    const blocked = str(fd, "blocked") === "yes";
    await setOrgAiBlocked(getDb(), a, str(fd, "targetOrgId"), blocked, str(fd, "note"));
    return blocked ? d.ai.platform.blockedMsg : d.ai.platform.unblockedMsg;
  });

export type PreviewState = { status: "idle" } | { status: "error"; message: string } | { status: "done"; preview: AiPreview };

/** Runs the gateway's checks and shows what would be sent. Never calls the model, never logs. */
export const previewAiAction = async (_p: PreviewState, fd: FormData): Promise<PreviewState> => {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  try {
    const preview = await previewAi(getDb(), actor, { capability: str(fd, "capability"), instruction: str(fd, "instruction") });
    return { status: "done", preview };
  } catch (e) {
    const f = failed(e, dict.ai.errors);
    return { status: "error", message: f.message };
  }
};
