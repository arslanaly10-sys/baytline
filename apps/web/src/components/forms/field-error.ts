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
  agreement_end: ["agreementEnd"],
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
    const names = [camel(state.field), state.field, ...(ALIASES[state.field] ?? [])];
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
