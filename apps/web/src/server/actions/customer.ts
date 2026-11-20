"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ensurePersonalWorkspace, type Actor } from "@baytline/identity";
import { cancelAppointment, submitAppointment, submitEnquiry, submitSupportRequest } from "@baytline/marketplace";
import type { FormState } from "@/lib/form-state";
import type { UiLocale } from "@baytline/core";
import { getDb } from "../db";
import { signInPath } from "../guards";
import { getSession } from "../session";
import { failed, localeAndDict, str } from "./helpers";

/**
 * Customer actions. The customer is the signed-in user acting in their personal workspace
 * (created on first use). Routing, account email, consent time and source are recorded by
 * the database, never taken from the form.
 */
async function customerActor(locale: UiLocale, back: string): Promise<{ actor: Actor; personal: string }> {
  const session = await getSession();
  if (!session) redirect(signInPath(locale, back));
  const orgId = await ensurePersonalWorkspace(getDb(), session.user);
  return { actor: { userId: session.user.id, orgId }, personal: `/${locale}/o/${orgId}` };
}

const contactFrom = (fd: FormData) => ({
  name: str(fd, "name"),
  phone: str(fd, "phone"),
  preferredContact: str(fd, "preferredContact"),
  consent: str(fd, "consent") === "yes",
});

/** "unit:<id>" from the About menu, or the page's own listing. */
function listingFrom(fd: FormData) {
  const about = str(fd, "about");
  const [kind, id] = about.includes(":") ? about.split(":") : [str(fd, "listingKind"), str(fd, "listingId")];
  return { listingKind: kind, listingId: id };
}

export async function enquiryAction(_p: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const { actor, personal } = await customerActor(locale, str(fd, "back") || `/${locale}/homes`);
  try {
    await submitEnquiry(getDb(), actor, { ...listingFrom(fd), ...contactFrom(fd), message: str(fd, "message"), source: str(fd, "source"), locale });
    revalidatePath(`${personal}/enquiries`);
    return { status: "success", message: dict.cx.ask.sent, link: `${personal}/enquiries` };
  } catch (e) {
    return failed(e, dict.cx.errors);
  }
}

export async function appointmentAction(_p: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const { actor, personal } = await customerActor(locale, str(fd, "back") || `/${locale}/homes`);
  try {
    await submitAppointment(getDb(), actor, {
      ...listingFrom(fd),
      ...contactFrom(fd),
      kind: str(fd, "kind"),
      note: str(fd, "note"),
      slots: [1, 2, 3].map((n) => ({ date: str(fd, `slot${n}Date`), period: str(fd, `slot${n}Period`) })),
      locale,
    });
    revalidatePath(`${personal}/appointments`);
    return { status: "success", message: dict.cx.book.sent, link: `${personal}/appointments` };
  } catch (e) {
    return failed(e, dict.cx.errors);
  }
}

export async function cancelAppointmentAction(_p: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const { actor, personal } = await customerActor(locale, `/${locale}/app`);
  try {
    await cancelAppointment(getDb(), actor, str(fd, "appointmentId"));
    revalidatePath(`${personal}/appointments`);
    return { status: "success", message: dict.cx.my.appointments.cancelled };
  } catch (e) {
    return failed(e, dict.cx.errors);
  }
}

export async function supportAction(_p: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const { actor, personal } = await customerActor(locale, `/${locale}/app`);
  try {
    await submitSupportRequest(getDb(), actor, { topic: str(fd, "topic"), subject: str(fd, "subject"), message: str(fd, "message"), relatedEnquiryId: str(fd, "relatedEnquiryId"), locale });
    revalidatePath(`${personal}/support`);
    return { status: "success", message: dict.cx.my.support.sent };
  } catch (e) {
    return failed(e, dict.cx.errors);
  }
}
