export function SectionHeader({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro?: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-sm text-ink-muted">{eyebrow}</p>
        <h1 className="mt-1 text-2xl sm:text-3xl">{title}</h1>
        {intro && <p className="mt-3 max-w-[65ch] text-ink-muted">{intro}</p>}
      </div>
      {children}
    </header>
  );
}
