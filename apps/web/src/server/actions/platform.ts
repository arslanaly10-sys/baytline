"use server";

import { revalidatePath } from "next/cache";
import {
  revokeUserSessions,
  runIntegrationCheck,
  setIntegrationEnabled,
  setOrganizationStatus,
  setUserStatus,
  updateMarket,
  updateOrganizationProfile,
} from "@baytline/platform";
import type { FormState } from "@/lib/form-state";
import { format } from "@/i18n/format";
import { getDb } from "../db";
import { localeAndDict, messageFor, requireActor, str } from "./helpers";

// Every action: actor from the session cookie, permission re-checked by the service in the database.

export async function updateOrgProfileAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  try {
    await updateOrganizationProfile(getDb(), actor, str(fd, "targetOrgId"), {
      name: str(fd, "name"),
      legalName: str(fd, "legalName"),
      registrationRef: str(fd, "registrationRef"),
      website: str(fd, "website"),
      market: str(fd, "market"),
    });
    revalidatePath(`/${locale}/o/${actor.orgId}`, "layout");
    return { status: "success", message: dict.orgs.profileSaved };
  } catch (e) {
    return { status: "error", message: messageFor(e, dict.orgs.errors) };
  }
}

export async function setOrgStatusAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  try {
    await setOrganizationStatus(getDb(), actor, str(fd, "targetOrgId"), str(fd, "status"));
    revalidatePath(`/${locale}/o/${actor.orgId}`, "layout");
    return { status: "success", message: dict.orgs.statusSaved };
  } catch (e) {
    return { status: "error", message: messageFor(e, dict.orgs.errors) };
  }
}

export async function setUserStatusAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  try {
    await setUserStatus(getDb(), actor, str(fd, "userId"), str(fd, "status"));
    revalidatePath(`/${locale}/o/${actor.orgId}`, "layout");
    return { status: "success", message: dict.users.saved };
  } catch (e) {
    return { status: "error", message: messageFor(e, dict.users.errors) };
  }
}

export async function revokeSessionsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  try {
    await revokeUserSessions(getDb(), actor, str(fd, "userId"));
    revalidatePath(`/${locale}/o/${actor.orgId}`, "layout");
    return { status: "success", message: dict.users.revoked };
  } catch (e) {
    return { status: "error", message: messageFor(e, dict.users.errors) };
  }
}

export async function updateMarketAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  try {
    const changed = await updateMarket(getDb(), actor, str(fd, "code"), {
      nameEn: str(fd, "nameEn"),
      nameAr: str(fd, "nameAr"),
      currency: str(fd, "currency"),
      timeZone: str(fd, "timeZone"),
      weekendDays: fd.getAll("weekendDays"),
      defaultLocale: str(fd, "defaultLocale"),
      supportedLocales: fd.getAll("supportedLocales"),
      numberingSystem: str(fd, "numberingSystem"),
      dateStyle: str(fd, "dateStyle"),
      status: str(fd, "status"),
      notes: str(fd, "notes"),
    });
    revalidatePath(`/${locale}/o/${actor.orgId}`, "layout");
    return { status: "success", message: changed.length ? dict.marketsAdmin.saved : dict.marketsAdmin.noChange };
  } catch (e) {
    return { status: "error", message: messageFor(e, dict.marketsAdmin.errors) };
  }
}

export async function runIntegrationCheckAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  try {
    const r = await runIntegrationCheck(getDb(), actor, str(fd, "key"));
    revalidatePath(`/${locale}/o/${actor.orgId}`, "layout");
    return r.ok
      ? { status: "success", message: dict.integrations.checkOk }
      : { status: "error", message: format(dict.integrations.checkFailed, { summary: r.summary }) };
  } catch (e) {
    return { status: "error", message: messageFor(e, dict.integrations.errors) };
  }
}

export async function setIntegrationEnabledAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const actor = await requireActor(locale, str(fd, "orgId"));
  try {
    await setIntegrationEnabled(getDb(), actor, str(fd, "key"), str(fd, "enabled") === "true");
    revalidatePath(`/${locale}/o/${actor.orgId}`, "layout");
    return { status: "success", message: dict.integrations.saved };
  } catch (e) {
    return { status: "error", message: messageFor(e, dict.integrations.errors) };
  }
}
