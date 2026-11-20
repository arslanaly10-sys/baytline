"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  addDocument,
  archiveDocument,
  createPlan,
  createPlanVersion,
  createPriceList,
  createPriceVersion,
  createProject,
  createUnit,
  decidePlanVersion,
  decidePriceVersion,
  grantShare,
  revokeShare,
  savePhase,
  savePlanDraft,
  savePriceDraft,
  submitPlanVersion,
  submitPriceVersion,
  updateDocument,
  updateProject,
  updateShare,
  updateUnit,
  verifyUnit,
  type MilestoneInput,
} from "@baytline/developer";
import type { FormState } from "@/lib/form-state";
import { getDb } from "../db";
import { localeAndDict, failed, requireActor, str } from "./helpers";

// Pattern for every action: actor from the session cookie, org ID only a claim,
// permission and org membership re-checked by @baytline/developer, RLS underneath.

type Ctx = Awaited<ReturnType<typeof begin>>;
async function begin(fd: FormData) {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  const refresh = () => revalidatePath(`/${locale}/o/${actor.orgId}`, "layout");
  return { locale, dict, actor, refresh };
}

async function run(fd: FormData, fn: (c: Ctx) => Promise<string>): Promise<FormState> {
  const c = await begin(fd);
  try {
    const message = await fn(c);
    c.refresh();
    return { status: "success", message };
  } catch (e) {
    return failed(e, c.dict.dev.errors);
  }
}

const projectInput = (fd: FormData) => ({
  name: str(fd, "name"),
  market: str(fd, "market"),
  city: str(fd, "city"),
  location: str(fd, "location"),
  propertyTypes: fd.getAll("propertyTypes"),
  description: str(fd, "description"),
  launchDate: str(fd, "launchDate"),
  handoverDate: str(fd, "handoverDate"),
  status: str(fd, "status"),
});

export async function createProjectAction(_p: FormState, fd: FormData): Promise<FormState> {
  const c = await begin(fd);
  let pid: string;
  try {
    pid = await createProject(getDb(), c.actor, projectInput(fd));
  } catch (e) {
    return failed(e, c.dict.dev.errors);
  }
  c.refresh();
  redirect(`/${c.locale}/o/${c.actor.orgId}/projects/${pid}`);
}

export const updateProjectAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (c) => ((await updateProject(getDb(), c.actor, str(fd, "projectId"), projectInput(fd))).length ? c.dict.dev.projects.saved : c.dict.dev.noChange));

export const savePhaseAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (c) => {
    await savePhase(
      getDb(),
      c.actor,
      str(fd, "projectId"),
      { kind: str(fd, "kind"), name: str(fd, "name"), expectedHandover: str(fd, "expectedHandover"), sortOrder: str(fd, "sortOrder") },
      str(fd, "phaseId") || undefined,
    );
    return c.dict.dev.phases.saved;
  });

const unitInput = (fd: FormData) => ({
  code: str(fd, "code"),
  phaseId: str(fd, "phaseId"),
  propertyType: str(fd, "propertyType"),
  bedrooms: str(fd, "bedrooms"),
  areaSqm: str(fd, "areaSqm"),
  floor: str(fd, "floor"),
  status: str(fd, "status"),
  sourceRef: str(fd, "sourceRef"),
});

export const createUnitAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (c) => {
    await createUnit(getDb(), c.actor, str(fd, "projectId"), unitInput(fd));
    return c.dict.dev.units.created;
  });

export const updateUnitAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (c) => ((await updateUnit(getDb(), c.actor, str(fd, "unitId"), unitInput(fd))).length ? c.dict.dev.units.saved : c.dict.dev.noChange));

export const verifyUnitAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (c) => {
    await verifyUnit(getDb(), c.actor, str(fd, "unitId"));
    return c.dict.dev.units.verified;
  });

// ---------------------------------------------------------------- pricing

export const createPriceListAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (c) => {
    await createPriceList(getDb(), c.actor, str(fd, "projectId"), { name: str(fd, "name"), currency: str(fd, "currency") || undefined });
    return c.dict.dev.pricing.listCreated;
  });

export async function createPriceVersionAction(_p: FormState, fd: FormData): Promise<FormState> {
  const c = await begin(fd);
  let vid: string;
  try {
    vid = await createPriceVersion(getDb(), c.actor, str(fd, "listId"), { effectiveFrom: str(fd, "effectiveFrom"), effectiveTo: str(fd, "effectiveTo") });
  } catch (e) {
    return failed(e, c.dict.dev.errors);
  }
  c.refresh();
  redirect(`/${c.locale}/o/${c.actor.orgId}/projects/${str(fd, "projectId")}/pricing/prices/${vid}`);
}

