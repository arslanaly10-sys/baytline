"use server";

import { redirect } from "next/navigation";
import {
  acceptInvitation,
  ensurePersonalWorkspace,
  requestPasswordReset,
  resetPassword,
  signIn,
  signOut,
  signUpCustomer,
  signUpFromInvitation,
} from "@baytline/identity";
import type { FormState } from "@/lib/form-state";
import { getDb, getMailer } from "../db";
import { appUrl, clearSessionCookie, getSession, readSessionToken, safeNext, setSessionCookie } from "../session";
import { localeAndDict, messageFor, str } from "./helpers";

export async function signInAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  let target: string;
  try {
    const r = await signIn(getDb(), { email: str(fd, "email"), password: str(fd, "password") });
    if (!r.ok) return { status: "error", message: dict.auth.errors[r.reason] };
    await setSessionCookie(r.session.token, r.session.expiresAt);
    target = safeNext(str(fd, "next"), locale);
  } catch (e) {
    return { status: "error", message: messageFor(e, dict.auth.errors) };
  }
  redirect(target);
}

export async function signUpAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  try {
    const s = await signUpCustomer(getDb(), {
      email: str(fd, "email"),
      password: str(fd, "password"),
      displayName: str(fd, "displayName"),
      locale,
    });
    await setSessionCookie(s.token, s.expiresAt);
  } catch (e) {
    return { status: "error", message: messageFor(e, dict.auth.errors) };
  }
  redirect(`/${locale}/app`);
}

export async function forgotPasswordAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  try {
    const base = await appUrl();
    const r = await requestPasswordReset(getDb(), {
      email: str(fd, "email"),
      mailer: getMailer(),
      resetUrl: (t) => `${base}/${locale}/reset-password?token=${t}`,
    });
    return r.delivery === "email_not_configured"
      ? { status: "error", message: dict.auth.resetUnavailable }
      : { status: "success", message: dict.auth.resetSent };
  } catch (e) {
    return { status: "error", message: messageFor(e, dict.auth.errors) };
  }
}

export async function resetPasswordAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  try {
    await resetPassword(getDb(), { token: str(fd, "token"), password: str(fd, "password") });
    await clearSessionCookie();
  } catch (e) {
    return { status: "error", message: messageFor(e, dict.auth.errors) };
  }
  redirect(`/${locale}/sign-in?reset=1`);
}

/** New account for the invited address, then straight into the organization. */
export async function inviteSignUpAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  let orgId: string;
  try {
    const s = await signUpFromInvitation(getDb(), {
      token: str(fd, "token"),
      password: str(fd, "password"),
      displayName: str(fd, "displayName"),
      locale,
    });
    await setSessionCookie(s.token, s.expiresAt);
    orgId = s.orgId;
  } catch (e) {
    return { status: "error", message: messageFor(e, { ...dict.auth.errors, ...dict.invite.errors }) };
  }
  redirect(`/${locale}/o/${orgId}`);
}

export async function acceptInviteAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  let orgId: string;
  try {
    orgId = await acceptInvitation(getDb(), session.user.id, str(fd, "token"));
  } catch (e) {
    return { status: "error", message: messageFor(e, { ...dict.invite.errors, generic: dict.auth.errors.generic }) };
  }
  redirect(`/${locale}/o/${orgId}`);
}

export async function signOutAction(fd: FormData): Promise<void> {
  const { locale } = await localeAndDict(fd);
  await signOut(getDb(), await readSessionToken());
  await clearSessionCookie();
  redirect(`/${locale}/sign-in`);
}

export async function openPersonalWorkspaceAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { locale, dict } = await localeAndDict(fd);
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  let orgId: string;
  try {
    orgId = await ensurePersonalWorkspace(getDb(), session.user);
  } catch (e) {
    return { status: "error", message: messageFor(e, dict.auth.errors) };
  }
  redirect(`/${locale}/o/${orgId}`);
}
