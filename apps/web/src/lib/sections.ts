import type { WorkspaceId } from "@baytline/core";
import type { Dictionary } from "@/i18n/en";

type WsDict = Dictionary["workspaces"][WorkspaceId];

export function sectionLabel(ws: WsDict, id: string): string {
  return (ws.sections as Record<string, { label: string }>)[id]?.label ?? id;
}

export function sectionDescription(ws: WsDict, id: string): string {
  return (ws.sections as Record<string, { description: string }>)[id]?.description ?? "";
}
