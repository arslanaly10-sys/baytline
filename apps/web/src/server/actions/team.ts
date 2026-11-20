"use server";

import { revalidatePath } from "next/cache";
import { createOrganization, inviteMember, revokeInvitation, updateMembership } from "@baytline/identity";
import type { FormState } from "@/lib/form-state";
import { format } from "@/i18n/format";
import { getDb, getMailer } from "../db";
import { appUrl } from "../session";
import { localeAndDict, failed, requireActor, str } from "./helpers";

/** Emails the link when a mailer exists; the link is always shown to the inviter exactly once. */
async function deliverInvitation(email: string, link: string, orgName: string): Promise<boolean> {
  const mailer = getMailer();
  const orgLabel = orgName.trim() || "an organization";
  if (!mailer.configured) return false;
  await mailer.send({
    to: email,
    subject: `You're invited to ${orgLabel}`,
    text: `You've been invited to join ${orgLabel}. Open this link within 7 days to accept:\n${link}`,
  });
  return true;
}

export async function inviteAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  const targetOrgId = str(fd, "targetOrgId") || actor.orgId;
  try {
    const r = await inviteMember(getDb(), actor, { orgId: targetOrgId, email: str(fd, "email"), role: str(fd, "role") });
    const link = `${await appUrl()}/${locale}/invite/${r.token}`;
    const emailed = await deliverInvitation(r.email, link, str(fd, "orgName"));
    revalidatePath(`/${locale}/o/${actor.orgId}`, "layout");
    return {
      status: "success",
      message: format(dict.team.inviteCreated, { email: r.email }),
      link,
      note: emailed ? dict.team.inviteEmailed : dict.team.inviteNotEmailed,
    };
  } catch (e) {
    return failed(e, dict.team.errors);
  }
}

export async function revokeInvitationAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  try {
    await revokeInvitation(getDb(), actor, str(fd, "invitationId"));
    revalidatePath(`/${locale}/o/${actor.orgId}`, "layout");
    return { status: "success", message: dict.team.saved };
  } catch (e) {
    return failed(e, dict.team.errors);
  }
}

export async function changeRoleAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  try {
    await updateMembership(getDb(), actor, str(fd, "membershipId"), { role: str(fd, "role") });
    revalidatePath(`/${locale}/o/${actor.orgId}`, "layout");
    return { status: "success", message: dict.team.saved };
  } catch (e) {
    return failed(e, dict.team.errors);
  }
}

export async function setMemberStatusAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  const status = str(fd, "status");
  if (status !== "active" && status !== "suspended" && status !== "removed") {
    return { status: "error", message: dict.team.errors.generic };
  }
  try {
    await updateMembership(getDb(), actor, str(fd, "membershipId"), { status });
    revalidatePath(`/${locale}/o/${actor.orgId}`, "layout");
    return { status: "success", message: dict.team.saved };
  } catch (e) {
    return failed(e, dict.team.errors);
  }
}

export async function createOrganizationAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  const name = str(fd, "name");
  try {
    const r = await createOrganization(getDb(), actor, {
      type: str(fd, "type"),
      name,
      market: str(fd, "market"),
      adminEmail: str(fd, "adminEmail"),
    });
    const link = `${await appUrl()}/${locale}/invite/${r.token}`;
    const emailed = await deliverInvitation(r.adminEmail, link, name.trim());
    revalidatePath(`/${locale}/o/${actor.orgId}`, "layout");
    return {
      status: "success",
      message: format(dict.orgs.created, { name: name.trim() }),
      link,
      note: emailed ? dict.team.inviteEmailed : dict.team.inviteNotEmailed,
    };
  } catch (e) {
    return failed(e, { ...dict.orgs.errors, email: dict.orgs.errors.email });
  }
}
