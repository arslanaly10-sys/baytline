import { createHash } from "node:crypto";
import {
  BINDING_UNIT_STATUSES,
  IMPORT_FIELDS,
  MILESTONE_TRIGGERS,
  PROJECT_STATUSES,
  PROPERTY_TYPES,
  UNIT_STATUSES,
  type ImportRecordType,
  type UnitStatus,
} from "@baytline/core";
import { fields } from "@baytline/identity";

/**
 * Import validation, as a pure function of (rows, mapping, current records). It never writes. The same
 * function runs for the preview and again inside the apply transaction; apply refuses if the two differ.
 */
export type RowAction = "create" | "update" | "unchanged" | "error" | "duplicate" | "conflict";
export type FieldChange = { field: string; from: unknown; to: unknown };
export type RowIssue = { field: string; code: string; rows?: number[] };

export type ValidatedRow = {
  rowNo: number; // 1-based data row (the header is row 0)
  action: RowAction;
  targetType: "unit" | "project" | "price" | "payment_plan" | null;
  targetId: string | null;
  targetLabel: string | null;
  changes: FieldChange[];
  errors: RowIssue[];
  warnings: RowIssue[];
  /** Normalized values for apply. Not stored. */
  values: Record<string, unknown>;
  groupKey?: string;
};

export type UnitSnapshot = {
  id: string; projectId: string; code: string; version: number; propertyType: string; bedrooms: number | null; areaSqm: string | null;
  floor: number | null; status: UnitStatus; phaseId: string | null; lastUpdatedAt: Date; sourceId: string | null; isSample: boolean;
};
export type ProjectSnapshot = {
  id: string; name: string; currency: string; status: string; launchDate: string | null; handoverDate: string | null; location: string | null;
  updatedAt: Date | null; lastSourceId: string | null; inSource: boolean;
};
export type ValidationContext = {
  recordType: ImportRecordType;
  asOf: Date;
  sourceId: string;
  /** Partner sources may only change the status of existing units. */
  partnerOnly: boolean;
  /** Partner batches are for one project, fixed at submission. */
  fixedProjectId: string | null;
  projects: ProjectSnapshot[];
  units: UnitSnapshot[];
  phases: { id: string; projectId: string; name: string }[];
  priceLists: { id: string; projectId: string; name: string; currency: string; openVersion: boolean; current: Record<string, string> }[];
  plans: { id: string; projectId: string; name: string; openVersion: boolean }[];
  /** Prices need an effective date for the draft version. */
  effectiveFrom: string | null;
};

const lc = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function cell(row: string[], mapping: Record<string, number | null>, key: string): string {
  const i = mapping[key];
  return i == null || i < 0 ? "" : (row[i] ?? "").trim();
}

/** Runs a field validator from @baytline/identity and turns its error into a row issue. */
function tryField<T>(errors: RowIssue[], field: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    errors.push({ field, code: "invalid" });
    return undefined;
  }
}

function sameNumber(a: unknown, b: unknown) {
  return a == null || b == null ? a == null && b == null : Number(a) === Number(b);
}

