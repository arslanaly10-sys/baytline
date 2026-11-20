/** Marks local-development placeholder accounts so they're never mistaken for real people. */
export function PlaceholderBadge({ label, hint }: { label: string; hint: string }) {
  return (
    <span className="sample-stamp" title={hint}>
      {label}
      <span className="sr-only">: {hint}</span>
    </span>
  );
}
