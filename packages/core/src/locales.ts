export type LocaleDef = {
  code: string;
  /** Name in its own language, for the language picker. */
  nativeName: string;
  dir: "ltr" | "rtl";
  /** "enabled" locales have complete UI dictionaries. "planned" ones are supported for
   *  content, conversations and voice notes first, UI translation later. */
  uiStatus: "enabled" | "planned";
};

export const LOCALES = [
  { code: "en", nativeName: "English", dir: "ltr", uiStatus: "enabled" },
  { code: "ar", nativeName: "العربية", dir: "rtl", uiStatus: "enabled" },
  { code: "ur", nativeName: "اردو", dir: "rtl", uiStatus: "planned" },
  { code: "ru", nativeName: "Русский", dir: "ltr", uiStatus: "planned" },
  { code: "es", nativeName: "Español", dir: "ltr", uiStatus: "planned" },
  { code: "pt", nativeName: "Português", dir: "ltr", uiStatus: "planned" },
  { code: "ms", nativeName: "Bahasa Melayu", dir: "ltr", uiStatus: "planned" },
] as const satisfies readonly LocaleDef[];

export type LocaleCode = (typeof LOCALES)[number]["code"];
export type UiLocale = Extract<(typeof LOCALES)[number], { uiStatus: "enabled" }>["code"];

export const UI_LOCALES = LOCALES.filter((l) => l.uiStatus === "enabled").map((l) => l.code) as UiLocale[];
export const DEFAULT_UI_LOCALE: UiLocale = "en";

export function isUiLocale(v: string): v is UiLocale {
  return (UI_LOCALES as string[]).includes(v);
}

export function localeDir(code: LocaleCode): "ltr" | "rtl" {
  return LOCALES.find((l) => l.code === code)?.dir ?? "ltr";
}