export function validateRows(rows: string[][], mapping: Record<string, number | null>, ctx: ValidationContext): ValidatedRow[] {
  const projectsById = new Map(ctx.projects.map((p) => [p.id, p]));
  const projectsByName = new Map(ctx.projects.map((p) => [lc(p.name), p]));

  const out: ValidatedRow[] = rows.map((row, i) => {
    const r: ValidatedRow = { rowNo: i + 1, action: "error", targetType: null, targetId: null, targetLabel: null, changes: [], errors: [], warnings: [], values: {} };
    const get = (k: string) => cell(row, mapping, k);
    for (const f of IMPORT_FIELDS[ctx.recordType]) {
      if (f.required && f.key !== "project" && !get(f.key)) r.errors.push({ field: f.key, code: "required" });
    }
    // Project: fixed for partner batches, otherwise by name (or id).
    let project: ProjectSnapshot | undefined;
    if (ctx.fixedProjectId) project = projectsById.get(ctx.fixedProjectId);
    else {
      const name = get("project");
      if (!name) r.errors.push({ field: "project", code: "required" });
      else project = projectsByName.get(lc(name)) ?? projectsById.get(name);
      if (name && !project) r.errors.push({ field: "project", code: "not_found" });
    }
    if (project && !project.inSource) r.errors.push({ field: "project", code: "not_in_source" });
    if (r.errors.length || !project) return r;
    r.values.projectId = project.id;
    switch (ctx.recordType) {
      case "units": return unitRow(r, get, project, ctx);
      case "projects": return projectRow(r, get, project, ctx);
      case "prices": return priceRow(r, get, project, ctx);
      case "payment_plans": return planRow(r, get, project, ctx);
    }
  });

  markDuplicates(out, ctx.recordType);
  if (ctx.recordType === "payment_plans") checkPlanGroups(out);
  // One issue per field: the first one found is the one to fix.
  for (const r of out) r.errors = r.errors.filter((e, i) => r.errors.findIndex((x) => x.field === e.field) === i);
  return out;
}

// ---------------------------------------------------------------- units

function unitRow(r: ValidatedRow, get: (k: string) => string, project: ProjectSnapshot, ctx: ValidationContext): ValidatedRow {
  const code = get("code");
  if (code.length > 40) r.errors.push({ field: "code", code: "invalid" });
  const existing = ctx.units.find((u) => u.projectId === project.id && lc(u.code) === lc(code));
  r.targetType = "unit";
  r.targetLabel = `${project.name} · ${code}`;
  r.groupKey = `${project.id}|${lc(code)}`;

  const v: Record<string, unknown> = {};
  const status = get("status") ? tryField(r.errors, "status", () => fields.oneOf(get("status").toLowerCase(), UNIT_STATUSES, "status")) : undefined;
  if (status !== undefined) v.status = status;
  if (!ctx.partnerOnly) {
    const pt = get("property_type");
    if (pt) { const x = tryField(r.errors, "property_type", () => fields.oneOf(pt.toLowerCase(), PROPERTY_TYPES, "property_type")); if (x) v.property_type = x; }
    const beds = get("bedrooms");
    if (beds) { const x = tryField(r.errors, "bedrooms", () => fields.optInt(beds.toLowerCase() === "studio" ? "0" : beds, 0, 20, "bedrooms")); if (x !== undefined) v.bedrooms = x; }
    const area = get("area_sqm");
    if (area) { const x = tryField(r.errors, "area_sqm", () => fields.optDecimal(area.replace(/,/g, ""), "area_sqm", { max: 99_999_999, places: 2 })); if (x !== undefined) v.area_sqm = x; }
    const floor = get("floor");
    if (floor) { const x = tryField(r.errors, "floor", () => fields.optInt(floor, -5, 200, "floor")); if (x !== undefined) v.floor = x; }
    const phase = get("phase");
    if (phase) {
      const ph = ctx.phases.find((p) => p.projectId === project.id && lc(p.name) === lc(phase));
      if (!ph) r.errors.push({ field: "phase", code: "not_found" });
      else v.phase_id = ph.id;
    }
  }
  r.values = { ...r.values, code, ...v };

  if (!existing) {
    if (ctx.partnerOnly) r.errors.push({ field: "code", code: "partner_cannot_create" });
    if (!v.property_type && !r.errors.some((e) => e.field === "property_type")) r.errors.push({ field: "property_type", code: "required_for_new" });
    if (!v.status && !r.errors.some((e) => e.field === "status")) r.errors.push({ field: "status", code: "required_for_new" });
    if (r.errors.length) return r;
    r.action = "create";
    r.changes = Object.entries({ code, ...v }).map(([field, to]) => ({ field, from: null, to }));
    if (v.status && BINDING_UNIT_STATUSES.includes(v.status as UnitStatus)) r.warnings.push({ field: "status", code: "needs_hold_approval" });
    return r;
  }

  r.targetId = existing.id;
  r.values.version = existing.version;
  if (r.errors.length) return r;
  const prev: Record<string, unknown> = { status: existing.status, property_type: existing.propertyType, bedrooms: existing.bedrooms, area_sqm: existing.areaSqm, floor: existing.floor, phase_id: existing.phaseId };
  for (const [field, to] of Object.entries(v)) {
    const from = prev[field] ?? null;
    const same = field === "area_sqm" || field === "bedrooms" || field === "floor" ? sameNumber(from, to) : String(from ?? "") === String(to ?? "");
    if (!same) r.changes.push({ field, from, to });
  }
  const statusChange = r.changes.find((c) => c.field === "status");
  if (statusChange && (BINDING_UNIT_STATUSES.includes(statusChange.from as UnitStatus) || BINDING_UNIT_STATUSES.includes(statusChange.to as UnitStatus))) {
    r.warnings.push({ field: "status", code: "needs_hold_approval" });
  }
  if (existing.isSample) r.warnings.push({ field: "code", code: "sample_record" });
  if (!r.changes.length) { r.action = "unchanged"; return r; }
  // Someone else changed this record after the data being imported was true.
  if (existing.lastUpdatedAt > ctx.asOf && existing.sourceId !== ctx.sourceId) {
    r.action = "conflict";
    r.warnings.push({ field: "code", code: "changed_after_as_of" });
    return r;
  }
  r.action = "update";
  return r;
}

