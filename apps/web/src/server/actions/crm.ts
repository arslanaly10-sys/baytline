"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addLeadNote, assignLead, captureAllNew, createDeal, createLead, decideClaim, decideRegistration, overrideScore, scheduleViewing, setLeadStatus, submitClaim,
  submitRegistration, updateDeal, updateRequirements, updateViewing, withdrawClaim, withdrawRegistration,
} from "@baytline/leads";
import type { FormState } from "@/lib/form-state";
import { format } from "@/i18n/format";
import { getDb } from "../db";
import { failed, localeAndDict, requireActor, str } from "./helpers";

// The actor comes from the session; @baytline/leads re-checks membership, permissions, scope and ownership.

type D = Awaited<ReturnType<typeof localeAndDict>>["dict"];
async function run(fd: FormData, fn: (actor: Awaited<ReturnType<typeof requireActor>>, d: D, locale: string) => Promise<string>): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  try {
    const message = await fn(actor, dict, locale);
    revalidatePath(`/${locale}/o/${actor.orgId}`, "layout");
    return { status: "success", message };
  } catch (e) {
    const state = failed(e, dict.crm.errors);
    return state.field ? { ...state, field: FIELD[state.field] ?? state.field } : state;
  }
}

// Service error details → the form input that should be highlighted.
const FIELD: Record<string, string> = {
  agreed_price: "agreedPrice", override_reason: "reason", lost_reason: "lostReason", scheduled_for: "when", budget_min: "budgetMin",
  budget_max: "budgetMax", bedrooms_min: "bedroomsMin", property_types: "propertyTypes", protection_days: "days", decision_note_required: "note",
  rate_percent: "rate", amount_rate_mismatch: "amount", unit: "unitId", project: "projectId", registration: "registrationId", assignee_not_member: "assignee",
};

export const captureAllAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    const n = await captureAllNew(getDb(), a);
    return n ? format(d.crm.leads.captured, { n }) : d.crm.leads.capturedNone;
  });

export const createLeadAction = async (_p: FormState, fd: FormData) => {
  let target = "";
  const state = await run(fd, async (a, d, locale) => {
    const id = await createLead(getDb(), a, { name: str(fd, "name"), email: str(fd, "email"), phone: str(fd, "phone"), interest: str(fd, "interest"), consent: str(fd, "consent") });
    target = `/${locale}/o/${a.orgId}/leads/${id}`;
    return d.crm.leads.add.created;
  });
  if (state.status === "success" && target) redirect(target);
  return state;
};

export const requirementsAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    const changed = await updateRequirements(getDb(), a, str(fd, "leadId"), {
      budgetMin: str(fd, "budgetMin"), budgetMax: str(fd, "budgetMax"), currency: str(fd, "currency"), propertyTypes: fd.getAll("propertyTypes").map(String),
      bedroomsMin: str(fd, "bedroomsMin"), city: str(fd, "city"), timeline: str(fd, "timeline"), financing: str(fd, "financing"), note: str(fd, "note"),
    });
    return changed.length ? d.crm.lead.saved : d.crm.lead.unchanged;
  });

export const leadStatusAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await setLeadStatus(getDb(), a, str(fd, "leadId"), str(fd, "status"), str(fd, "lostReason"));
    return d.crm.lead.saved;
  });

export const assignLeadAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await assignLead(getDb(), a, str(fd, "leadId"), str(fd, "assignee"));
    return d.crm.lead.saved;
  });

export const overrideScoreAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await overrideScore(getDb(), a, str(fd, "leadId"), str(fd, "clear") === "yes" ? "" : str(fd, "band"), str(fd, "reason"));
    return d.crm.lead.saved;
  });

export const leadNoteAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await addLeadNote(getDb(), a, str(fd, "leadId"), str(fd, "note"));
    return d.crm.lead.saved;
  });

export const scheduleViewingAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await scheduleViewing(getDb(), a, str(fd, "leadId"), { projectId: str(fd, "projectId"), unitId: str(fd, "unitId"), localDateTime: str(fd, "when") });
    return d.crm.viewings.scheduled;
  });

export const updateViewingAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await updateViewing(getDb(), a, str(fd, "viewingId"), { status: str(fd, "status"), outcome: str(fd, "outcome") });
    return d.crm.viewings.updated;
  });

export const registerClientAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await submitRegistration(getDb(), a, str(fd, "leadId"), str(fd, "projectId"), str(fd, "note"));
    return d.crm.registrations.submitted;
  });

export const withdrawRegistrationAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await withdrawRegistration(getDb(), a, str(fd, "registrationId"));
    return d.crm.registrations.withdrawn;
  });

export const decideRegistrationAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await decideRegistration(getDb(), a, str(fd, "registrationId"), str(fd, "decision"), str(fd, "days"), str(fd, "note"));
    return d.crm.registrations.decided;
  });

export const createDealAction = async (_p: FormState, fd: FormData) => {
  let target = "";
  const state = await run(fd, async (a, d, locale) => {
    await createDeal(getDb(), a, str(fd, "leadId"), { unitId: str(fd, "unitId"), registrationId: str(fd, "registrationId"), note: str(fd, "note") });
    target = `/${locale}/o/${a.orgId}/deals`;
    return d.crm.deals.created;
  });
  if (state.status === "success" && target) redirect(target);
  return state;
};

export const updateDealAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await updateDeal(getDb(), a, str(fd, "dealId"), { stage: str(fd, "stage"), agreedPrice: str(fd, "agreedPrice"), lostReason: str(fd, "lostReason"), note: str(fd, "note") });
    return d.crm.deals.updated;
  });

export const submitClaimAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await submitClaim(getDb(), a, str(fd, "dealId"), { basis: str(fd, "basis"), ratePercent: str(fd, "rate"), amount: str(fd, "amount"), note: str(fd, "note") });
    return d.crm.claims.submitted;
  });

export const withdrawClaimAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await withdrawClaim(getDb(), a, str(fd, "claimId"));
    return d.crm.claims.withdrawn;
  });

export const decideClaimAction = async (_p: FormState, fd: FormData) =>
  run(fd, async (a, d) => {
    await decideClaim(getDb(), a, str(fd, "claimId"), str(fd, "decision"), str(fd, "note"));
    return d.crm.claims.decided;
  });
