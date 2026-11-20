"use client";

import { useEffect, useRef } from "react";

/**
 * "Data correct as of": a local date-time, defaulting to now, plus the browser's UTC offset so the
 * server stores the moment the person meant, whatever their time zone.
 */
export function AsOfField({ label, hint, name = "asOf" }: { label: string; hint: string; name?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const tz = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const now = new Date();
    if (tz.current) tz.current.value = String(now.getTimezoneOffset());
    if (input.current && !input.current.value) {
      const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
      input.current.value = local.toISOString().slice(0, 16);
      input.current.max = input.current.value;
    }
  }, []);
  return (
    <label className="block">
      <span className="block text-sm font-medium text-ink">{label}</span>
      <input ref={input} type="datetime-local" name={name} required aria-describedby={`${name}-hint`}
        className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-base text-ink focus:border-gulf" />
      <input ref={tz} type="hidden" name="tzOffset" defaultValue="0" />
      <span id={`${name}-hint`} className="mt-1 block text-xs text-ink-muted">{hint}</span>
    </label>
  );
}