// ---------------------------------------------------------------- projects

function projectRow(r: ValidatedRow, get: (k: string) => string, project: ProjectSnapshot, ctx: ValidationContext): ValidatedRow {
  r.targetType = "project";
  r.targetId = project.id;
  r.targetLabel = project.name;
  r.groupKey = project.id;
  const v: Record<string, unknown> = {};
  if (get("status")) { const x = tryField(r.errors, "status", () => fields.oneOf(get("status").toLowerCase().replace(/ /g, "_"), PROJECT_STATUSES, "status")); if (x) v.status = x; }
  if (get("launch_date")) { const x = tryField(r.errors, "launch_date", () => fields.optDate(get("launch_date"), "launch_date")); if (x) v.launch_date = x; }
  if (get("handover_date")) { const x = tryField(r.errors, "handover_date", () => fields.optDate(get("handover_date"), "handover_date")); if (x) v.handover_date = x; }
  if (get("location")) { const x = tryField(r.errors, "location", () => fields.opt(get("location"), 200, "location")); if (x) v.location = x; }
  const launch = (v.launch_date as string | undefined) ?? project.launchDate;
  const handover = (v.handover_date as string | undefined) ?? project.handoverDate;
  if (launch && handover && handover < launch) r.errors.push({ field: "handover_date", code: "before_launch" });
  r.values = { ...r.values, ...v };
  if (r.errors.length) return r;
  const prev: Record<string, unknown> = { status: project.status, launch_date: project.launchDate, handover_date: project.handoverDate, location: project.location };
  r.changes = Object.entries(v).filter(([k, to]) => String(prev[k] ?? "") !== String(to)).map(([field, to]) => ({ field, from: prev[field] ?? null, to }));
  if (!r.changes.length) { r.action = "unchanged"; return r; }
  if (project.updatedAt && project.updatedAt > ctx.asOf && project.lastSourceId !== ctx.sourceId) {
    r.action = "conflict";
    r.warnings.push({ field: "project", code: "changed_after_as_of" });
    return r;
  }
  r.action = "update";
  return r;
}

// ---------------------------------------------------------------- prices (always land in a draft version)

