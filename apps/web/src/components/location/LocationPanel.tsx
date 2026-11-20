import Link from "next/link";
import { Info, MapPin, SealCheck, SealQuestion } from "@phosphor-icons/react/dist/ssr";
import { DISTANCE_STEPS, PLACE_CATEGORIES, PLACE_KINDS, PLACE_STAGES, type LatLng, type PlaceDistance, type PlaceKind, type UiLocale } from "@baytline/core";
import type { Dictionary } from "@/i18n";
import { format } from "@/i18n/format";
import { ago, calendarDay, distanceText, list } from "@/lib/homes-format";
import { archivePlaceAction, createPlaceAction, importPlacesAction, saveLocationAction, updatePlaceAction, verifyLocationAction, verifyPlaceAction } from "@/server/actions/location";
import { Chip } from "@/components/ui/Chip";
import { ActionForm } from "@/components/forms/ActionForm";
import { ConfirmAction } from "@/components/forms/ConfirmAction";
import { Field } from "@/components/forms/Field";
import { SchematicMap } from "./SchematicMap";

export type PlaceVM = {
  id: string; kind: PlaceKind; category: string; name: string; description: string | null; coordinates: LatLng | null; distance: PlaceDistance;
  recordedDistanceM?: number | null; stage: string | null; expectedDate: string | null; developerName: string | null; sourceKind: string;
  sourceReference: string | null; verification: "unverified" | "verified"; updatedAt: Date; updatedByName?: string | null;
};
export type LocationVM = {
  address: string | null; area: string | null; coordinates: LatLng | null; sourceKind: string; sourceReference: string | null;
  verification: "unverified" | "verified"; verifiedAt: Date | null; verifiedByName?: string | null; updatedAt: Date; updatedByName?: string | null;
};

type Props = {
  dict: Dictionary;
  locale: UiLocale;
  intlLocale: string;
  projectName: string;
  city: string;
  marketName: string;
  location: LocationVM | null;
  places: PlaceVM[];
  totalPlaces: number;
  hiddenWithoutDistance: number;
  mode: "owner" | "partner" | "public";
  canManage?: boolean;
  canVerify?: boolean;
  /** GET target for the filter form; omitted for the public page (no filters). */
  filterPath?: string;
  filters?: { kind?: string; category?: string; maxDistance?: string };
  hidden?: Record<string, string>;
  sharing?: { partners: number; publicOn: boolean; sharesHref: string; publicHref: string };
};

const input = "mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink";

