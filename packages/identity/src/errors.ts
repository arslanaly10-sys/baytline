export type IdentityErrorCode =
  | "not_found" // also used for "not a member", so org IDs can't be probed
  | "forbidden"
  | "invalid_input"
  | "conflict"
  | "last_admin"
  | "not_configured"
  | "rate_limited";

export class IdentityError extends Error {
  constructor(
    readonly code: IdentityErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}