function priceRow(r: ValidatedRow, get: (k: string) => string, project: ProjectSnapshot, ctx: ValidationContext): ValidatedRow {
  const code = get("code");
  const listName = get("price_list");
  r.targetType = "price";
  r.targetLabel = `${project.name} · ${listName} · ${code}`;
  r.groupKey = `${project.id}|${lc(listName)}|${lc(code)}`;
  if (!ctx.effectiveFrom) r.errors.push({ field: "effective_from", code: "required" });
  if (listName.length > 120) r.errors.push({ field: "price_list", code: "invalid" });
  const unit = ctx.units.find((u) => u.projectId === project.id && lc(u.code) === lc(code));
  if (!unit) r.errors.push({ field: "code", code: "not_found" });
  const list = ctx.priceLists.find((l) => l.projectId === project.id && lc(l.name) === lc(listName));
  const rowCurrency = get("currency") ? tryField(r.errors, "currency", () => fields.currency(get("currency"))) : undefined;
  const cur = list?.currency ?? rowCurrency ?? project.currency;
  if (list && rowCurrency && rowCurrency !== list.currency) r.errors.push({ field: "currency", code: "currency_mismatch" });
  if (list?.openVersion) r.errors.push({ field: "price_list", code: "open_version" });
  const minor = get("price") ? tryField(r.errors, "price", () => fields.parseMoney(get("price"), cur, "price")) : undefined;
  if (r.errors.length || !unit || minor == null) return r;
  r.targetId = unit.id;
  r.values = { ...r.values, unitId: unit.id, listId: list?.id ?? null, listName, currency: cur, minor: minor.toString() };
  const current = list?.current[unit.id] ?? null;
  if (current === minor.toString()) { r.action = "unchanged"; return r; }
  r.action = current ? "update" : "create";
  r.changes = [{ field: "price", from: current, to: minor.toString() }];
  r.warnings.push({ field: "price", code: "draft_needs_approval" });
  if (!list) r.warnings.push({ field: "price_list", code: "new_list" });
  return r;
}

// ---------------------------------------------------------------- payment plans (always a new draft version)

function planRow(r: ValidatedRow, get: (k: string) => string, project: ProjectSnapshot, ctx: ValidationContext): ValidatedRow {
  const name = get("plan");
  r.targetType = "payment_plan";
  r.targetLabel = `${project.name} · ${name} · ${get("seq")}`;
  const plan = ctx.plans.find((p) => p.projectId === project.id && lc(p.name) === lc(name));
  if (plan?.openVersion) r.errors.push({ field: "plan", code: "open_version" });
  if (name.length > 120) r.errors.push({ field: "plan", code: "invalid" });
  const cur = tryField(r.errors, "currency", () => fields.currency(get("currency")));
  const from = tryField(r.errors, "effective_from", () => fields.reqDate(get("effective_from"), "effective_from"));
  const seq = tryField(r.errors, "seq", () => fields.optInt(get("seq"), 1, 60, "seq"));
  const label = tryField(r.errors, "label", () => fields.req(get("label"), 120, "label"));
  const trigger = tryField(r.errors, "trigger", () => fields.oneOf(get("trigger").toLowerCase().replace(/ /g, "_"), MILESTONE_TRIGGERS, "trigger"));
  const percent = get("percent") ? tryField(r.errors, "percent", () => fields.optDecimal(get("percent").replace(/%$/, ""), "percent", { max: 100, places: 2 })) : null;
  const amount = get("amount") && cur ? tryField(r.errors, "amount", () => fields.parseMoney(get("amount"), cur, "amount")) : null;
  if (!r.errors.some((e) => e.field === "percent" || e.field === "amount") && (percent == null) === (amount == null)) r.errors.push({ field: "percent", code: "percent_or_amount" });
  let dueDate: string | null = null, progress: string | null = null, months: number | null = null;
  if (trigger === "on_date") dueDate = tryField(r.errors, "due_date", () => fields.reqDate(get("due_date"), "due_date")) ?? null;
  if (trigger === "construction_progress") {
    progress = tryField(r.errors, "progress_percent", () => fields.optDecimal(get("progress_percent").replace(/%$/, ""), "progress_percent", { max: 100, places: 2 })) ?? null;
    if (!progress && !r.errors.some((e) => e.field === "progress_percent")) r.errors.push({ field: "progress_percent", code: "required" });
  }
  if (trigger === "after_handover") {
    months = tryField(r.errors, "months_after_handover", () => fields.optInt(get("months_after_handover"), 1, 120, "months_after_handover")) ?? null;
    if (!months && !r.errors.some((e) => e.field === "months_after_handover")) r.errors.push({ field: "months_after_handover", code: "required" });
  }
  r.groupKey = `${project.id}|${lc(name)}|${seq ?? "?"}`;
  r.values = { ...r.values, planId: plan?.id ?? null, planName: name, currency: cur, effectiveFrom: from, seq, label, trigger, dueDate, progress, months, percent, amount: amount?.toString() ?? null };
  if (r.errors.length) return r;
  r.action = "create";
  r.changes = [{ field: "milestone", from: null, to: { seq, label, trigger, percent, amount: amount?.toString() ?? null } }];
  r.warnings.push({ field: "plan", code: "draft_needs_approval" });
  if (!plan) r.warnings.push({ field: "plan", code: "new_plan" });
  return r;
}

