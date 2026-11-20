/** Shared button styles. Plain module so both server and client components can use it. */
export function buttonClass(variant: "primary" | "quiet" | "danger" = "primary"): string {
  const base = "inline-flex items-center justify-center rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:cursor-wait disabled:opacity-60";
  if (variant === "quiet") return `${base} border border-line bg-surface text-ink hover:border-gulf hover:text-gulf-strong`;
  if (variant === "danger") return `${base} border border-coral bg-surface text-coral hover:bg-coral hover:text-surface`;
  return `${base} bg-gulf text-gulf-ink hover:bg-gulf-strong`;
}
