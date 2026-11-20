import { IdentityError } from "./errors";
import { isUuid } from "@baytline/db";

export function req(v: unknown, max: number, field: string): string {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (s.length < 1 || s.length > max) throw new IdentityError("invalid_input", field);
  return s;
}

export function opt(v: unknown, max: number, field: string, keepNewlines = false): string | null {
  const s = typeof v === "string" ? (keepNewlines ? v.trim() : v.trim().replace(/\s+/g, " ")) : "";
  if (!s) return null;
  if (s.length > max) throw new IdentityError("invalid_input", field);
  return s;
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  const s = String(v ?? "");
  if (!(allowed as readonly string[]).includes(s)) throw new IdentityError("invalid_input", field);
  return s as T;
}

export function optDate(v: unknown, field: string): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !new Date(`${s}T00:00:00Z`).toISOString().startsWith(s)) throw new IdentityError("invalid_input", field);
  return s;
}

export function reqDate(v: unknown, field: string): string {
  const d = optDate(v, field);
  if (!d) throw new IdentityError("invalid_input", field);
  return d;
}

export function optInt(v: unknown, min: number, max: number, field: string): number | null {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < min || n > max) throw new IdentityError("invalid_input", field);
  return n;
}

export function optDecimal(v: unknown, field: string, { max, places }: { max: number; places: number }): string | null {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  if (!s) return null;
  if (!new RegExp(`^\\d+(\\.\\d{1,${places}})?$`).test(s) || Number(s) <= 0 || Number(s) > max) throw new IdentityError("invalid_input", field);
  return s;
}

export function id(v: unknown): string {
  if (!isUuid(v)) throw new IdentityError("not_found");
  return v;
}

const CURRENCIES = new Set(Intl.supportedValuesOf("currency"));
export function currency(v: unknown): string {
  const s = String(v ?? "").trim().toUpperCase();
  if (!CURRENCIES.has(s)) throw new IdentityError("invalid_input", "currency");
  return s;
}

export function currencyDigits(code: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
}

/**
 * "1234567.5" (major units, as typed) -> 1234567500n minor units for a 3-digit currency.
 * Exact string arithmetic: no floating point anywhere near money.
 */
export function parseMoney(v: unknown, code: string, field = "price"): bigint | null {
  const s = typeof v === "string" ? v.trim().replace(/[,\s]/g, "") : "";
  if (!s) return null;
  const digits = currencyDigits(code);
  const m = s.match(/^(\d{1,15})(?:\.(\d+))?$/);
  if (!m || (m[2] && m[2].length > digits)) throw new IdentityError("invalid_input", field);
  const minor = BigInt(m[1]!) * 10n ** BigInt(digits) + BigInt((m[2] ?? "").padEnd(digits, "0") || "0");
  if (minor <= 0n) throw new IdentityError("invalid_input", field);
  return minor;
}

/** Inverse of parseMoney, for pre-filling inputs. */
export function minorToInput(minor: bigint | string | number, code: string): string {
  const digits = currencyDigits(code);
  const s = BigInt(minor).toString().padStart(digits + 1, "0");
  return digits ? `${s.slice(0, -digits)}.${s.slice(-digits)}` : s;
}
