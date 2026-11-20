import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { IMPORT_MAX_BYTES, IMPORT_RECORD_TYPES, type ImportRecordType, type SourceType } from "@baytline/core";
import { IdentityError } from "@baytline/identity";
import { parseCsv } from "../location";

/**
 * Provider adapters. Each knows how to reach one kind of outside system and return rows in Baytline's
 * import format; everything after that (mapping, validation, preview, confirmation, history) is the
 * shared import pipeline. Project and unit screens never talk to an adapter.
 *
 * Adding an integration = adding an adapter here. Nothing is listed that doesn't exist in code.
 */
export type FeedPayload = { headers: string[]; rows: string[][]; asOf: Date; asOfBasis: "data_header" | "last_modified" | "fetch_time"; recordType: ImportRecordType };

export type AdapterDeps = {
  fetch: typeof fetch;
  lookup: (host: string) => Promise<{ address: string; family: number }[]>;
  now: () => Date;
};

export type ConfigField = { key: string; kind: "https_url" | "record_type"; required: boolean };

export type SourceAdapter = {
  key: string;
  sourceType: Extract<SourceType, "data_feed" | "direct_integration">;
  configFields: readonly ConfigField[];
  /** Secret slots (names are chosen per source; values come from the server environment). */
  secretSlots: readonly { key: string; optional: boolean }[];
  validateConfig(input: Record<string, unknown>): Record<string, string>;
  fetch(config: Record<string, string>, secrets: (string | undefined)[], deps: AdapterDeps): Promise<FeedPayload>;
};

export const defaultDeps: AdapterDeps = {
  fetch: (...a) => fetch(...a),
  lookup: (host) => dnsLookup(host, { all: true, verbatim: true }),
  now: () => new Date(),
};

// ---------------------------------------------------------------- outbound safety

const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".lan", ".home", ".corp"];

function privateAddress(a: string): boolean {
  if (isIP(a) === 4) {
    const [x, y] = a.split(".").map(Number) as [number, number];
    return x === 10 || x === 127 || x === 0 || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168)
      || (x === 100 && y >= 64 && y <= 127) || x >= 224;
  }
  const s = a.toLowerCase();
  if (s.startsWith("::ffff:")) return privateAddress(s.slice(7));
  return s === "::1" || s === "::" || s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe8") || s.startsWith("fe9") || s.startsWith("fea") || s.startsWith("feb") || s.startsWith("ff");
}

/** A feed URL must be public HTTPS on a named host. Checked when saved and again before every request. */
export function checkFeedUrl(raw: unknown): URL {
  let u: URL;
  try {
    u = new URL(String(raw ?? "").trim());
  } catch {
    throw new IdentityError("invalid_input", "feed_url");
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password || u.port && u.port !== "443" || !host.includes(".")
      || isIP(host.replace(/^\[|\]$/g, "")) || host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new IdentityError("invalid_input", "feed_url");
  }
  if (u.href.length > 500) throw new IdentityError("invalid_input", "feed_url");
  return u;
}

async function readLimited(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new FeedError("too_large"); }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

/** Failure reasons are fixed codes: provider messages can echo URLs, tokens or internal details. */
export class FeedError extends Error {
  constructor(public reason: "unreachable" | "blocked_address" | "http_status" | "redirect" | "not_csv" | "too_large" | "empty" | "timeout", public status?: number) {
    super(reason);
  }
}

// ---------------------------------------------------------------- HTTPS CSV feed

const httpsCsv: SourceAdapter = {
  key: "https_csv",
  sourceType: "data_feed",
  configFields: [
    { key: "url", kind: "https_url", required: true },
    { key: "record_type", kind: "record_type", required: true },
  ],
  secretSlots: [{ key: "bearer_token", optional: true }],
  validateConfig(input) {
    const url = checkFeedUrl(input.url).href;
    const rt = String(input.record_type ?? "");
    if (!(IMPORT_RECORD_TYPES as readonly string[]).includes(rt)) throw new IdentityError("invalid_input", "record_type");
    return { url, record_type: rt };
  },
  async fetch(config, secrets, deps) {
    const url = checkFeedUrl(config.url);
    const addrs = await deps.lookup(url.hostname).catch(() => { throw new FeedError("unreachable"); });
    if (!addrs.length || addrs.some((a) => privateAddress(a.address))) throw new FeedError("blocked_address");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const headers: Record<string, string> = { accept: "text/csv, text/plain;q=0.9", "user-agent": "Baytline-Inventory-Feed/1" };
      if (secrets[0]) headers.authorization = `Bearer ${secrets[0]}`;
      const res = await deps.fetch(url, { headers, redirect: "manual", signal: ctrl.signal }).catch((e) => {
        throw new FeedError(e?.name === "AbortError" ? "timeout" : "unreachable");
      });
      if (res.status >= 300 && res.status < 400) throw new FeedError("redirect", res.status);
      if (!res.ok) throw new FeedError("http_status", res.status);
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!type.startsWith("text/csv") && !type.startsWith("text/plain") && !type.startsWith("application/csv")) throw new FeedError("not_csv");
      const text = await readLimited(res, IMPORT_MAX_BYTES);
      const table = parseCsv(text.replace(/^﻿/, ""));
      if (table.length < 2) throw new FeedError("empty");
      // The data's own timestamp, if the provider gives one. Otherwise the fetch time, labelled as such.
      const stated = res.headers.get("x-data-as-of");
      const modified = res.headers.get("last-modified");
      const statedAt = stated ? new Date(stated) : null;
      const modifiedAt = modified ? new Date(modified) : null;
      const now = deps.now();
      const valid = (d: Date | null) => d && !Number.isNaN(d.getTime()) && d.getTime() <= now.getTime() + 5 * 60_000;
      const [asOf, asOfBasis] = valid(statedAt) ? [statedAt!, "data_header" as const] : valid(modifiedAt) ? [modifiedAt!, "last_modified" as const] : [now, "fetch_time" as const];
      return { headers: table[0]!.map((h) => h.trim()), rows: table.slice(1), asOf, asOfBasis, recordType: config.record_type as ImportRecordType };
    } finally {
      clearTimeout(timer);
    }
  },
};

/** Every adapter that exists. No direct-integration (developer API) adapters have been built yet. */
export const ADAPTERS: readonly SourceAdapter[] = [httpsCsv];

export function adapterByKey(key: string | null | undefined): SourceAdapter | undefined {
  return ADAPTERS.find((a) => a.key === key);
}

export function adaptersFor(type: SourceType): SourceAdapter[] {
  return ADAPTERS.filter((a) => a.sourceType === type);
}

export const _test = { privateAddress };
