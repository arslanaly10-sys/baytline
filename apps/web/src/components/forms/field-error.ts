"use client";

import { useEffect, useId } from "react";
import type { FormState } from "@/lib/form-state";

// Error codes that don't match their input's name.
const ALIASES: Record<string, string[]> = {
  end_before_start: ["endDate"],
  completion_notes: ["notes"],
  note: ["body"],
  tenant: ["tenantId"],
  assignee: ["assigneeId"],
  unit: ["unitId"],
  phase: ["phaseId"],
  unit_code_taken: ["code"],
  handover_before_launch: ["handoverDate"],
  country: ["market"],
  role: ["orgType"],
  slots: ["slot1Date"],
  phone_required: ["phone"],
  listing: ["about"],
  confirmed_for: ["confirmedFor"],
  agreement_end: ["agreementEnd"],
  coordinates: ["latitude"],
  coordinates_outside_gcc: ["latitude"],
  distance: ["distanceKm"],
  source_required: ["sourceReference"],
  source_kind: ["sourceKind"],
  expected_date: ["expectedDate"],
  import_empty: ["csv"],
  import_header: ["csv"],
  import_too_many: ["csv"],
  import_source_required: ["fileSource"],
  // Inventory sources and imports
  projects: ["projectIds", "allProjects"],
  partner_projects: ["projectIds"],
  as_of_future: ["asOf"],
  as_of_too_old: ["asOf"],
  file_empty: ["file", "csv"],
  file_headers: ["file", "csv"],
  file_too_large: ["file"],
  file_too_many_rows: ["file", "csv"],
  lines_too_many: ["lines"],
  decision_note_required: ["note"],
  no_adapter: ["type"],
};

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * After a failed submit, marks the field the error is about (aria-invalid + aria-describedby
 * pointing at the message) and moves focus to it. Returns the id to put on the error message.
 */
export function useFieldError(form: React.RefObject<HTMLFormElement | null>, state: FormState) {
  const errorId = useId();
  useEffect(() => {
    const el = form.current;
    if (!el) return;
    el.querySelectorAll("[aria-invalid]").forEach((n) => {
      n.removeAttribute("aria-invalid");
      if (n.getAttribute("aria-describedby") === errorId) n.removeAttribute("aria-describedby");
    });
    if (state.status !== "error" || !state.field) return;
    // "mapping_code" is about the column select named "map_code".
    const mapped = state.field.startsWith("mapping_") ? [`map_${state.field.slice(8)}`] : [];
    const names = [camel(state.field), state.field, ...mapped, ...(ALIASES[state.field] ?? [])];
    for (const name of names) {
      const control = el.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]:not([type="hidden"])`);
      if (control) {
        control.setAttribute("aria-invalid", "true");
        const prev = control.getAttribute("aria-describedby");
        control.setAttribute("aria-describedby", prev ? `${prev} ${errorId}` : errorId);
        control.focus();
        return;
      }
    }
  }, [form, state, errorId]);
  return errorId;
}