function Hidden({ values }: { values: Record<string, string> }) {
  return <>{Object.entries(values).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>;
}

function Verification({ v, dict }: { v: "unverified" | "verified"; dict: Dictionary }) {
  return v === "verified"
    ? <Chip tone="good"><span className="inline-flex items-center gap-1"><SealCheck aria-hidden="true" weight="fill" className="size-3.5" />{dict.loc.verification.verified}</span></Chip>
    : <Chip tone="muted"><span className="inline-flex items-center gap-1"><SealQuestion aria-hidden="true" className="size-3.5" />{dict.loc.verification.unverified}</span></Chip>;
}

/** Kind, category and stage, grouped by kind so it works without JavaScript; the server checks they fit. */
function PlaceFields({ dict, p }: { dict: Dictionary; p?: PlaceVM }) {
  const t = dict.loc.places;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="block text-sm font-medium">{t.kind}
        <select name="kind" defaultValue={p?.kind ?? "amenity"} className={input}>{PLACE_KINDS.map((k) => <option key={k} value={k}>{t.kinds[k]}</option>)}</select>
      </label>
      <label className="block text-sm font-medium">{t.category}
        <select name="category" defaultValue={p?.category ?? "transport"} className={input}>
          {PLACE_KINDS.map((k) => <optgroup key={k} label={t.kinds[k]}>{PLACE_CATEGORIES[k].map((c) => <option key={`${k}-${c}`} value={c}>{t.categories[c]}</option>)}</optgroup>)}
        </select>
      </label>
      <Field label={t.name} name="name" required maxLength={160} defaultValue={p?.name} />
      <Field label={dict.loc.profile.latitude} name="latitude" inputMode="decimal" dir="ltr" defaultValue={p?.coordinates?.lat ?? ""} hint={dict.loc.profile.coordsHint} />
      <Field label={dict.loc.profile.longitude} name="longitude" inputMode="decimal" dir="ltr" defaultValue={p?.coordinates?.lng ?? ""} />
      <Field label={t.distanceKm} name="distanceKm" inputMode="decimal" defaultValue={p?.recordedDistanceM != null ? String(p.recordedDistanceM / 1000) : ""} hint={t.distanceHint} />
      <label className="block text-sm font-medium">{t.stage}
        <select name="stage" defaultValue={p?.stage ?? ""} className={input}>
          <option value="">—</option>
          {(["infrastructure", "competitor"] as const).map((k) => <optgroup key={k} label={t.kinds[k]}>{PLACE_STAGES[k].map((s) => <option key={`${k}-${s}`} value={s}>{t.stages[s]}</option>)}</optgroup>)}
        </select>
        <span className="mt-1 block text-xs font-normal text-ink-muted">{t.notApplicable}</span>
      </label>
      <Field label={t.expectedDate} name="expectedDate" type="date" defaultValue={p?.expectedDate ?? ""} />
      <Field label={t.developerName} name="developerName" maxLength={160} defaultValue={p?.developerName ?? ""} />
      <Field label={t.source} name="sourceReference" maxLength={300} defaultValue={p?.sourceReference ?? ""} hint={t.sourceRequired} className="sm:col-span-2" />
      <label className="block text-sm font-medium">{dict.loc.profile.sourceKind}
        <select name="sourceKind" defaultValue={p?.sourceKind === "structured_import" ? "structured_import" : "manual_entry"} className={input}>
          <option value="manual_entry">{dict.loc.sources.manual_entry}</option>
          <option value="structured_import">{dict.loc.sources.structured_import}</option>
        </select>
      </label>
      <label className="block text-sm font-medium sm:col-span-2 lg:col-span-3">{t.description}
        <textarea name="description" maxLength={1000} rows={2} defaultValue={p?.description ?? ""} className={input} />
      </label>
    </div>
  );
}

