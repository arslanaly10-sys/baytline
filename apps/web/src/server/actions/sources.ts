"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { IMPORT_FIELDS, IMPORT_RECORD_TYPES, type ImportRecordType } from "@baytline/core";
import {
  applyBatch,
  cancelBatch,
  createSource,
  mapAndValidate,
  resumeSource,
  revokeSource,
  submitPartnerUpdate,
  submitSourceForApproval,
  suspendSource,
  syncSource,
  stageFeedBatch,
  updateSource,
  uploadImport,
} from "@baytline/developer";
import { decideSource } from "@baytline/platform";
import type { FormState } from "@/lib/form-state";
import { format } from "@/i18n/format";
import { getDb } from "../db";
import { failed, localeAndDict, requireActor, str } from "./helpers";

// The actor comes from the session; @baytline/developer and @baytline/platform re-check membership,
// permissions, authorization state and ownership on every call.

type D = Awaited<ReturnType<typeof localeAndDict>>["dict"];
type Actor = Awaited<ReturnType<typeof requireActor>>;

async function run(fd: FormData, fn: (actor: Actor, dict: D, locale: string) => Promise<string | FormState>): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  try {
    const out = await fn(actor, dict, locale);
    revalidatePath(`/${locale}/o/${actor.orgId}`, "layout");
    revalidatePath(`/${locale}/homes`, "layout");
    return typeof out === "string" ? { status: "success", message: out } : out;
  } catch (e) {
    return failed(e, dict.src.errors);
  }
}

const sourceInput = (fd: FormData) => ({
  name: str(fd, "name"),
  authorizationRef: str(fd, "authorizationRef"),
  allProjects: str(fd, "allProjects"),
  projectIds: fd.getAll("projectIds").map(String).filter(Boolean),
  freshnessHours: str(fd, "freshnessHours"),
  config: { url: str(fd, "feedUrl"), record_type: str(fd, "recordType") },
  secretNames: str(fd, "secretName") ? [str(fd, "secretName")] : [],
  trusted: str(fd, "trusted"),
});

export const createSourceAction = async (_p: FormState, fd: FormData) => {
  let target = "";
  const state = await run(fd, async (a, d, locale) => {
    const type = str(fd, "type");
    const id = await createSource(getDb(), a, { ...sourceInput(fd), type, partnerOrgId: str(fd, "partnerOrgId"), adapterKey: str(fd, "adapterKey") });
    target = `/${locale}/o/${a.orgId}/sources/${id}`;
    return type === "data_feed" ? d.src.add.createdFeed : d.src.add.created;
  });
  // Outside run(): redirect() must not be caught as an error.
  if (state.status === "success" && target) redirect(target);
  return state;
};

export const updateSourceAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    const changed = await updateSource(getDb(), a, str(fd, "sourceId"), sourceInput(fd));
    return changed.includes("needs_approval") ? d.src.detail.savedReapproval : d.src.detail.saved;
  });

export const submitSourceAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await submitSourceForApproval(getDb(), a, str(fd, "sourceId"));
    return d.src.detail.submitted;
  });

export const suspendSourceAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await suspendSource(getDb(), a, str(fd, "sourceId"));
    return d.src.detail.suspended;
  });

export const resumeSourceAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await resumeSource(getDb(), a, str(fd, "sourceId"));
    return str(fd, "needsApproval") === "yes" ? d.src.detail.resumedPending : d.src.detail.resumed;
  });

export const revokeSourceAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await revokeSource(getDb(), a, str(fd, "sourceId"));
    return d.src.detail.revoked;
  });

export const syncSourceAction = async (_p: FormState, fd: FormData) => {
  let target = "";
  const state = await run(fd, async (a, d, locale) => {
    const r = await syncSource(getDb(), a, str(fd, "sourceId"), (c, input) => stageFeedBatch(c, a, input));
    if (!r.ok) return { status: "error", message: format(d.src.detail.syncFailed, { reason: r.summary }) };
    target = `/${locale}/o/${a.orgId}/sources/imports/${r.batchId}`;
    return d.src.detail.synced;
  });
  // A successful fetch goes straight to the staged import for review.
  if (state.status === "success" && target) redirect(target);
  return state;
};

// ---------------------------------------------------------------- imports

export const uploadImportAction = async (_p: FormState, fd: FormData) => {
  let target = "";
  const state = await run(fd, async (a, _d, locale) => {
    const file = fd.get("file");
    const fromFile = file instanceof File && file.size > 0 ? await file.text() : "";
    const csv = fromFile || str(fd, "csv");
    const id = await uploadImport(getDb(), a, {
      sourceId: str(fd, "sourceId"), recordType: str(fd, "recordType"), csv, fileName: file instanceof File && file.size > 0 ? file.name : "",
      asOf: localDateTime(str(fd, "asOf"), str(fd, "tzOffset")), effectiveFrom: str(fd, "effectiveFrom"), note: str(fd, "note"),
    });
    target = `/${locale}/o/${a.orgId}/sources/imports/${id}`;
    return "";
  });
  if (state.status === "success" && target) redirect(target);
  return state;
};

/** <input type="datetime-local"> has no zone: the browser sends its offset in minutes alongside. */
function localDateTime(v: string, offsetMinutes: string): string {
  if (!v) return "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return v;
  const off = Number(offsetMinutes);
  const utc = Date.parse(`${v}:00Z`) + (Number.isFinite(off) ? off : 0) * 60_000;
  return Number.isNaN(utc) ? v : new Date(utc).toISOString();
}

export const mapImportAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    const recordType = str(fd, "recordType") as ImportRecordType;
    if (!(IMPORT_RECORD_TYPES as readonly string[]).includes(recordType)) return { status: "error", message: d.src.errors.generic };
    const mapping = Object.fromEntries(IMPORT_FIELDS[recordType].map((f) => [f.key, str(fd, `map_${f.key}`)]));
    await mapAndValidate(getDb(), a, str(fd, "batchId"), mapping, { effectiveFrom: str(fd, "effectiveFrom") });
    return d.src.batch.validated;
  });

export const applyImportAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    const r = await applyBatch(getDb(), a, str(fd, "batchId"), {
      previewHash: str(fd, "previewHash"), conflictPolicy: str(fd, "conflictPolicy"), confirmVerified: str(fd, "confirmVerified"),
    });
    return format(d.src.batch.applied, { applied: r.applied, skipped: r.skipped, disputed: r.disputed, reconfirmed: r.reconfirmed, drafts: r.drafts });
  });

export const cancelImportAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await cancelBatch(getDb(), a, str(fd, "batchId"));
    return d.src.batch.cancelled;
  });

// ---------------------------------------------------------------- brokerage and platform

export const submitPartnerUpdateAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await submitPartnerUpdate(getDb(), a, {
      sourceId: str(fd, "sourceId"), projectId: str(fd, "projectId"), lines: str(fd, "lines"),
      asOf: localDateTime(str(fd, "asOf"), str(fd, "tzOffset")), note: str(fd, "note"),
    });
    return d.src.partnerSide.submitted;
  });

export const decideSourceAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await decideSource(getDb(), a, str(fd, "sourceId"), str(fd, "decision"), str(fd, "note"));
    return d.src.platform.decided;
  });
