import { withAppTx, withAuthTx, type Client, type Db } from "@baytline/db";
import { writeAudit } from "./audit";
import { hashPassword, newToken, sha256, verifyAgainstDummy, verifyPassword } from "./crypto";
import { IdentityError } from "./errors";
import type { Mailer } from "./mailer";
import { acceptInvitation } from "./members";
import { checkPassword, cleanName, normalizeEmail } from "./validation";

/** Absolute lifetime: the cookie and the row expire together and are never extended. */
export const SESSION_DAYS = 30;
/** A session unused for this long stops working. */
export const SESSION_IDLE_DAYS = 7;
const RESET_MINUTES = 30;
const THROTTLE_WINDOW_MIN = 15;
const THROTTLE_MAX_FAILURES = 5;
const DAY = 86_400_000;

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  locale: string;
  isPlaceholder: boolean;
  emailVerified: boolean;
};

export type ValidSession = {
  sessionId: string;
  user: SessionUser;
  lastOrgId: string | null;
  expiresAt: Date;
  /** The user has confirmed MFA. */
  mfaEnrolled: boolean;
  /** This session passed the second factor. Platform access requires it. */
  mfaVerified: boolean;
  /** Password passed, second factor not yet: the session may only be used to finish signing in. */
  mfaPending: boolean;
};

export type NewSession = { token: string; expiresAt: Date; userId: string };

async function createSession(c: Client, userId: string): Promise<NewSession> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY);
  await c.query("insert into auth.sessions (id, user_id, expires_at) values ($1, $2, $3)", [sha256(token), userId, expiresAt]);
  return { token, expiresAt, userId };
}

async function insertUser(c: Client, u: { email: string; displayName: string; locale: string; passwordHash: string; verified: boolean; placeholder?: boolean }) {
  const exists = await c.query("select 1 from app.users where email = $1", [u.email]);
  if (exists.rowCount) throw new IdentityError("conflict", "email_taken");
  const { rows } = await c.query<{ id: string }>(
    `insert into app.users (email, display_name, locale, email_verified_at, is_placeholder)
     values ($1, $2, $3, $4, $5) returning id`,
    [u.email, u.displayName, u.locale, u.verified ? new Date() : null, u.placeholder ?? false],
  );
  const id = rows[0]!.id;
  await c.query("insert into auth.credentials (user_id, password_hash) values ($1, $2)", [id, u.passwordHash]);
  return id;
}

/**
 * Self-service registration is for customer accounts (buyers, investors, renters,
 * tenants). Business users join organizations by invitation only.
 */
export async function signUpCustomer(
  db: Db,
  input: { email: unknown; password: unknown; displayName: unknown; locale: string },
): Promise<NewSession> {
  const email = normalizeEmail(input.email);
  const password = checkPassword(input.password, email);
  const displayName = cleanName(input.displayName);
  const passwordHash = await hashPassword(password);

  const session = await withAuthTx(db, async (c) => {
    const userId = await insertUser(c, { email, displayName, locale: input.locale, passwordHash, verified: false });
    await writeAudit(c, { type: "auth.sign_up", outcome: "success", actorUserId: userId, target: { type: "user", id: userId }, metadata: { via: "self_service" } });
    return createSession(c, userId);
  });
  await withAppTx(db, { userId: session.userId }, (c) => c.query("select app.ensure_personal_org($1)", [displayName]));
  return session;
}

export type InvitationPreview = {
  orgName: string;
  orgType: string;
  role: string;
  email: string;
  state: "pending" | "accepted" | "revoked" | "expired" | "unavailable";
  expiresAt: Date;
};

export async function previewInvitation(db: Db, token: string): Promise<InvitationPreview | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  return withAppTx(db, { userId: null }, async (c) => {
    const { rows } = await c.query("select * from app.invitation_preview($1)", [sha256(token)]);
    const r = rows[0];
    return r ? { orgName: r.org_name, orgType: r.org_type, role: r.role, email: r.email, state: r.state, expiresAt: r.expires_at } : null;
  });
}

/** Creates an account for the invited email and accepts the invitation in one step. */
export async function signUpFromInvitation(
  db: Db,
  input: { token: string; password: unknown; displayName: unknown; locale: string },
): Promise<NewSession & { orgId: string }> {
  const preview = await previewInvitation(db, input.token);
  if (!preview || preview.state !== "pending") throw new IdentityError("invalid_input", "invitation_invalid");
  const password = checkPassword(input.password, preview.email);
  const displayName = cleanName(input.displayName);
  const passwordHash = await hashPassword(password);

  const session = await withAuthTx(db, async (c) => {
    // Verified: only the holder of the invitation link reaches this point.
    const userId = await insertUser(c, { email: preview.email, displayName, locale: input.locale, passwordHash, verified: true });
    await writeAudit(c, { type: "auth.sign_up", outcome: "success", actorUserId: userId, target: { type: "user", id: userId }, metadata: { via: "invitation" } });
    return createSession(c, userId);
  });
  const orgId = await acceptInvitation(db, session.userId, input.token);
  return { ...session, orgId };
}

