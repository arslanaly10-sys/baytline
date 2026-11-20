import type { Dictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { StatePanel } from "./StatePanel";

/** A section that exists in this workspace but isn't part of the user's role. */
export function AccessDenied({ dict, orgName }: { dict: Dictionary; orgName: string }) {
  return <StatePanel tone="warning" title={dict.states.deniedTitle} body={format(dict.states.deniedBody, { org: orgName })} />;
}
