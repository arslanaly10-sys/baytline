/**
 * Integration status is derived, never stored or typed in by hand.
 * "connected" requires ALL of: an adapter exists, the admin hasn't disabled it,
 * every required secret is present, and the latest connection check succeeded
 * recently. Anything less is reported as exactly what it is.
 */
export type IntegrationStatus =
  | "not_available" // no adapter has been built yet
  | "disabled" // turned off by a platform administrator
  | "development_only" // local stand-in (e.g. console outbox); never real delivery
  | "not_configured" // adapter exists but required secrets are missing
  | "untested" // secrets present, no connection check yet
  | "failing" // latest check failed
  | "stale" // latest check succeeded, but too long ago to rely on
  | "connected";

export const CHECK_FRESH_HOURS = 24;

export type StatusInput = {
  adapterAvailable: boolean;
  enabled: boolean;
  developmentOnly: boolean;
  missingSecrets: number;
  lastCheck?: { ok: boolean; at: Date } | null;
};

export function deriveStatus(i: StatusInput, now: Date = new Date()): IntegrationStatus {
  if (i.developmentOnly && i.enabled) return "development_only";
  if (!i.adapterAvailable) return "not_available";
  if (!i.enabled) return "disabled";
  if (i.missingSecrets > 0) return "not_configured";
  if (!i.lastCheck) return "untested";
  if (!i.lastCheck.ok) return "failing";
  const ageHours = (now.getTime() - i.lastCheck.at.getTime()) / 36e5;
  if (ageHours > CHECK_FRESH_HOURS || ageHours < 0) return "stale";
  return "connected";
}
