/** Replaces {name} placeholders. Missing values are left visible so gaps are caught in review. */
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Splits a template around one {placeholder} so a React node (e.g. <bdi>) can sit inside translated text. */
export function splitAround(template: string, key: string): [string, string] {
  const [before = "", after = ""] = template.split(`{${key}}`);
  return [before, after];
}
