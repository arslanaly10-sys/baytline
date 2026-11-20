/** Structural placeholder while listings load; announced to screen readers. */
export default function Loading() {
  return (
    <main id="main" className="bg-night text-sand" aria-busy="true">
      <div className="mx-auto max-w-7xl px-4 pb-10 pt-32 sm:px-8 md:pt-40">
        <p className="sr-only" role="status">Loading…</p>
        <div className="h-14 w-72 max-w-full animate-pulse rounded-2xl bg-panel motion-reduce:animate-none" />
        <div className="mt-6 h-5 w-[32rem] max-w-full animate-pulse rounded bg-panel motion-reduce:animate-none" />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-72 animate-pulse rounded-3xl border border-hairline bg-night-2 motion-reduce:animate-none" />)}
        </div>
      </div>
    </main>
  );
}