export function LocationPanel(props: Props) {
  const { dict, locale, intlLocale, location: loc, places, mode, canManage, canVerify, hidden = {} } = props;
  const t = dict.loc;
  const tp = t.places;
  const when = (d: Date) => ago(d, locale);
  const plotted = places.filter((p) => p.coordinates);
  const numbered = new Map(places.map((p, i) => [p.id, i + 1]));
  const anyFilter = Boolean(props.filters?.kind || props.filters?.category || props.filters?.maxDistance);

  return (
    <div className="space-y-10">
      <p className="flex items-start gap-2 rounded-control border border-line bg-surface-sunk px-4 py-3 text-sm text-ink-muted">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{mode === "partner" ? `${t.partner.note} ${t.providerNone}` : mode === "public" ? t.providerNonePublic : t.providerNone}
      </p>

      {/* Project location */}
      <section aria-labelledby="loc-profile" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="loc-profile" className="flex items-center gap-2 text-lg"><MapPin aria-hidden="true" className="size-5 text-gulf" />{t.profile.title}</h2>
          {loc && <Verification v={loc.verification} dict={dict} />}
        </div>
        {loc ? (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="text-sm text-ink-muted">{t.profile.address}</dt><dd>{loc.address ?? "—"}</dd></div>
            <div><dt className="text-sm text-ink-muted">{t.profile.area}</dt><dd>{loc.area ?? "—"}</dd></div>
            <div><dt className="text-sm text-ink-muted">{t.profile.city} · {t.profile.market}</dt><dd>{list([props.city, props.marketName], locale)}</dd></div>
            <div><dt className="text-sm text-ink-muted">{list([t.profile.latitude, t.profile.longitude], locale)}</dt><dd><bdi dir="ltr">{loc.coordinates ? `${loc.coordinates.lat}, ${loc.coordinates.lng}` : "—"}</bdi></dd></div>
            <div><dt className="text-sm text-ink-muted">{t.places.source}</dt><dd>{t.sources[loc.sourceKind as keyof typeof t.sources] ?? loc.sourceKind}{loc.sourceReference ? `: ${loc.sourceReference}` : ""}</dd></div>
            <div>
              <dt className="text-sm text-ink-muted">{format(t.updatedBy, { when: when(loc.updatedAt), by: loc.updatedByName ? format(t.by, { name: loc.updatedByName }) : "" })}</dt>
              {loc.verification === "verified" && loc.verifiedAt && <dd className="text-sm text-mangrove">{loc.verifiedByName ? format(t.verifiedBy, { name: loc.verifiedByName, when: when(loc.verifiedAt) }) : format(t.verifiedWhen, { when: when(loc.verifiedAt) })}</dd>}
            </div>
          </dl>
        ) : (
          <div className="rounded-panel border-2 border-dashed border-line px-6 py-8 text-center">
            <p className="text-ink-muted">{canManage ? t.profile.empty : t.profile.emptyReadOnly}</p>
            {canManage && <a href="#loc-edit" className="mt-4 inline-block rounded-control bg-gulf px-4 py-2 text-sm font-medium text-gulf-ink hover:bg-gulf-strong">{t.profile.emptyAction}</a>}
          </div>
        )}
        {canVerify && loc && loc.verification !== "verified" && (
          <div>
            <ActionForm action={verifyLocationAction} layout="inline" variant="quiet" submitLabel={t.profile.verify} pendingLabel={t.profile.verifying}><Hidden values={hidden} /></ActionForm>
            <p className="mt-1 text-xs text-ink-muted">{t.profile.verifyHint}</p>
          </div>
        )}
      </section>

      {props.sharing && (
        <section aria-labelledby="loc-sharing" className="rounded-panel border border-line bg-surface p-5">
          <h2 id="loc-sharing" className="text-lg">{t.sharing.title}</h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            <li>{t.sharing.owner}</li>
            <li>{props.sharing.partners ? format(t.sharing.partners, { n: props.sharing.partners }) : t.sharing.partnersNone} · <Link href={props.sharing.sharesHref} className="text-gulf-strong underline underline-offset-4">{t.sharing.manageShares}</Link></li>
            <li>{props.sharing.publicOn ? t.sharing.publicOn : t.sharing.publicOff} · <Link href={props.sharing.publicHref} className="text-gulf-strong underline underline-offset-4">{t.sharing.managePublic}</Link></li>
          </ul>
        </section>
      )}

      {/* Map and list */}
      <section aria-labelledby="loc-places" className="space-y-5">
        <div>
          <h2 id="loc-places" className="text-lg">{tp.title}</h2>
          <p className="mt-1 max-w-[75ch] text-sm text-ink-muted">{tp.intro}</p>
        </div>
        {props.filterPath && props.totalPlaces > 0 && (
          <form method="get" action={props.filterPath} className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">{tp.filterKind}
              <select name="kind" defaultValue={props.filters?.kind ?? ""} className={input}><option value="">{tp.any}</option>{PLACE_KINDS.map((k) => <option key={k} value={k}>{tp.kinds[k]}</option>)}</select>
            </label>
            <label className="block text-sm">{tp.filterCategory}
              <select name="category" defaultValue={props.filters?.category ?? ""} className={input}>
                <option value="">{tp.any}</option>
                {[...new Set(Object.values(PLACE_CATEGORIES).flat())].map((c) => <option key={c} value={c}>{tp.categories[c]}</option>)}
              </select>
            </label>
            <label className="block text-sm">{tp.filterDistance}
              <select name="maxDistance" defaultValue={props.filters?.maxDistance ?? ""} className={input}><option value="">{tp.any}</option>{DISTANCE_STEPS.map((d) => <option key={d} value={d}>{distanceText(d, intlLocale)}</option>)}</select>
            </label>
            <button type="submit" className="rounded-control border border-line bg-surface px-4 py-2 text-sm hover:border-gulf">{tp.apply}</button>
            {anyFilter && <Link href={props.filterPath} className="py-2 text-sm text-gulf-strong underline underline-offset-4">{tp.clear}</Link>}
          </form>
        )}
        {props.totalPlaces > 0 && <p className="text-sm text-ink-muted" aria-live="polite">{format(tp.count, { n: places.length, total: props.totalPlaces })}{props.hiddenWithoutDistance ? ` ${format(tp.hiddenNoDistance, { n: props.hiddenWithoutDistance })}` : ""}</p>}

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="space-y-2">
            <h3 className="sr-only">{t.map.title}</h3>
            {loc?.coordinates ? (
              <>
                <SchematicMap origin={loc.coordinates} points={plotted.map((p) => ({ n: numbered.get(p.id)!, name: p.name, kind: p.kind, coordinates: p.coordinates! }))}
                  labels={{ title: format(t.map.label, { project: props.projectName, n: plotted.length }), project: t.map.project, north: t.map.north }} intlLocale={intlLocale} />
                <p className="text-xs text-ink-muted">{t.map.schematic}</p>
                {places.length > plotted.length && <p className="text-xs text-ink-muted">{format(t.map.notPlotted, { n: places.length - plotted.length })}</p>}
                <ul className="flex flex-wrap gap-4 text-xs text-ink-muted">
                  {PLACE_KINDS.map((k) => <li key={k} className="flex items-center gap-1.5"><span aria-hidden="true" className={`inline-block size-3 ${k === "amenity" ? "rounded-full bg-gulf" : k === "infrastructure" ? "rounded-sm bg-saffron" : "rotate-45 bg-coral"}`} />{tp.kinds[k]}</li>)}
                </ul>
              </>
            ) : (
              <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-sm text-ink-muted">{t.map.needCoords}</p>
            )}
          </div>

          {places.length === 0 ? (
            <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">
              {anyFilter ? tp.emptyFiltered : canManage ? tp.empty : tp.emptyReadOnly}
              {!anyFilter && canManage && <a href="#place-add" className="mt-4 block w-fit rounded-control bg-gulf px-4 py-2 text-sm font-medium text-gulf-ink hover:bg-gulf-strong sm:mx-auto">{tp.addTitle}</a>}
            </p>
          ) : (
            <ol className="divide-y divide-line rounded-panel border border-line bg-surface">
              {places.map((p) => (
                <li key={p.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <span aria-hidden="true" className={`flex size-7 shrink-0 items-center justify-center text-xs font-bold text-gulf-ink ${p.kind === "amenity" ? "rounded-full bg-gulf" : p.kind === "infrastructure" ? "rounded-md bg-saffron" : "rounded-md bg-coral"}`}>{numbered.get(p.id)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-medium">{p.name}</p>
                        <Verification v={p.verification} dict={dict} />
                      </div>
                      <p className="mt-0.5 text-sm text-ink-muted">
                        {tp.kinds[p.kind]} · {tp.categories[p.category as keyof typeof tp.categories] ?? p.category}
                        {p.stage && ` · ${tp.stages[p.stage as keyof typeof tp.stages] ?? p.stage}`}
                      </p>
                      <p className="mt-1 text-sm">
                        {p.distance ? <>{distanceText(p.distance.meters, intlLocale)} <span className="text-ink-muted">({p.distance.basis === "computed" ? tp.computed : tp.recorded})</span></> : <span className="text-ink-muted">{tp.noDistance}</span>}
                      </p>
                      {p.expectedDate && <p className="text-sm text-saffron">{format(tp.expected, { date: calendarDay(p.expectedDate, intlLocale) })}</p>}
                      {p.developerName && <p className="text-sm">{format(tp.developer, { name: p.developerName })}</p>}
                      {p.description && <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">{p.description}</p>}
                      <p className="mt-2 text-xs text-ink-muted">
                        {tp.source}: {t.sources[p.sourceKind as keyof typeof t.sources] ?? p.sourceKind}{p.sourceReference ? `: ${p.sourceReference}` : ` (${tp.noSource})`} · {format(t.updatedBy, { when: when(p.updatedAt), by: p.updatedByName ? format(t.by, { name: p.updatedByName }) : "" })}
                      </p>
                      {(canManage || canVerify) && (
                        <div className="mt-3 flex flex-wrap items-start gap-3">
                          {canVerify && p.verification !== "verified" && (
                            <ActionForm action={verifyPlaceAction} layout="inline" variant="quiet" submitLabel={tp.verify} pendingLabel={tp.verifying}><Hidden values={{ ...hidden, placeId: p.id }} /></ActionForm>
                          )}
                          {canManage && (
                            <>
                              <details className="w-full rounded-control border border-line">
                                <summary className="cursor-pointer px-3 py-2 text-sm text-gulf-strong">{tp.edit}</summary>
                                <div className="border-t border-line p-3">
                                  <ActionForm action={updatePlaceAction} submitLabel={tp.save} pendingLabel={tp.saving}><Hidden values={{ ...hidden, placeId: p.id }} /><PlaceFields dict={dict} p={p} /></ActionForm>
                                </div>
                              </details>
                              <ConfirmAction action={archivePlaceAction} trigger={tp.archive} hint={tp.archiveHint} confirmLabel={tp.archive} pendingLabel={tp.archiving}><Hidden values={{ ...hidden, placeId: p.id }} /></ConfirmAction>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {canManage && (
        <>
          <section id="place-add" aria-labelledby="place-add-title" className="scroll-mt-24 rounded-panel border border-line bg-surface p-5 sm:p-6">
            <h2 id="place-add-title" className="text-lg">{tp.addTitle}</h2>
            <ActionForm action={createPlaceAction} submitLabel={tp.create} pendingLabel={tp.creating} className="mt-5"><Hidden values={hidden} /><PlaceFields dict={dict} /></ActionForm>
          </section>
          <section id="loc-edit" aria-labelledby="loc-edit-title" className="scroll-mt-24 rounded-panel border border-line bg-surface p-5 sm:p-6">
            <h2 id="loc-edit-title" className="text-lg">{t.profile.title}</h2>
            <p className="mt-1 text-sm text-ink-muted">{t.profile.cityMarketNote}</p>
            <ActionForm action={saveLocationAction} submitLabel={t.profile.save} pendingLabel={t.profile.saving} className="mt-5">
              <Hidden values={hidden} />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label={t.profile.address} name="address" maxLength={300} defaultValue={loc?.address ?? ""} className="sm:col-span-2" />
                <Field label={t.profile.area} name="area" maxLength={120} defaultValue={loc?.area ?? ""} />
                <Field label={t.profile.latitude} name="latitude" inputMode="decimal" dir="ltr" defaultValue={loc?.coordinates?.lat ?? ""} hint={t.profile.coordsHint} />
                <Field label={t.profile.longitude} name="longitude" inputMode="decimal" dir="ltr" defaultValue={loc?.coordinates?.lng ?? ""} />
                <label className="block text-sm font-medium">{t.profile.sourceKind}
                  <select name="sourceKind" defaultValue={loc?.sourceKind === "structured_import" ? "structured_import" : "manual_entry"} className={input}>
                    <option value="manual_entry">{t.sources.manual_entry}</option>
                    <option value="structured_import">{t.sources.structured_import}</option>
                  </select>
                </label>
                <Field label={t.profile.sourceReference} name="sourceReference" maxLength={300} defaultValue={loc?.sourceReference ?? ""} hint={t.profile.sourceHint} className="sm:col-span-2 lg:col-span-3" />
              </div>
            </ActionForm>
          </section>
          <section aria-labelledby="place-import" className="rounded-panel border border-line bg-surface p-5 sm:p-6">
            <h2 id="place-import" className="text-lg">{t.import.title}</h2>
            <p className="mt-1 max-w-[80ch] text-sm text-ink-muted">{t.import.intro}</p>
            <ActionForm action={importPlacesAction} submitLabel={t.import.submit} pendingLabel={t.import.importing} className="mt-5">
              <Hidden values={hidden} />
              <label className="block text-sm font-medium">{t.import.csv}
                <textarea name="csv" required rows={6} dir="ltr" spellCheck={false} placeholder="kind,category,name,latitude,longitude,distance_km,stage,expected_date,developer,description,source" className={`${input} font-mono`} />
              </label>
              <Field label={t.import.fileSource} name="fileSource" required maxLength={300} />
            </ActionForm>
          </section>
        </>
      )}
    </div>
  );
}