export const savePriceDraftAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (c) => {
    const prices: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("price:") && typeof v === "string") prices[k.slice(6)] = v;
    await savePriceDraft(getDb(), c.actor, str(fd, "versionId"), { effectiveFrom: str(fd, "effectiveFrom"), effectiveTo: str(fd, "effectiveTo"), notes: str(fd, "notes"), prices });
    return c.dict.dev.pricing.editor.saved;
  });

export const submitPriceAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (c) => {
    await submitPriceVersion(getDb(), c.actor, str(fd, "versionId"));
    return c.dict.dev.pricing.editor.submitted;
  });

export const decidePriceAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (c) => {
    const decision = str(fd, "decision");
    await decidePriceVersion(getDb(), c.actor, str(fd, "versionId"), decision, str(fd, "note"));
    return decision === "approve" ? c.dict.dev.pricing.editor.approved : c.dict.dev.pricing.editor.rejected;
  });

export const createPlanAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (c) => {
    await createPlan(getDb(), c.actor, str(fd, "projectId"), { name: str(fd, "name") });
    return c.dict.dev.pricing.planCreated;
  });

export async function createPlanVersionAction(_p: FormState, fd: FormData): Promise<FormState> {
  const c = await begin(fd);
  let vid: string;
  try {
    vid = await createPlanVersion(getDb(), c.actor, str(fd, "planId"), { effectiveFrom: str(fd, "effectiveFrom") });
  } catch (e) {
    return failed(e, c.dict.dev.errors);
  }
  c.refresh();
  redirect(`/${c.locale}/o/${c.actor.orgId}/projects/${str(fd, "projectId")}/pricing/plans/${vid}`);
}

export const savePlanDraftAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (c) => {
    const rows = Number(str(fd, "rows")) || 0;
    const milestones: MilestoneInput[] = [];
    for (let i = 0; i < Math.min(rows, 60); i++) {
      const g = (k: string) => str(fd, `m.${i}.${k}`);
      if (!g("label").trim() && !g("percent").trim() && !g("amount").trim()) continue; // empty rows are ignored
      milestones.push({ label: g("label"), trigger: g("trigger"), dueDate: g("dueDate"), progressPercent: g("progress"), monthsAfterHandover: g("months"), percent: g("percent"), amount: g("amount") });
    }
    await savePlanDraft(getDb(), c.actor, str(fd, "versionId"), {
      currency: str(fd, "currency"),
      effectiveFrom: str(fd, "effectiveFrom"),
      effectiveTo: str(fd, "effectiveTo"),
      handoverTerms: str(fd, "handoverTerms"),
      notes: str(fd, "notes"),
      milestones,
    });
    return c.dict.dev.pricing.editor.saved;
  });

export const submitPlanAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (c) => {
    await submitPlanVersion(getDb(), c.actor, str(fd, "versionId"));
    return c.dict.dev.pricing.editor.submitted;
  });

export const decidePlanAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (c) => {
    const decision = str(fd, "decision");
    await decidePlanVersion(getDb(), c.actor, str(fd, "versionId"), decision, str(fd, "note"));
    return decision === "approve" ? c.dict.dev.pricing.editor.approved : c.dict.dev.pricing.editor.rejected;
  });

// ---------------------------------------------------------------- documents and partners

const docInput = (fd: FormData) => ({
  title: str(fd, "title"),
  docType: str(fd, "docType"),
  referenceKind: str(fd, "referenceKind"),
  reference: str(fd, "reference"),
  visibility: str(fd, "visibility"),
});

export const addDocumentAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (c) => {
    await addDocument(getDb(), c.actor, str(fd, "projectId"), docInput(fd));
    return c.dict.dev.documents.added;
  });

export const updateDocumentAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (c) => {
    await updateDocument(getDb(), c.actor, str(fd, "documentId"), docInput(fd));
    return c.dict.dev.documents.saved;
  });

export const archiveDocumentAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (c) => {
    await archiveDocument(getDb(), c.actor, str(fd, "documentId"));
    return c.dict.dev.documents.archived;
  });

export const grantShareAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (c) => {
    await grantShare(getDb(), c.actor, {
      projectId: str(fd, "projectId"),
      brokerageId: str(fd, "brokerageId"),
      includePricing: fd.get("includePricing") === "on",
      includeDocuments: fd.get("includeDocuments") === "on",
      includeLocation: fd.get("includeLocation") === "on",
    });
    return c.dict.dev.partners.granted;
  });

export const updateShareAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (c) => {
    await updateShare(getDb(), c.actor, str(fd, "shareId"), {
      includePricing: fd.get("includePricing") === "on",
      includeDocuments: fd.get("includeDocuments") === "on",
      includeLocation: fd.get("includeLocation") === "on",
    });
    return c.dict.dev.partners.updated;
  });

export const revokeShareAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (c) => {
    await revokeShare(getDb(), c.actor, str(fd, "shareId"));
    return c.dict.dev.partners.revoked;
  });
