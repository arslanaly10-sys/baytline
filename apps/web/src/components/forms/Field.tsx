type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; name: string };

export function Field({ label, hint, name, className = "", ...rest }: InputProps) {
  const hintId = hint ? `${name}-hint` : undefined;
  return (
    <label className={`block ${className}`}>
      <span className="block text-sm font-medium text-ink">{label}</span>
      <input
        name={name}
        aria-describedby={hintId}
        className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:border-gulf"
        {...rest}
      />
      {hint && (
        <span id={hintId} className="mt-1 block text-xs text-ink-muted">
          {hint}
        </span>
      )}
    </label>
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  hideLabel?: boolean;
};

export function SelectField({ label, name, options, hideLabel, className = "", ...rest }: SelectProps) {
  return (
    <label className={`block ${className}`}>
      <span className={hideLabel ? "sr-only" : "block text-sm font-medium text-ink"}>{label}</span>
      <select
        name={name}
        className={`${hideLabel ? "" : "mt-1"} block w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink`}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
