"use server";

import { revalidatePath } from "next/cache";
import {
  answerSupportRequest, confirmAppointment, confirmRental, declineAppointment, publishProject, publishRental, setEnquiryStatus, withdrawProject, withdrawRental,
} from "@baytline/marketplace";
import type { FormState } from "@/lib/form-state";
import { getDb } from "../db";
import { failed, localeAndDict, requireActor, str } from "./helpers";

// Organization side: actor from the session, org ID only a claim; @baytline/marketplace re-checks
// membership and permission, row-level security underneath.

async function run(fd: FormData, fn: (a: { actor: Awaited<ReturnType<typeof requireActor>> }) => Promise<string | ((d: Awaited<ReturnType<typeof localeAndDict>>["dict"]) => string)>): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  try {
    const m = await fn({ actor });
    revalidatePath(`/${locale}/o/${actor.orgId}`, "layout");
    revalidatePath(`/${locale}/homes`, "layout");
    return { status: "success", message: typeof m === "function" ? m(dict) : m };
  } catch (e) {
    return failed(e, { ...dict.cx.org.errors, ...dict.cx.errors, generic: dict.cx.org.errors.generic });
  }
}

export async function publishProjectAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(fd, async ({ actor }) => {
    await publishProject(getDb(), actor, str(fd, "projectId"), {
      unitIds: fd.getAll("unitIds").filter((x): x is string => typeof x === "string"),
      showPrices: str(fd, "showPrices") === "yes",
      showPaymentPlans: str(fd, "showPaymentPlans") === "yes",
      routeBrokerageOrgId: str(fd, "routeBrokerageOrgId"),
    });
    return (d) => d.cx.org.publish.published;
  });
}

export async function withdrawProjectAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(fd, async ({ actor }) => {
    await withdrawProject(getDb(), actor, str(fd, "projectId"));
    return (d) => d.cx.org.publish.withdrawn;
  });
}

export async function publishRentalAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(fd, async ({ actor }) => {
    await publishRental(getDb(), actor, str(fd, "unitId"), {
      rent: str(fd, "rent"), paymentFrequency: str(fd, "paymentFrequency"), availableFrom: str(fd, "availableFrom"), areaLabel: str(fd, "areaLabel"), description: str(fd, "description"),
    });
    return (d) => d.cx.org.rental.published;
  });
}

export async function confirmRentalAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(fd, async ({ actor }) => {
    await confirmRental(getDb(), actor, str(fd, "unitId"));
    return (d) => d.cx.org.rental.confirmed;
  });
}

export async function withdrawRentalAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(fd, async ({ actor }) => {
    await withdrawRental(getDb(), actor, str(fd, "unitId"));
    return (d) => d.cx.org.rental.withdrawn;
  });
}

export async function setEnquiryStatusAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(fd, async ({ actor }) => {
    await setEnquiryStatus(getDb(), actor, str(fd, "enquiryId"), str(fd, "status"));
    return (d) => d.cx.org.inbox.saved;
  });
}

export async function confirmAppointmentAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(fd, async ({ actor }) => {
    await confirmAppointment(getDb(), actor, str(fd, "appointmentId"), { localDateTime: str(fd, "confirmedFor"), note: str(fd, "orgNote") });
    return (d) => d.cx.org.inbox.confirmed;
  });
}

export async function declineAppointmentAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(fd, async ({ actor }) => {
    await declineAppointment(getDb(), actor, str(fd, "appointmentId"), { note: str(fd, "orgNote") });
    return (d) => d.cx.org.inbox.declined;
  });
}

export async function answerSupportAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(fd, async ({ actor }) => {
    await answerSupportRequest(getDb(), actor, str(fd, "requestId"), { response: str(fd, "response"), close: str(fd, "close") === "yes" });
    return (d) => d.cx.org.support.sent;
  });
}
