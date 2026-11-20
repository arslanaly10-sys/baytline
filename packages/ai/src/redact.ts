/**
 * Personal-data redaction. Runs on everything sent to the provider and on everything stored in the log.
 * It is pattern-based, so it is a safety net, not a guarantee: callers still pass the least data a task
 * needs. Order matters (longer, more specific patterns first) so a card number isn't half-read as a phone.
 */
export type RedactionKind = "email" | "card" | "iban" | "national_id" | "phone";
export type Redacted = { text: string; counts: Partial<Record<RedactionKind, number>> };

const TOKENS: Record<RedactionKind, string> = {
  email: "[EMAIL]",
  card: "[CARD]",
  iban: "[IBAN]",
  national_id: "[NATIONAL_ID]",
  phone: "[PHONE]",
};

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

type Rule = { kind: RedactionKind; re: RegExp; accept?: (match: string) => boolean };

const RULES: Rule[] = [
  { kind: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // Payment cards: 13-19 digits, optionally grouped, passing the Luhn check (so prices and unit codes survive).
  { kind: "card", re: /\b(?:\d[ -]?){12,18}\d\b/g, accept: (m) => { const d = m.replace(/\D/g, ""); return d.length >= 13 && d.length <= 19 && luhn(d); } },
  // IBAN: country code, two check digits, 11-30 more characters, optionally in groups of four.
  { kind: "iban", re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g },
  // UAE Emirates ID (784-YYYY-NNNNNNN-N) and 10-digit Saudi national / iqama numbers (start 1 or 2),
  // Qatar / Kuwait / Bahrain 9-12 digit civil IDs are caught by the phone rule's digit-run fallback below.
  { kind: "national_id", re: /\b784[- ]?\d{4}[- ]?\d{7}[- ]?\d\b/g },
  { kind: "national_id", re: /\b[12]\d{9}\b/g },
  // Phone numbers: international (+ or 00) or local GCC mobile formats, 8-15 digits with separators.
  { kind: "phone", re: /(?:\+|\b00)\d{1,3}[\s.-]?(?:\(?\d{1,4}\)?[\s.-]?){2,5}\d{2,4}\b/g },
  { kind: "phone", re: /\b0?5\d[\s.-]?\d{3}[\s.-]?\d{4}\b/g },
  // Any remaining long run of digits (9-15) is treated as an identifier: IDs and account numbers.
  { kind: "national_id", re: /\b\d{9,15}\b/g },
];

export function redact(input: string): Redacted {
  let text = input;
  const counts: Redacted["counts"] = {};
  for (const rule of RULES) {
    text = text.replace(rule.re, (m) => {
      if (rule.accept && !rule.accept(m)) return m;
      counts[rule.kind] = (counts[rule.kind] ?? 0) + 1;
      return TOKENS[rule.kind];
    });
  }
  return { text, counts };
}

export function totalRedactions(c: Redacted["counts"]): number {
  return Object.values(c).reduce((s, n) => s + (n ?? 0), 0);
}
