"use client";

import { useActionState } from "react";
import { buttonClass } from "@/lib/button";
import { confirmMfaAction, startMfaAction, type EnrollState } from "@/server/actions/security";

type Labels = { start: string; starting: string; scan: string; key: string; qrAlt: string; codeLabel: string; confirm: string; confirming: string; codesTitle: string; codesIntro: string; done: string };

/** Setup in two steps: show the QR code and key, then confirm with a first code. Recovery codes appear once. */
export function MfaEnroll({ locale, labels }: { locale: string; labels: Labels }) {
  const [started, start, starting] = useActionState<EnrollState, FormData>(startMfaAction, { status: "idle" });
  const [confirmed, confirm, confirming] = useActionState<EnrollState, FormData>(confirmMfaAction, { status: "idle" });
  if (confirmed.status === "done") {
    return (
      <div className="space-y-3" aria-live="polite">
        <p className="rounded-control border-s-4 border-mangrove bg-surface px-3 py-2 text-sm">{labels.done}</p>
        <h3 className="font-medium">{labels.codesTitle}</h3>
        <p className="text-sm text-ink-muted">{labels.codesIntro}</p>
        <ul className="grid grid-cols-2 gap-2 rounded-control bg-surface-sunk p-3 font-mono text-sm sm:grid-cols-5" dir="ltr">
          {confirmed.codes.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>
    );
  }
  if (started.status !== "started") {
    return (
      <form action={start} aria-busy={starting}>
        <input type="hidden" name="locale" value={locale} />
        <button type="submit" disabled={starting} className={buttonClass()}>{starting ? labels.starting : labels.start}</button>
        <div aria-live="polite">{started.status === "error" && <p role="alert" className="mt-3 rounded-control border-s-4 border-coral bg-surface px-3 py-2 text-sm">{started.message}</p>}</div>
      </form>
    );
  }
  return (
    <div className="grid gap-5 sm:grid-cols-[12rem_minmax(0,1fr)]">
      {/* Generated on our server from the otpauth URI; it's an SVG string, not user content. */}
      <div role="img" aria-label={labels.qrAlt} className="size-48 overflow-hidden rounded-control bg-white p-2" dangerouslySetInnerHTML={{ __html: started.qrSvg }} />
      <div className="space-y-3">
        <p className="text-sm">{labels.scan}</p>
        <p className="text-sm"><span className="text-ink-muted">{labels.key}: </span><code dir="ltr" className="break-all font-mono">{started.secret.replace(/(.{4})/g, "$1 ").trim()}</code></p>
        <form action={confirm} className="space-y-3" aria-busy={confirming}>
          <input type="hidden" name="locale" value={locale} />
          <label className="block">
            <span className="block text-sm font-medium">{labels.codeLabel}</span>
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required dir="ltr"
              className="mt-1 block w-40 rounded-control border border-line bg-surface px-3 py-2 text-base tracking-widest text-ink focus:border-gulf" />
          </label>
          <button type="submit" disabled={confirming} className={buttonClass()}>{confirming ? labels.confirming : labels.confirm}</button>
          <div aria-live="polite">{confirmed.status === "error" && <p role="alert" className="rounded-control border-s-4 border-coral bg-surface px-3 py-2 text-sm">{confirmed.message}</p>}</div>
        </form>
      </div>
    </div>
  );
}
