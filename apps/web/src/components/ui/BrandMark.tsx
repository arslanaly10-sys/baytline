/**
 * Baytline mark, "Cradle": the Arabic letter ب (baa), the first letter of بيت ("home"),
 * drawn as a bowl holding three towers; its dot is the sun below the horizon.
 * Uses currentColor; the sun takes --brand-sun when set (light gold on dark backgrounds).
 * Source of truth for every logo file (see docs/brand).
 */
export const MARK_PATHS = {
  bowl: "M7 24c0 17 9.5 23 25 23s25-6 25-23",
  towers: "M20 40V29h7v11zM28.5 40V18h7v22zM37 40V25h7v15z",
  sun: { cx: 32, cy: 57, r: 4 },
} as const;

export function BrandMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path d={MARK_PATHS.bowl} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d={MARK_PATHS.towers} fill="currentColor" />
      <circle cx={MARK_PATHS.sun.cx} cy={MARK_PATHS.sun.cy} r={MARK_PATHS.sun.r} fill="var(--brand-sun, currentColor)" />
    </svg>
  );
}
