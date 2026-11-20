"use client";

import { useSyncExternalStore } from "react";
import { COMPARE_LIMIT } from "@baytline/core";

// The compare selection is a per-visitor convenience kept in this browser only. Every read and
// write is guarded: in a private window or with storage blocked it simply starts empty.
const KEY = "baytline.compare.v1";
const EVENT = "baytline-compare";
const EMPTY: string[] = [];
let cache: { raw: string | null; value: string[] } = { raw: null, value: EMPTY };

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === cache.raw) return cache.value;
    const parsed = raw ? JSON.parse(raw) : [];
    const value = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string" && /^(unit|rental):[0-9a-f-]{36}$/i.test(x)).slice(0, COMPARE_LIMIT) : [];
    cache = { raw, value };
    return value;
  } catch {
    return EMPTY;
  }
}

function write(next: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next.slice(0, COMPARE_LIMIT)));
  } catch {
    /* storage unavailable: selection lasts for this page only */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useCompare() {
  const items = useSyncExternalStore(subscribe, read, () => EMPTY);
  return {
    items,
    has: (ref: string) => items.includes(ref),
    toggle: (ref: string) => write(items.includes(ref) ? items.filter((x) => x !== ref) : items.length >= COMPARE_LIMIT ? items : [...items, ref]),
    clear: () => write([]),
    full: items.length >= COMPARE_LIMIT,
  };
}
