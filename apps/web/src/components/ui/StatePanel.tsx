/** Full-width message for access-denied, empty and not-configured states. */
export function StatePanel({ title, body, children, tone = "neutral" }: { title: string; body?: string; children?: React.ReactNode; tone?: "neutral" | "warning" }) {
  return (
    <section
      className={`rounded-panel border-2 px-6 py-10 text-center ${tone === "warning" ? "border-saffron bg-surface" : "border-dashed border-line"}`}
    >
      <h2 className="text-lg text-ink">{title}</h2>
      {body && <p className="mx-auto mt-2 max-w-[55ch] text-sm text-ink-muted">{body}</p>}
      {children && <div className="mt-5 flex justify-center">{children}</div>}
    </section>
  );
}
