const box = "mt-1.5 block w-full rounded-xl border border-hairline bg-night px-3.5 py-2.5 text-sand placeholder:text-mist/70 focus:border-gold";

export function SiteField({ label, hint, name, className = "", ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; hint?: string }) {
  const hintId = hint ? `${name}-hint` : undefined;
  return (
    <label className={`block text-sm text-sand/90 ${className}`}>
      {label}
      <input name={name} aria-describedby={hintId} className={box} {...rest} />
      {hint && <span id={hintId} className="mt-1 block text-xs text-mist">{hint}</span>}
    </label>
  );
}

export function SiteSelect({ label, name, options, className = "", ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; name: string; options: { value: string; label: string }[] }) {
  return (
    <label className={`block text-sm text-sand/90 ${className}`}>
      {label}
      <select name={name} className={box} {...rest}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function SiteTextArea({ label, name, className = "", ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; name: string }) {
  return (
    <label className={`block text-sm text-sand/90 ${className}`}>
      {label}
      <textarea name={name} rows={3} className={box} {...rest} />
    </label>
  );
}
