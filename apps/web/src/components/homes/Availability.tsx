import { CheckCircle, ClockCountdown, MinusCircle, Question, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import type { UiLocale } from "@baytline/core";
import type { Availability } from "@baytline/marketplace";
import type { Dictionary } from "@/i18n";
import { ago } from "@/lib/homes-format";

/**
 * The only place availability is put into words. "Available" appears only for a recent owner
 * confirmation; every other state says what is actually known, with its date.
 */
export function AvailabilityBadge({ a, dict, locale, detail = true }: { a: Availability; dict: Dictionary; locale: UiLocale; detail?: boolean }) {
  const t = dict.cx.availability;
  const when = a.confirmedAt ? ago(a.confirmedAt, locale) : "";
  const map = {
    available_confirmed: { Icon: CheckCircle, tone: "border-mangrove/60 text-mangrove", sub: t.confirmedWhen.replace("{when}", when) },
    available_unconfirmed: { Icon: Question, tone: "border-dashed border-mist/60 text-mist", sub: t.unconfirmedHint },
    stale: { Icon: ClockCountdown, tone: "border-saffron/60 text-saffron", sub: t.staleHint.replace("{when}", when) },
    disputed: { Icon: WarningCircle, tone: "border-coral/60 text-coral", sub: "" },
    reserved: { Icon: MinusCircle, tone: "border-hairline text-mist", sub: "" },
    sold: { Icon: MinusCircle, tone: "border-hairline text-mist", sub: "" },
    not_offered: { Icon: MinusCircle, tone: "border-hairline text-mist", sub: "" },
  } as const;
  const m = map[a.state];
  return (
    <span className="inline-flex flex-col gap-1">
      <span className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${m.tone}`}>
        <m.Icon aria-hidden="true" weight="bold" className="size-3.5" />
        {t[a.state]}
      </span>
      {detail && m.sub && <span className="text-xs text-mist">{m.sub}</span>}
    </span>
  );
}
