import "server-only";
import type { UiLocale } from "@baytline/core";
import type { Dictionary } from "./en";

const loaders: Record<UiLocale, () => Promise<Dictionary>> = {
  en: () => import("./en").then((m) => m.default),
  ar: () => import("./ar").then((m) => m.default),
};

export function getDictionary(locale: UiLocale): Promise<Dictionary> {
  return loaders[locale]();
}

export type { Dictionary };
