export function SectionHeader({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro?: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs tracking-[0.16em] text-gulf uppercase">{eyebrow}</p>
        <h1 className="mt-2 font-display text-4xl leading-[1.05] sm:text-5xl">{title}</h1>
        {intro && <p className="mt-3 max-w-[65ch] text-ink-muted">{intro}</p>}
      </div>
      {children}
    </header>
  );
}
