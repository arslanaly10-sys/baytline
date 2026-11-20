import type { AvailabilityLabel } from "@baytline/core";

/**
 * Grounding: the only facts the AI may use. Every fact names the record it came from and where that
 * record's data came from. Facts without a source, sample records and unapproved prices or plans are
 * rejected before anything reaches the model, and each fact carries its inventory label so the model is
 * told, in plain words, what may be called available and what may not.
 */
export type FactKind = "project" | "unit" | "price" | "payment_plan" | "location" | "document" | "other";

export type GroundedFact = {
  kind: FactKind;
  /** The record this fact describes, e.g. a unit id. */
  ref: { type: string; id: string };
  /** What the fact says, written by the caller from stored data (e.g. "Unit A-101: 2 bedrooms, 118 m²"). */
  text: string;
  /** Where the data came from: an inventory source, an approved version, a document. Required. */
  source: { kind: string; name: string } | null;
  /** For unit availability: the label computed by @baytline/core availabilityLabel. */
  availability?: AvailabilityLabel;
  /** Unit status as stored (available, reserved, ...). */
  status?: string;
  /** Prices and payment plans must come from an approved version. */
  approved?: boolean;
  isSample?: boolean;
  /** When the owning organization last confirmed it. */
  confirmedAt?: string | null;
};

export type RejectedFact = { ref: GroundedFact["ref"]; reason: "no_source" | "sample_record" | "not_approved" | "empty" };
export type GroundingRef = { type: string; id: string; kind: FactKind; source: string; label: string };

/** How each availability label must be described. Only live and recently confirmed may be called available. */
export const AVAILABILITY_WORDING: Record<AvailabilityLabel, string> = {
  live: "confirmed available just now by the owner's live connection",
  recently_confirmed: "confirmed available by the owner recently",
  stale: "STALE: last confirmation is too old; do not say it is available, say it needs checking",
  unverified: "UNVERIFIED: not confirmed by the owner; do not say it is available",
  disputed: "CONFLICTING: sources disagree; do not say it is available, say it is being checked",
};

export function prepareGrounding(facts: readonly GroundedFact[]): { block: string; refs: GroundingRef[]; rejected: RejectedFact[] } {
  const rejected: RejectedFact[] = [];
  const kept: GroundedFact[] = [];
  for (const f of facts) {
    if (!f.text?.trim()) rejected.push({ ref: f.ref, reason: "empty" });
    else if (!f.source?.name) rejected.push({ ref: f.ref, reason: "no_source" });
    else if (f.isSample) rejected.push({ ref: f.ref, reason: "sample_record" });
    else if ((f.kind === "price" || f.kind === "payment_plan") && f.approved !== true) rejected.push({ ref: f.ref, reason: "not_approved" });
    else kept.push(f);
  }
  const lines = kept.map((f, i) => {
    const parts = [`[${i + 1}] (${f.kind}; source: ${f.source!.name}) ${f.text.trim().replace(/\s+/g, " ")}`];
    if (f.kind === "unit" && f.availability) {
      const status = f.status && f.status !== "available" ? `status ${f.status}; ` : "";
      parts.push(`Availability: ${status}${f.status === "available" || !f.status ? AVAILABILITY_WORDING[f.availability] : "not available"}.`);
    }
    if (f.confirmedAt) parts.push(`Last confirmed ${f.confirmedAt}.`);
    return parts.join(" ");
  });
  const refs = kept.map((f) => ({
    type: f.ref.type, id: f.ref.id, kind: f.kind, source: f.source!.name,
    label: f.kind === "unit" ? (f.availability ?? "unverified") : f.approved ? "approved" : "sourced",
  }));
  const block = lines.length ? `<data>\n${lines.join("\n")}\n</data>` : "<data>\n(no approved records were provided)\n</data>";
  return { block, refs, rejected };
}

/**
 * Rules every request carries in its system prompt. They restate the platform's honesty rules for the
 * model; the gateway still enforces what it can in code (what data is passed in at all).
 */
export const GROUNDING_RULES = [
  "You are an assistant inside Baytline, a real estate platform for the GCC. You help staff of one organization.",
  "Use only the facts inside <data>. If something is not in <data>, say you don't have that information. Never invent units, prices, payment plans, availability, dates, places, travel times or competitors.",
  "Cite the facts you use by their number, like [2].",
  "Only describe a unit as available when its availability line says it was confirmed available. For stale, unverified or conflicting units, say exactly that.",
  "Quote prices and payment plans only as given in <data>; they come from approved versions. Do not calculate new prices, discounts or instalments.",
  "Do not give legal, tax or financial advice. Personal details have been replaced with placeholders like [PHONE]; never try to restore them.",
  "Your output is a suggestion or a draft for a person to review. Never claim that anything has been sent, saved, reserved or changed.",
].join("\n");
