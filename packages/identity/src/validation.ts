import { IdentityError } from "./errors";

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export function normalizeEmail(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new IdentityError("invalid_input", "email");
  return v;
}

/** Length-based policy (NIST SP 800-63B): no composition rules, long passphrases welcome. */
export function checkPassword(raw: unknown, email?: string): string {
  const v = typeof raw === "string" ? raw : "";
  const len = [...v].length;
  if (len < PASSWORD_MIN || len > PASSWORD_MAX) throw new IdentityError("invalid_input", "password_length");
  if (email && v.trim().toLowerCase() === email) throw new IdentityError("invalid_input", "password_is_email");
  return v;
}

export function cleanName(raw: unknown, max = 120): string {
  const v = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (v.length < 1 || v.length > max) throw new IdentityError("invalid_input", "name");
  return v;
}
