import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { withAppTx, withAuthTx, type Client, type Db } from "@baytline/db";
import { hasCapability } from "@baytline/core";
import { writeAudit } from "./audit";
import { requireContext, type Actor } from "./context";
import { sha256 } from "./crypto";
import { IdentityError } from "./errors";

/**
 * Multi-factor authentication with an authenticator app (TOTP, RFC 6238: SHA-1, 6 digits, 30 seconds),
 * plus ten one-time recovery codes. Required for platform staff; available to everyone.
 *
 * - Secrets are encrypted at rest with AES-256-GCM under BAYTLINE_MFA_KEY (32 bytes, base64). In
 *   development a fixed local key is used when none is set; production refuses to enrol without one.
 * - A code's time step is accepted once (replay protection), with one step of clock drift either way.
 * - Five wrong codes in 15 minutes pause verification for that account.
 */
const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1;
const FAIL_WINDOW_MIN = 15;
const FAIL_MAX = 5;
const RECOVERY_CODES = 10;
const ISSUER = "Baytline";

// ---------------------------------------------------------------- key

export function mfaKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env.BAYTLINE_MFA_KEY;
  if (raw) {
    const k = Buffer.from(raw, "base64");
    if (k.length !== 32) throw new Error("BAYTLINE_MFA_KEY must be 32 bytes, base64-encoded");
    return k;
  }
  if (env.NODE_ENV === "production") return null;
  // Development only: a fixed, documented key, so local MFA works without setup. Never used in production.
  return createHash("sha256").update("baytline-local-development-mfa-key").digest();
}

export function mfaAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return mfaKey(env) !== null;
  } catch {
    return false;
  }
}

function seal(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

function open(sealed: string, key: Buffer): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("bad sealed value");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
}

