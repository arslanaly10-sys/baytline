/** Shown while a workspace page loads. Locale isn't available here, so it's bilingual and visually quiet. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">
        <span lang="en">Loading workspace…</span> <span lang="ar">جارٍ تحميل مساحة العمل…</span>
      </span>
      <div className="h-4 w-40 animate-pulse rounded-chip bg-surface-sunk" />
      <div className="h-9 w-72 animate-pulse rounded-control bg-surface-sunk" />
      <div className="h-24 w-full animate-pulse rounded-panel bg-surface-sunk" />
    </div>
  );
}
