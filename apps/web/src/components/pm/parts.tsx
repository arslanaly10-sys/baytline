import Link from "next/link";
import {
  LEASE_STATUSES, MANAGEMENT_BASES, OCCUPANCY_STATUSES, PAYMENT_FREQUENCIES, PM_PROPERTY_TYPES, PM_UNIT_TYPES,
  REQUEST_CATEGORIES, REQUEST_PRIORITIES, REQUEST_STATUSES, WORK_ORDER_STATUSES,
  type LeaseStatus, type OccupancyStatus, type RequestPriority, type RequestStatus, type WorkOrderStatus,
} from "@baytline/core";
import type { LeaseDetail, PmUnitRow, PropertyRow, RequestDetail, WorkOrderDetail } from "@baytline/management";
import type { MarketConfig } from "@baytline/platform";
import type { Dictionary } from "@/i18n";
import { marketOptions } from "@/server/markets";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { Field, SelectField } from "@/components/forms/Field";

type D = Dictionary;
const opts = <T extends string>(values: readonly T[], labels: Record<T, string>) => values.map((v) => ({ value: v, label: labels[v] }));

export const occupancyTone = (s: OccupancyStatus): ChipTone =>
  s === "occupied" ? "good" : s === "vacant" ? "neutral" : s === "notice_given" || s === "under_maintenance" ? "attention" : "muted";
export const leaseTone = (s: LeaseStatus): ChipTone => (s === "active" || s === "renewed" ? "good" : s === "draft" ? "muted" : "neutral");
export const requestTone = (s: RequestStatus): ChipTone => (s === "resolved" || s === "closed" ? "muted" : s === "waiting" ? "attention" : "neutral");
export const priorityTone = (p: RequestPriority): ChipTone => (p === "urgent" ? "problem" : p === "high" ? "attention" : "muted");
export const workTone = (s: WorkOrderStatus): ChipTone => (s === "completed" ? "good" : s === "cancelled" || s === "draft" ? "muted" : s === "on_hold" ? "attention" : "neutral");

export function Panel({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  const hid = id ?? title.replace(/\W+/g, "-").toLowerCase();
  return (
    <section aria-labelledby={hid} className="rounded-panel border border-line bg-surface p-5 sm:p-6">
      <h2 id={hid} className="text-lg">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-panel border-2 border-dashed border-line px-6 py-10 text-center text-ink-muted">{children}</p>;
}

export function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-sm text-ink-muted">{k}</dt>
          <dd className="mt-0.5">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TextArea({ label, name, defaultValue, rows = 3, maxLength, required }: { label: string; name: string; defaultValue?: string | null; rows?: number; maxLength?: number; required?: boolean }) {
  return (
    <label className="block sm:col-span-2">
      <span className="block text-sm font-medium text-ink">{label}</span>
      <textarea name={name} rows={rows} maxLength={maxLength} required={required} defaultValue={defaultValue ?? ""} className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-base text-ink" />
    </label>
  );
}

export const Hidden = ({ values }: { values: Record<string, string> }) => (
  <>{Object.entries(values).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>
);

export function Back({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="text-sm text-gulf-strong underline underline-offset-4">{label}</Link>;
}

// ---------------------------------------------------------------- field sets

export function PropertyFields({ dict, locale, markets, p }: { dict: D; locale: "en" | "ar"; markets: MarketConfig[]; p?: PropertyRow }) {
  const t = dict.pm.properties.fields;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t.name} name="name" required maxLength={160} defaultValue={p?.name} />
      <SelectField label={t.market} name="market" defaultValue={p?.market ?? markets[0]?.code} options={marketOptions(markets, locale, { enabledOnly: true, current: p?.market })} />
      <Field label={t.city} name="city" required maxLength={80} defaultValue={p?.city} />
      <Field label={t.address} name="address" maxLength={300} defaultValue={p?.address ?? ""} />
      <SelectField label={t.propertyType} name="propertyType" defaultValue={p?.propertyType} options={opts(PM_PROPERTY_TYPES, dict.pm.propertyTypes)} />
      <SelectField label={t.managementBasis} name="managementBasis" defaultValue={p?.managementBasis} options={opts(MANAGEMENT_BASES, dict.pm.bases)} />
      <Field label={t.ownerName} name="ownerName" maxLength={160} defaultValue={p?.ownerName ?? ""} />
      <Field label={t.agreementRef} name="agreementRef" maxLength={120} defaultValue={p?.agreementRef ?? ""} />
      <Field label={t.agreementStart} name="agreementStart" type="date" defaultValue={p?.agreementStart ?? ""} />
      <Field label={t.agreementEnd} name="agreementEnd" type="date" defaultValue={p?.agreementEnd ?? ""} />
      {p && <SelectField label={t.status} name="status" defaultValue={p.status} options={[{ value: "active", label: dict.pm.properties.active }, { value: "archived", label: dict.pm.properties.archived }]} />}
      <TextArea label={t.notes} name="notes" maxLength={2000} defaultValue={p?.notes} />
    </div>
  );
}

/** Full unit form, or occupancy only (other fields carried as hidden values) for leasing staff. */
export function UnitFields({ dict, u, occupancyOnly }: { dict: D; u?: PmUnitRow; occupancyOnly?: boolean }) {
  const t = dict.pm.units.fields;
  const occupancy = <SelectField label={t.occupancy} name="occupancy" defaultValue={u?.occupancy ?? "vacant"} options={opts(OCCUPANCY_STATUSES, dict.pm.occupancy)} />;
  if (occupancyOnly && u) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Hidden values={{ code: u.code, unitType: u.unitType, bedrooms: u.bedrooms?.toString() ?? "", areaSqm: u.areaSqm ?? "", floor: u.floor?.toString() ?? "", notes: u.notes ?? "" }} />
        {occupancy}
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label={t.code} name="code" required maxLength={40} defaultValue={u?.code} />
      <SelectField label={t.unitType} name="unitType" defaultValue={u?.unitType} options={opts(PM_UNIT_TYPES, dict.pm.unitTypes)} />
      {occupancy}
      <Field label={t.bedrooms} name="bedrooms" type="number" min={0} max={20} defaultValue={u?.bedrooms ?? ""} />
      <Field label={t.areaSqm} name="areaSqm" inputMode="decimal" defaultValue={u?.areaSqm ?? ""} />
      <Field label={t.floor} name="floor" type="number" min={-5} max={200} defaultValue={u?.floor ?? ""} />
      <TextArea label={t.notes} name="notes" maxLength={1000} defaultValue={u?.notes} rows={2} />
    </div>
  );
}

export function LeaseFields({ dict, l }: { dict: D; l?: LeaseDetail }) {
  const t = dict.pm.leases.fields;
  const minor = (v: string | null | undefined) => v ?? "";
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <SelectField label={t.status} name="status" defaultValue={l?.status ?? "active"} options={opts(LEASE_STATUSES, dict.pm.leaseStatuses)} />
      <Field label={t.reference} name="reference" maxLength={120} defaultValue={l?.reference ?? ""} />
      <SelectField label={t.paymentFrequency} name="paymentFrequency" defaultValue={l?.paymentFrequency ?? ""} options={[{ value: "", label: "—" }, ...opts(PAYMENT_FREQUENCIES, dict.pm.frequencies)]} />
      <Field label={t.startDate} name="startDate" type="date" required defaultValue={l?.startDate} />
      <Field label={t.endDate} name="endDate" type="date" required defaultValue={l?.endDate} />
      <Field label={t.renewalDate} name="renewalDate" type="date" defaultValue={l?.renewalDate ?? ""} />
      <Field label={t.rent} name="rent" inputMode="decimal" defaultValue={l ? minorToInput(minor(l.rentMinor), l.currency) : ""} hint={l?.currency} />
      <Field label={t.deposit} name="deposit" inputMode="decimal" defaultValue={l ? minorToInput(minor(l.depositMinor), l.currency) : ""} />
      {l && <input type="hidden" name="currency" value={l.currency} />}
      <TextArea label={t.paymentTerms} name="paymentTerms" maxLength={500} defaultValue={l?.paymentTerms} rows={2} />
      <TextArea label={t.notes} name="notes" maxLength={2000} defaultValue={l?.notes} rows={2} />
    </div>
  );
}

