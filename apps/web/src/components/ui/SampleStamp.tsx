export function SampleStamp({ label, title }: { label: string; title?: string }) {
  return (
    <span className="sample-stamp" title={title}>
      {label}
    </span>
  );
}