// ---------------------------------------------------------------- TOTP

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totp(secretBase32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const bin = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/** The matching time step, or null. Steps at or before lastUsed are refused (each code works once). */
export function matchTotp(secretBase32: string, code: string, lastUsed: number | null, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const s = currentStep(now);
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const step = s + d;
    if (lastUsed !== null && step <= lastUsed) continue;
    const expected = Buffer.from(totp(secretBase32, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

const normalizeRecovery = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
function newRecoveryCode(): string {
  const raw = base32Encode(randomBytes(7)).toLowerCase().slice(0, 10);
  return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
}

// ---------------------------------------------------------------- status

export type MfaStatus = { available: boolean; enrolled: boolean; pendingSetup: boolean; recoveryCodesLeft: number };

export async function getMfaStatus(db: Db, userId: string, env: NodeJS.ProcessEnv = process.env): Promise<MfaStatus> {
  return withAuthTx(db, async (c) => {
    const { rows } = await c.query("select confirmed_at from auth.mfa_factors where user_id = $1", [userId]);
    const { rows: codes } = await c.query<{ n: number }>("select count(*)::int as n from auth.mfa_recovery_codes where user_id = $1 and used_at is null", [userId]);
    return { available: mfaAvailable(env), enrolled: Boolean(rows[0]?.confirmed_at), pendingSetup: Boolean(rows[0] && !rows[0].confirmed_at), recoveryCodesLeft: codes[0]!.n };
  });
}

// ---------------------------------------------------------------- enrolment

export type EnrollmentStart = { secret: string; otpauthUri: string };

/** Starts (or restarts) setup. Refused when MFA is already on: turn it off or ask for a reset first. */
export async function startMfaEnrollment(db: Db, user: { id: string; email: string }, env: NodeJS.ProcessEnv = process.env): Promise<EnrollmentStart> {
  const key = mfaKey(env);
  if (!key) throw new IdentityError("invalid_input", "mfa_unavailable");
  const secret = base32Encode(randomBytes(20));
  await withAuthTx(db, async (c) => {
    const { rows } = await c.query("select confirmed_at from auth.mfa_factors where user_id = $1 for update", [user.id]);
    if (rows[0]?.confirmed_at) throw new IdentityError("conflict", "mfa_already_enrolled");
    await c.query(
      `insert into auth.mfa_factors (user_id, secret_encrypted) values ($1, $2)
       on conflict (user_id) do update set secret_encrypted = excluded.secret_encrypted, confirmed_at = null, last_used_step = null, created_at = now()`,
      [user.id, seal(secret, key)],
    );
  });
  const label = encodeURIComponent(`${ISSUER}:${user.email}`);
  return { secret, otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${ISSUER}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}` };
}

/** Confirms setup with a first code. Returns the recovery codes: shown once, stored only as hashes. */
export async function confirmMfaEnrollment(db: Db, userId: string, sessionId: string, code: unknown, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const key = mfaKey(env);
  if (!key) throw new IdentityError("invalid_input", "mfa_unavailable");
  const c6 = String(code ?? "").replace(/\s/g, "");
  // A wrong code is recorded and committed before the error is returned, so throttling counts it.
  const codes = await withAuthTx(db, async (c) => {
    const { rows } = await c.query("select secret_encrypted, confirmed_at, last_used_step from auth.mfa_factors where user_id = $1 for update", [userId]);
    const f = rows[0];
    if (!f) throw new IdentityError("invalid_input", "mfa_not_started");
    if (f.confirmed_at) throw new IdentityError("conflict", "mfa_already_enrolled");
    await throttle(c, userId);
    const step = matchTotp(open(f.secret_encrypted, key), c6, f.last_used_step === null ? null : Number(f.last_used_step));
    await c.query("insert into auth.mfa_attempts (user_id, succeeded) values ($1, $2)", [userId, step !== null]);
    if (step === null) {
      await writeAudit(c, { type: "auth.mfa.failed", outcome: "failure", actorUserId: userId, target: { type: "user", id: userId }, metadata: { stage: "enrolment" } });
      return null;
    }
    await c.query("update auth.mfa_factors set confirmed_at = now(), last_used_step = $2 where user_id = $1", [userId, step]);
    const fresh = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
    await c.query("delete from auth.mfa_recovery_codes where user_id = $1", [userId]);
    for (const rc of fresh) await c.query("insert into auth.mfa_recovery_codes (user_id, code_hash) values ($1, $2)", [userId, sha256(normalizeRecovery(rc))]);
    // This session has just shown the second factor.
    await c.query("update auth.sessions set mfa_verified_at = now() where id = $1 and user_id = $2", [sessionId, userId]);
    await writeAudit(c, { type: "auth.mfa.enrolled", outcome: "success", actorUserId: userId, target: { type: "user", id: userId } });
    return fresh;
  });
  if (!codes) throw new IdentityError("invalid_input", "code");
  return codes;
}

async function throttle(c: Client, userId: string): Promise<void> {
  const { rows } = await c.query<{ n: number }>(
    "select count(*)::int as n from auth.mfa_attempts where user_id = $1 and not succeeded and at > now() - make_interval(mins => $2)",
    [userId, FAIL_WINDOW_MIN],
  );
  if (rows[0]!.n >= FAIL_MAX) {
    await writeAudit(c, { type: "auth.mfa.throttled", outcome: "denied", actorUserId: userId, target: { type: "user", id: userId } });
    throw new IdentityError("rate_limited", "mfa_throttled");
  }
}

// ---------------------------------------------------------------- sign-in step

export type MfaVerifyResult = { ok: true; method: "totp" | "recovery"; recoveryCodesLeft: number } | { ok: false; reason: "invalid" | "throttled" };

/**
 * Second step of sign-in for a session that passed the password. Accepts a 6-digit code or a recovery
 * code (each recovery code works once). Marks this session as verified.
 */
export async function verifyMfa(db: Db, sessionToken: string, code: unknown, env: NodeJS.ProcessEnv = process.env): Promise<MfaVerifyResult> {
  const key = mfaKey(env);
  const input = String(code ?? "").trim();
  return withAuthTx(db, async (c) => {
    const { rows } = await c.query(
      `select s.id, s.user_id, f.secret_encrypted, f.last_used_step from auth.sessions s join auth.mfa_factors f on f.user_id = s.user_id
        where s.id = $1 and s.expires_at > now() and f.confirmed_at is not null for update of f`,
      [sha256(sessionToken)],
    );
    const r = rows[0];
    if (!r || !key) return { ok: false, reason: "invalid" } as const;
    try {
      await throttle(c, r.user_id);
    } catch {
      return { ok: false, reason: "throttled" } as const;
    }
    const digits = input.replace(/\s/g, "");
    let method: "totp" | "recovery" | null = null;
    const step = /^\d{6}$/.test(digits) ? matchTotp(open(r.secret_encrypted, key), digits, r.last_used_step === null ? null : Number(r.last_used_step)) : null;
    if (step !== null) {
      await c.query("update auth.mfa_factors set last_used_step = $2 where user_id = $1", [r.user_id, step]);
      method = "totp";
    } else if (normalizeRecovery(input).length === 10) {
      const used = await c.query("update auth.mfa_recovery_codes set used_at = now() where user_id = $1 and code_hash = $2 and used_at is null", [r.user_id, sha256(normalizeRecovery(input))]);
      if (used.rowCount) method = "recovery";
    }
    await c.query("insert into auth.mfa_attempts (user_id, succeeded) values ($1, $2)", [r.user_id, method !== null]);
    if (!method) {
      await writeAudit(c, { type: "auth.mfa.failed", outcome: "failure", actorUserId: r.user_id, target: { type: "user", id: r.user_id }, metadata: { stage: "sign_in" } });
      return { ok: false, reason: "invalid" } as const;
    }
    await c.query("update auth.sessions set mfa_verified_at = now() where id = $1", [r.id]);
    await writeAudit(c, { type: method === "recovery" ? "auth.mfa.recovery_used" : "auth.mfa.verified", outcome: "success", actorUserId: r.user_id, target: { type: "user", id: r.user_id } });
    const { rows: left } = await c.query<{ n: number }>("select count(*)::int as n from auth.mfa_recovery_codes where user_id = $1 and used_at is null", [r.user_id]);
    return { ok: true, method, recoveryCodesLeft: left[0]!.n } as const;
  });
}

// ---------------------------------------------------------------- turning off and resetting

/** A user turns off their own MFA with a current code. Platform staff can't: they must keep it. */
export async function disableMfa(db: Db, userId: string, code: unknown, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const key = mfaKey(env);
  if (!key) throw new IdentityError("invalid_input", "mfa_unavailable");
  const isStaff = await withAppTx(db, { userId }, async (c) =>
    (await c.query("select 1 from app.memberships m join app.organizations o on o.id = m.org_id where m.user_id = $1 and m.status = 'active' and o.type = 'platform'", [userId])).rowCount! > 0,
  );
  if (isStaff) throw new IdentityError("forbidden", "mfa_required_for_platform");
  const ok = await withAuthTx(db, async (c) => {
    const { rows } = await c.query("select secret_encrypted, last_used_step from auth.mfa_factors where user_id = $1 and confirmed_at is not null for update", [userId]);
    if (!rows[0]) throw new IdentityError("invalid_input", "mfa_not_enrolled");
    await throttle(c, userId);
    const step = matchTotp(open(rows[0].secret_encrypted, key), String(code ?? "").replace(/\s/g, ""), rows[0].last_used_step === null ? null : Number(rows[0].last_used_step));
    await c.query("insert into auth.mfa_attempts (user_id, succeeded) values ($1, $2)", [userId, step !== null]);
    if (step === null) return false; // recorded and committed, so throttling counts it
    await c.query("delete from auth.mfa_recovery_codes where user_id = $1", [userId]);
    await c.query("delete from auth.mfa_factors where user_id = $1", [userId]);
    await writeAudit(c, { type: "auth.mfa.disabled", outcome: "success", actorUserId: userId, target: { type: "user", id: userId } });
    return true;
  });
  if (!ok) throw new IdentityError("invalid_input", "code");
}

/**
 * A platform administrator (with MFA) clears another person's MFA, e.g. a lost phone. Their sessions
 * end, and platform staff must set MFA up again before using the platform. Never one's own.
 */
export async function resetUserMfa(db: Db, actor: Actor, targetUserId: string): Promise<void> {
  await withAppTx(db, actor, async (c) => {
    const ctx = await requireContext(c, actor);
    if (ctx.org.type !== "platform" || !hasCapability(ctx.principal, "platform.users.manage")) throw new IdentityError("forbidden", "platform.users.manage");
  });
  if (targetUserId === actor.userId) throw new IdentityError("invalid_input", "own_mfa");
  await withAuthTx(db, async (c) => {
    const { rowCount } = await c.query("delete from auth.mfa_factors where user_id = $1", [targetUserId]);
    if (!rowCount) throw new IdentityError("invalid_input", "mfa_not_enrolled");
    await c.query("delete from auth.mfa_recovery_codes where user_id = $1", [targetUserId]);
    await c.query("delete from auth.sessions where user_id = $1", [targetUserId]);
    await writeAudit(c, { type: "auth.mfa.reset", outcome: "success", actorUserId: actor.userId, orgId: actor.orgId, target: { type: "user", id: targetUserId } });
  });
}
