/**
 * Small status label. Tone is never the only signal: the text always says the state,
 * and "attention" / "problem" add an edge treatment that survives greyscale.
 */
export type ChipTone = "good" | "neutral" | "attention" | "problem" | "muted";

const TONES: Record<ChipTone, string> = {
  good: "border-mangrove text-mangrove",
  neutral: "border-gulf text-gulf-strong",
  attention: "border-saffron text-ink bg-[repeating-linear-gradient(135deg,var(--saffron-tint)_0_4px,transparent_4px_8px)]",
  problem: "border-coral text-coral border-double border-[3px]",
  muted: "border-dashed border-ink-muted text-ink-muted",
};

export function Chip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded-chip border px-1.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}