export type SignInResult = { ok: true; session: NewSession; mfaRequired: boolean } | { ok: false; reason: "invalid" | "throttled" };

/**
 * Same response for unknown email, wrong password and disabled account.
 * Five failures in 15 minutes for one email pause further attempts for that email.
 */
export async function signIn(db: Db, input: { email: unknown; password: unknown }): Promise<SignInResult> {
  let email: string;
  try {
    email = normalizeEmail(input.email);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const password = typeof input.password === "string" ? input.password.slice(0, 256) : "";
  const emailHash = sha256(email);

  return withAuthTx(db, async (c) => {
    await c.query("delete from auth.sign_in_attempts where at < now() - interval '1 day'");
    const { rows: fails } = await c.query<{ n: string }>(
      `select count(*) as n from auth.sign_in_attempts
        where email_hash = $1 and not succeeded and at > now() - make_interval(mins => $2)`,
      [emailHash, THROTTLE_WINDOW_MIN],
    );
    const { rows } = await c.query(
      `select u.id, u.status, cr.password_hash from app.users u
         left join auth.credentials cr on cr.user_id = u.id where u.email = $1`,
      [email],
    );
    const user = rows[0];

    if (Number(fails[0]!.n) >= THROTTLE_MAX_FAILURES) {
      await writeAudit(c, { type: "auth.sign_in.throttled", outcome: "denied", actorUserId: null, target: user ? { type: "user", id: user.id } : undefined });
      return { ok: false, reason: "throttled" } as const;
    }

    let valid = false;
    if (user?.password_hash) valid = await verifyPassword(password, user.password_hash);
    else await verifyAgainstDummy(password);
    const allowed = valid && user.status === "active";

    await c.query("insert into auth.sign_in_attempts (email_hash, succeeded) values ($1, $2)", [emailHash, allowed]);
    if (!allowed) {
      await writeAudit(c, {
        type: "auth.sign_in.failed",
        outcome: "failure",
        actorUserId: null,
        target: user ? { type: "user", id: user.id } : undefined,
        metadata: { reason: !user ? "unknown_account" : !valid ? "wrong_password" : "account_disabled" },
      });
      return { ok: false, reason: "invalid" } as const;
    }
    const session = await createSession(c, user.id);
    // With MFA on, this session can only finish signing in until the second factor passes.
    const { rowCount } = await c.query("select 1 from auth.mfa_factors where user_id = $1 and confirmed_at is not null", [user.id]);
    const mfaRequired = Boolean(rowCount);
    await writeAudit(c, { type: "auth.sign_in.succeeded", outcome: "success", actorUserId: user.id, target: { type: "user", id: user.id }, metadata: { mfa: mfaRequired ? "pending" : "not_enrolled" } });
    return { ok: true, session, mfaRequired } as const;
  });
}

export async function validateSession(db: Db, token: string | undefined): Promise<ValidSession | null> {
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  return withAuthTx(db, async (c) => {
    const { rows } = await c.query(
      `select s.id, s.expires_at, s.last_org_id, s.mfa_verified_at, u.id as user_id, u.email, u.display_name, u.locale,
              u.is_placeholder, u.email_verified_at, (f.confirmed_at is not null) as mfa_enrolled
         from auth.sessions s join app.users u on u.id = s.user_id
         left join auth.mfa_factors f on f.user_id = u.id
        where s.id = $1 and s.expires_at > now() and u.status = 'active'
          and s.last_seen_at > now() - make_interval(days => $2)`,
      [id, SESSION_IDLE_DAYS],
    );
    const r = rows[0];
    if (!r) return null;
    await c.query("update auth.sessions set last_seen_at = now() where id = $1", [id]);
    return {
      sessionId: id,
      lastOrgId: r.last_org_id,
      expiresAt: r.expires_at,
      mfaEnrolled: r.mfa_enrolled,
      mfaVerified: r.mfa_enrolled && r.mfa_verified_at !== null,
      mfaPending: r.mfa_enrolled && r.mfa_verified_at === null,
      user: {
        id: r.user_id,
        email: r.email,
        displayName: r.display_name,
        locale: r.locale,
        isPlaceholder: r.is_placeholder,
        emailVerified: r.email_verified_at !== null,
      },
    };
  });
}

/** Ends every session for the user, e.g. "sign out everywhere". */
export async function signOutEverywhere(db: Db, userId: string): Promise<void> {
  await withAuthTx(db, async (c) => {
    await c.query("delete from auth.sessions where user_id = $1", [userId]);
    await writeAudit(c, { type: "auth.sign_out", outcome: "success", actorUserId: userId, metadata: { scope: "all_sessions" } });
  });
}

export async function signOut(db: Db, token: string | undefined): Promise<void> {
  if (!token || token.length > 100) return;
  await withAuthTx(db, async (c) => {
    const { rows } = await c.query<{ user_id: string }>("delete from auth.sessions where id = $1 returning user_id", [sha256(token)]);
    if (rows[0]) await writeAudit(c, { type: "auth.sign_out", outcome: "success", actorUserId: rows[0].user_id });
  });
}

/** Organization switching is audited once per change, however the switch happened. */
export async function recordOrgSwitch(db: Db, s: Pick<ValidSession, "sessionId" | "lastOrgId" | "user">, orgId: string): Promise<void> {
  if (s.lastOrgId === orgId) return;
  await withAuthTx(db, async (c) => {
    await c.query("update auth.sessions set last_org_id = $2 where id = $1", [s.sessionId, orgId]);
    await writeAudit(c, {
      type: "org.switched",
      outcome: "success",
      actorUserId: s.user.id,
      orgId,
      target: { type: "organization", id: orgId },
      metadata: { from: s.lastOrgId },
    });
  });
}

export type ResetRequestResult = { delivery: "sent_if_account_exists" | "email_not_configured" };

/**
 * Always answers the same way whether or not the account exists. If email isn't
 * configured, says so plainly and creates no token.
 */
export async function requestPasswordReset(
  db: Db,
  input: { email: unknown; mailer: Mailer; resetUrl: (token: string) => string },
): Promise<ResetRequestResult> {
  if (!input.mailer.configured) return { delivery: "email_not_configured" };
  let email: string;
  try {
    email = normalizeEmail(input.email);
  } catch {
    return { delivery: "sent_if_account_exists" };
  }
  const token = newToken();
  const target = await withAuthTx(db, async (c) => {
    const { rows } = await c.query<{ id: string }>("select id from app.users where email = $1 and status = 'active'", [email]);
    const user = rows[0];
    if (!user) return null;
    await c.query("update auth.password_reset_tokens set used_at = now() where user_id = $1 and used_at is null", [user.id]);
    await c.query("insert into auth.password_reset_tokens (id, user_id, expires_at) values ($1, $2, now() + make_interval(mins => $3))", [
      sha256(token),
      user.id,
      RESET_MINUTES,
    ]);
    await writeAudit(c, { type: "auth.password_reset.requested", outcome: "success", actorUserId: null, target: { type: "user", id: user.id } });
    return user;
  });
  if (target) {
    await input.mailer.send({
      to: email,
      subject: "Reset your password",
      text: `Use this link within ${RESET_MINUTES} minutes to choose a new password:\n${input.resetUrl(token)}\n\nIf you didn't ask for this, you can ignore this email.`,
    });
  }
  return { delivery: "sent_if_account_exists" };
}

/** Single use. Signs out every existing session for the account. */
export async function resetPassword(db: Db, input: { token: string; password: unknown }): Promise<void> {
  if (typeof input.token !== "string" || input.token.length > 100) throw new IdentityError("invalid_input", "token_invalid");
  const id = sha256(input.token);
  await withAuthTx(db, async (c) => {
    const { rows } = await c.query(
      `select t.user_id, u.email from auth.password_reset_tokens t join app.users u on u.id = t.user_id
        where t.id = $1 and t.used_at is null and t.expires_at > now() and u.status = 'active' for update of t`,
      [id],
    );
    const r = rows[0];
    if (!r) throw new IdentityError("invalid_input", "token_invalid");
    const password = checkPassword(input.password, r.email);
    await c.query("update auth.credentials set password_hash = $2, updated_at = now() where user_id = $1", [r.user_id, await hashPassword(password)]);
    await c.query("update auth.password_reset_tokens set used_at = now() where user_id = $1 and used_at is null", [r.user_id]);
    await c.query("delete from auth.sessions where user_id = $1", [r.user_id]);
    // The link was delivered to this address, which proves ownership.
    await c.query("update app.users set email_verified_at = coalesce(email_verified_at, now()) where id = $1", [r.user_id]);
    await writeAudit(c, { type: "auth.password_reset.completed", outcome: "success", actorUserId: r.user_id, target: { type: "user", id: r.user_id } });
  });
}

export async function isPasswordResetTokenUsable(db: Db, token: string): Promise<boolean> {
  if (typeof token !== "string" || token.length > 100) return false;
  return withAuthTx(db, async (c) => {
    const { rowCount } = await c.query("select 1 from auth.password_reset_tokens where id = $1 and used_at is null and expires_at > now()", [sha256(token)]);
    return (rowCount ?? 0) > 0;
  });
}

/** Lets a signed-in user with no organizations open their personal workspace. */
export async function ensurePersonalWorkspace(db: Db, user: Pick<SessionUser, "id" | "displayName">): Promise<string> {
  return withAppTx(db, { userId: user.id }, async (c) => {
    const { rows } = await c.query<{ id: string }>("select app.ensure_personal_org($1) as id", [user.displayName]);
    return rows[0]!.id;
  });
}