/** Minor units back to the decimal text a person typed (2 decimals for most Gulf currencies, 3 for KWD, BHD, OMR). */
export function minorToInput(minor: string, currency: string): string {
  if (!minor) return "";
  const digits = ["KWD", "BHD", "OMR"].includes(currency) ? 3 : 2;
  const s = minor.padStart(digits + 1, "0");
  const whole = s.slice(0, -digits), frac = s.slice(-digits).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

export function RequestFields({ dict, r, staff, withStatus }: { dict: D; r?: RequestDetail; staff: { id: string; name: string }[]; withStatus?: boolean }) {
  const t = dict.pm.requests.fields;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label={t.title} name="title" required maxLength={160} defaultValue={r?.title} className="sm:col-span-2 lg:col-span-3" />
      <SelectField label={t.category} name="category" defaultValue={r?.category ?? "other"} options={opts(REQUEST_CATEGORIES, dict.pm.categories)} />
      <SelectField label={t.priority} name="priority" defaultValue={r?.priority ?? "normal"} options={opts(REQUEST_PRIORITIES, dict.pm.priorities)} />
      {withStatus && <SelectField label={t.status} name="status" defaultValue={r?.status} options={opts(REQUEST_STATUSES, dict.pm.requestStatuses)} />}
      <SelectField label={t.assignee} name="assigneeId" defaultValue={r?.assigneeId ?? ""} options={[{ value: "", label: dict.pm.unassigned }, ...staff.map((s) => ({ value: s.id, label: s.name }))]} />
      <TextArea label={t.description} name="description" maxLength={4000} defaultValue={r?.description} />
    </div>
  );
}

export function WorkFields({ dict, w, staff }: { dict: D; w?: WorkOrderDetail; staff: { id: string; name: string }[] }) {
  const t = dict.pm.work.fields;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label={t.title} name="title" required maxLength={160} defaultValue={w?.title} className="sm:col-span-2 lg:col-span-3" />
      <SelectField label={t.status} name="status" defaultValue={w?.status ?? "draft"} options={opts(WORK_ORDER_STATUSES.filter((s) => s !== "completed"), dict.pm.workStatuses)} />
      <Field label={t.scheduledFor} name="scheduledFor" type="date" defaultValue={w?.scheduledFor ?? ""} />
      <SelectField label={t.assignee} name="assigneeId" defaultValue={w?.assigneeId ?? ""} options={[{ value: "", label: dict.pm.unassigned }, ...staff.map((s) => ({ value: s.id, label: s.name }))]} />
      <Field label={t.vendorName} name="vendorName" maxLength={160} defaultValue={w?.vendorName ?? ""} />
      <TextArea label={t.description} name="description" maxLength={4000} defaultValue={w?.description} />
    </div>
  );
}

export function StatusChip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  return <Chip tone={tone}>{children}</Chip>;
}