/** All milestones of one plan go into one draft; if any of them fails, none of them apply. */
function checkPlanGroups(rows: ValidatedRow[]) {
  const groups = new Map<string, ValidatedRow[]>();
  for (const r of rows) {
    if (!r.values.projectId || !r.values.planName) continue;
    const k = `${r.values.projectId}|${lc(String(r.values.planName))}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const g of groups.values()) {
    const ok = g.filter((r) => r.action === "create");
    const pct = ok.reduce((s, r) => s + (r.values.percent ? Math.round(Number(r.values.percent) * 100) : 0), 0);
    const mixed = new Set(ok.map((r) => `${r.values.currency}|${r.values.effectiveFrom}`)).size > 1;
    const problem = pct > 10000 ? "percent_over_100" : mixed ? "mixed_terms" : ok.length < g.length ? "other_rows_failed" : null;
    if (!problem) continue;
    for (const r of ok) {
      r.action = "error";
      r.changes = [];
      r.errors.push({ field: "plan", code: problem, rows: g.filter((x) => x !== r).map((x) => x.rowNo) });
    }
  }
}

/** The same record twice in one file is ambiguous: neither row applies. */
function markDuplicates(rows: ValidatedRow[], recordType: ImportRecordType) {
  const seen = new Map<string, ValidatedRow[]>();
  for (const r of rows) {
    if (!r.groupKey || (recordType === "payment_plans" && r.groupKey.endsWith("|?"))) continue;
    seen.set(r.groupKey, [...(seen.get(r.groupKey) ?? []), r]);
  }
  for (const group of seen.values()) {
    if (group.length < 2) continue;
    for (const r of group) {
      r.action = "duplicate";
      r.changes = [];
      r.errors.push({ field: recordType === "projects" ? "project" : recordType === "payment_plans" ? "seq" : "code", code: "duplicate", rows: group.filter((x) => x !== r).map((x) => x.rowNo) });
    }
  }
}

export function summarize(rows: ValidatedRow[]): Record<RowAction, number> {
  const s: Record<RowAction, number> = { create: 0, update: 0, unchanged: 0, error: 0, duplicate: 0, conflict: 0 };
  for (const r of rows) s[r.action]++;
  return s;
}

/** Fingerprint of what the person reviewed. Apply recomputes it and refuses on any difference. */
export function previewHash(rows: ValidatedRow[]): string {
  const h = createHash("sha256");
  for (const r of rows) h.update(JSON.stringify([r.rowNo, r.action, r.targetId, r.values.version ?? null, r.changes, r.errors]));
  return h.digest("hex");
}
