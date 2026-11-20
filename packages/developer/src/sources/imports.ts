import {
  IMPORT_FIELDS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  IMPORT_RECORD_TYPES,
  SOURCE_KIND_FOR,
  suggestMapping,
  type ImportRecordType,
  type SourceType,
} from "@baytline/core";
import { withAppTx, type Client, type Db } from "@baytline/db";
import type { Actor, OrgContext } from "@baytline/identity";
import { audit, can, IdentityError, requireDeveloper } from "../guard";
import { parseCsv } from "../location";
import { id, oneOf, opt, optDate } from "../validation";
import { nextVersionNumber } from "../versions";
import { previewHash, summarize, validateRows, type RowAction, type ValidatedRow, type ValidationContext } from "./validate";

export type BatchStatus = "submitted" | "uploaded" | "validated" | "applied" | "cancelled";

// ---------------------------------------------------------------- upload

/** Source types that accept file uploads in the workspace. */
const UPLOAD_TYPES: readonly SourceType[] = ["file_import"];

export type UploadInput = { sourceId: unknown; recordType: unknown; csv: unknown; fileName?: unknown; asOf: unknown; effectiveFrom?: unknown; note?: unknown };

function parseAsOf(v: unknown, now: Date): Date {
  const s = typeof v === "string" ? v.trim() : "";
  const d = s ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s) : null;
  if (!d || Number.isNaN(d.getTime())) throw new IdentityError("invalid_input", "as_of");
  if (d.getTime() > now.getTime() + 5 * 60_000) throw new IdentityError("invalid_input", "as_of_future");
  if (now.getTime() - d.getTime() > 366 * 864e5) throw new IdentityError("invalid_input", "as_of_too_old");
  return d;
}

function readTable(csv: unknown): { headers: string[]; rows: string[][] } {
  const text = typeof csv === "string" ? csv.replace(/^﻿/, "") : "";
  if (!text.trim()) throw new IdentityError("invalid_input", "file_empty");
  if (Buffer.byteLength(text, "utf8") > IMPORT_MAX_BYTES) throw new IdentityError("invalid_input", "file_too_large");
  const table = parseCsv(text);
  if (table.length < 2) throw new IdentityError("invalid_input", "file_empty");
  const headers = table[0]!.map((h) => h.trim().slice(0, 80));
  if (headers.some((h) => !h) || new Set(headers.map((h) => h.toLowerCase())).size !== headers.length) throw new IdentityError("invalid_input", "file_headers");
  const rows = table.slice(1);
  if (rows.length > IMPORT_MAX_ROWS) throw new IdentityError("invalid_input", "file_too_many_rows");
  return { headers, rows: rows.map((r) => headers.map((_, i) => (r[i] ?? "").slice(0, 500))) };
}

async function loadSource(c: Client, sourceId: string) {
  const { rows } = await c.query("select * from app.inventory_sources where id = $1 and org_id = app.current_org_id()", [sourceId]);
  if (!rows[0]) throw new IdentityError("not_found");
  return rows[0];
}

/** Stores the file as an unvalidated batch, with a suggested column mapping. Nothing else changes. */
export async function uploadImport(db: Db, actor: Actor, input: UploadInput, now = new Date()): Promise<string> {
  const sid = id(input.sourceId);
  const recordType = oneOf(input.recordType, IMPORT_RECORD_TYPES, "record_type");
  const asOf = parseAsOf(input.asOf, now);
  const effectiveFrom = optDate(input.effectiveFrom, "effective_from");
  const fileName = opt(input.fileName, 200, "file_name");
  const note = opt(input.note, 500, "note", true);
  const { headers, rows } = readTable(input.csv);
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "inventory.import");
    const s = await loadSource(c, sid);
    if (!UPLOAD_TYPES.includes(s.source_type)) throw new IdentityError("invalid_input", "source_type");
    if (s.authorization_status !== "authorized") throw new IdentityError("invalid_input", "source_not_authorized");
    const { rows: ins } = await c.query<{ id: string }>(
      `insert into app.import_batches (org_id, source_id, record_type, status, file_name, headers, raw_rows, row_count, mapping, options, as_of, note, created_by)
       values (app.current_org_id(), $1, $2, 'uploaded', $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [sid, recordType, fileName, headers, JSON.stringify(rows), rows.length, JSON.stringify(suggestMapping(recordType, headers)),
        JSON.stringify({ effective_from: effectiveFrom }), asOf, note, actor.userId],
    );
    const bid = ins[0]!.id;
    await audit(c, actor, { type: "import.uploaded", target: { type: "import_batch", id: bid }, metadata: { rows: String(rows.length), record_type: recordType } });
    return bid;
  });
}

/** Feeds: stage what the adapter returned, with the suggested mapping, and validate it straight away. */
export async function stageFeedBatch(
  c: Client,
  actor: Actor,
  input: { sourceId: string; recordType: ImportRecordType; headers: string[]; rows: string[][]; asOf: Date; fileName: string; options: Record<string, unknown> },
): Promise<string> {
  const headers = input.headers.map((h) => h.trim().slice(0, 80));
  const rows = input.rows.map((r) => headers.map((_, i) => (r[i] ?? "").slice(0, 500)));
  const { rows: ins } = await c.query<{ id: string }>(
    `insert into app.import_batches (org_id, source_id, record_type, status, file_name, headers, raw_rows, row_count, mapping, options, as_of, created_by)
     values (app.current_org_id(), $1, $2, 'uploaded', $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [input.sourceId, input.recordType, input.fileName, headers, JSON.stringify(rows), rows.length, JSON.stringify(suggestMapping(input.recordType, headers)),
      JSON.stringify(input.options), input.asOf, actor.userId],
  );
  const bid = ins[0]!.id;
  await validateInTx(c, actor, bid);
  return bid;
}

// ---------------------------------------------------------------- validation

async function loadBatch(c: Client, batchId: string, lock = false) {
  const { rows } = await c.query(`select * from app.import_batches where id = $1 and org_id = app.current_org_id() ${lock ? "for update" : ""}`, [batchId]);
  if (!rows[0]) throw new IdentityError("not_found");
  return rows[0];
}

async function buildContext(c: Client, batch: Record<string, any>, source: Record<string, any>): Promise<ValidationContext> {
  const { rows: projects } = await c.query(
    `select p.id, p.name, mk.currency, p.status, p.launch_date::text as launch_date, p.handover_date::text as handover_date, p.location, p.updated_at,
            (select pc.source_id from app.project_changes pc where pc.project_id = p.id order by pc.id desc limit 1) as last_source_id,
            ($2 or exists (select 1 from app.inventory_source_projects sp where sp.source_id = $1 and sp.project_id = p.id)) as in_source
       from app.projects p join app.markets mk on mk.code = p.market where p.org_id = app.current_org_id()`,
    [source.id, source.all_projects],
  );
  const { rows: units } = await c.query(
    `select id, project_id, code, version, property_type, bedrooms, area_sqm::text as area_sqm, floor, status, phase_id, last_updated_at, source_id, is_sample
       from app.units where org_id = app.current_org_id()`,
  );
  const { rows: phases } = await c.query("select id, project_id, name from app.project_phases where org_id = app.current_org_id()");
  const { rows: lists } = await c.query(
    `select l.id, l.project_id, l.name, l.currency,
            exists (select 1 from app.price_list_versions v where v.price_list_id = l.id and v.status in ('draft','submitted')) as open_version,
            coalesce((select json_object_agg(e.unit_id, e.price_minor::text) from app.price_list_entries e
                       where e.version_id = (select v.id from app.price_list_versions v where v.price_list_id = l.id and v.status = 'approved'
                                              order by v.effective_from desc, v.decided_at desc limit 1)), '{}') as current
       from app.price_lists l where l.org_id = app.current_org_id()`,
  );
  const { rows: plans } = await c.query(
    `select p.id, p.project_id, p.name,
            exists (select 1 from app.payment_plan_versions v where v.plan_id = p.id and v.status in ('draft','submitted')) as open_version
       from app.payment_plans p where p.org_id = app.current_org_id()`,
  );
  return {
    recordType: batch.record_type,
    asOf: batch.as_of,
    sourceId: source.id,
    partnerOnly: source.source_type === "partner",
    fixedProjectId: batch.options?.project_id ?? null,
    projects: projects.map((p) => ({
      id: p.id, name: p.name, currency: p.currency, status: p.status, launchDate: p.launch_date, handoverDate: p.handover_date, location: p.location,
      updatedAt: p.updated_at, lastSourceId: p.last_source_id, inSource: p.in_source,
    })),
    units: units.map((u) => ({
      id: u.id, projectId: u.project_id, code: u.code, version: u.version, propertyType: u.property_type, bedrooms: u.bedrooms, areaSqm: u.area_sqm,
      floor: u.floor, status: u.status, phaseId: u.phase_id, lastUpdatedAt: u.last_updated_at, sourceId: u.source_id, isSample: u.is_sample,
    })),
    phases: phases.map((p) => ({ id: p.id, projectId: p.project_id, name: p.name })),
    priceLists: lists.map((l) => ({ id: l.id, projectId: l.project_id, name: l.name, currency: l.currency, openVersion: l.open_version, current: l.current })),
    plans: plans.map((p) => ({ id: p.id, projectId: p.project_id, name: p.name, openVersion: p.open_version })),
    effectiveFrom: batch.options?.effective_from ?? null,
  };
}

function checkMapping(recordType: ImportRecordType, headers: string[], input: Record<string, unknown>, fixedProject: boolean): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  const used = new Set<number>();
  for (const f of IMPORT_FIELDS[recordType]) {
    const raw = input[f.key];
    const n = raw === "" || raw == null ? null : Number(raw);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n >= headers.length)) throw new IdentityError("invalid_input", `mapping_${f.key}`);
    if (n !== null && used.has(n)) throw new IdentityError("invalid_input", "mapping_reused");
    if (n !== null) used.add(n);
    if (f.required && n === null && !(f.key === "project" && fixedProject)) throw new IdentityError("invalid_input", `mapping_${f.key}`);
    out[f.key] = n;
  }
  return out;
}

async function validateInTx(c: Client, actor: Actor, batchId: string): Promise<Record<RowAction, number>> {
  const batch = await loadBatch(c, batchId, true);
  const source = await loadSource(c, batch.source_id);
  const ctx = await buildContext(c, batch, source);
  const rows = validateRows(batch.raw_rows, batch.mapping, ctx);
  await c.query("delete from app.import_rows where batch_id = $1", [batchId]);
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    await c.query(
      `insert into app.import_rows (batch_id, org_id, row_no, action, target_type, target_id, target_label, changes, errors, warnings)
       select $1, app.current_org_id(), x.row_no, x.action, x.target_type, x.target_id, x.target_label, x.changes, x.errors, x.warnings
         from jsonb_to_recordset($2::jsonb) as x(row_no int, action text, target_type text, target_id uuid, target_label text, changes jsonb, errors jsonb, warnings jsonb)`,
      [batchId, JSON.stringify(chunk.map((r) => ({ row_no: r.rowNo, action: r.action, target_type: r.targetType, target_id: r.targetId, target_label: r.targetLabel?.slice(0, 300) ?? null, changes: r.changes, errors: r.errors, warnings: r.warnings })))],
    );
  }
  const summary = summarize(rows);
  await c.query(
    "update app.import_batches set status = 'validated', summary = $2, preview_hash = $3, validated_at = now(), validated_by = $4 where id = $1",
    [batchId, JSON.stringify(summary), previewHash(rows), actor.userId],
  );
  await audit(c, actor, { type: "import.validated", target: { type: "import_batch", id: batchId }, metadata: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, String(v)])) });
  return summary;
}

/** Saves the column mapping and validates every row against current records. Changes no inventory. */
export async function mapAndValidate(db: Db, actor: Actor, batchId: string, mapping: Record<string, unknown>, options: { effectiveFrom?: unknown } = {}): Promise<Record<RowAction, number>> {
  const bid = id(batchId);
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "inventory.import");
    const batch = await loadBatch(c, bid, true);
    if (!["submitted", "uploaded", "validated"].includes(batch.status)) throw new IdentityError("invalid_input", "batch_final");
    const fixed = Boolean(batch.options?.project_id);
    const m = checkMapping(batch.record_type, batch.headers, mapping, fixed);
    const opts = { ...batch.options };
    if (batch.record_type === "prices") opts.effective_from = optDate(options.effectiveFrom, "effective_from") ?? opts.effective_from ?? null;
    await c.query("update app.import_batches set mapping = $2, options = $3 where id = $1", [bid, JSON.stringify(m), JSON.stringify(opts)]);
    return validateInTx(c, actor, bid);
  });
}

/** Re-validates with the saved mapping (e.g. after records changed). */
export async function revalidateBatch(db: Db, actor: Actor, batchId: string) {
  const bid = id(batchId);
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "inventory.import");
    const batch = await loadBatch(c, bid, true);
    if (!["submitted", "uploaded", "validated"].includes(batch.status) || !batch.mapping) throw new IdentityError("invalid_input", "batch_final");
    return validateInTx(c, actor, bid);
  });
}

export async function cancelBatch(db: Db, actor: Actor, batchId: string): Promise<void> {
  const bid = id(batchId);
  await withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "inventory.import");
    const batch = await loadBatch(c, bid, true);
    if (["applied", "cancelled"].includes(batch.status)) throw new IdentityError("invalid_input", "batch_final");
    await c.query("update app.import_batches set status = 'cancelled', cancelled_at = now(), cancelled_by = $2 where id = $1", [bid, actor.userId]);
    await audit(c, actor, { type: "import.cancelled", target: { type: "import_batch", id: bid } });
  });
}

// ---------------------------------------------------------------- reading a batch

export type BatchRow = {
  rowNo: number; action: RowAction; targetType: string | null; targetId: string | null; targetLabel: string | null;
  changes: { field: string; from: unknown; to: unknown }[]; errors: { field: string; code: string; rows?: number[] }[]; warnings: { field: string; code: string }[];
  raw: string[];
};

export type BatchDetail = {
  id: string; recordType: ImportRecordType; status: BatchStatus; fileName: string | null; headers: string[]; sample: string[][]; rowCount: number;
  mapping: Record<string, number | null> | null; options: Record<string, any>; asOf: Date; note: string | null; summary: Record<RowAction, number> | null;
  source: { id: string; name: string; type: SourceType; authorization: string; trusted: boolean; partnerName: string | null };
  partnerSubmitted: boolean; createdAt: Date; createdByName: string | null; validatedAt: Date | null; appliedAt: Date | null; appliedByName: string | null;
  conflictPolicy: string | null; confirmedVerified: boolean | null;
  /** Fingerprint of the validated preview; sent back on confirm so apply knows what was reviewed. */
  previewHash: string | null;
  rows: BatchRow[]; filteredCount: number;
  /** What the confirming person needs, and has. */
  needs: { holdApproval: boolean; priceRequest: boolean; planManage: boolean; projectManage: boolean };
  can: { apply: boolean; confirmVerified: boolean; manage: boolean };
  /** Drafts created by applying, for prices and plans. */
  drafts: { kind: "price" | "plan"; id: string; name: string; version: number; status: string; projectId: string }[];
};

export async function getBatch(db: Db, actor: Actor, batchId: string, filter: { action?: string; page?: number } = {}): Promise<BatchDetail> {
  const bid = id(batchId);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireDeveloper(c, actor, "inventory.view");
    const { rows } = await c.query(
      `select b.*, s.name as source_name, s.source_type, s.authorization_status, s.trusted, po.name as partner_name,
              cu.display_name as created_by_name, au.display_name as applied_by_name
         from app.import_batches b join app.inventory_sources s on s.id = b.source_id
         left join app.brokerage_directory() po on po.id = s.partner_org_id
         left join app.users cu on cu.id = b.created_by left join app.users au on au.id = b.applied_by
        where b.id = $1 and b.org_id = app.current_org_id()`,
      [bid],
    );
    const b = rows[0];
    if (!b) throw new IdentityError("not_found");
    const actions = ["create", "update", "unchanged", "error", "duplicate", "conflict"];
    const act = filter.action && actions.includes(filter.action) ? filter.action : null;
    const page = Math.max(1, Math.min(100, Number(filter.page) || 1));
    const { rows: list } = await c.query(
      `select row_no, action, target_type, target_id, target_label, changes, errors, warnings, count(*) over () as total
         from app.import_rows where batch_id = $1 and ($2::text is null or action = $2)
        order by case action when 'error' then 0 when 'duplicate' then 1 when 'conflict' then 2 when 'update' then 3 when 'create' then 4 else 5 end, row_no
        limit 100 offset $3`,
      [bid, act, (page - 1) * 100],
    );
    const { rows: flags } = await c.query<{ hold: boolean }>(
      `select exists (select 1 from app.import_rows where batch_id = $1 and action in ('create','update') and warnings @> '[{"code":"needs_hold_approval"}]') as hold`,
      [bid],
    );
    const { rows: drafts } = await c.query(
      `select 'price' as kind, v.id, l.name, v.version, v.status, l.project_id from app.price_list_versions v join app.price_lists l on l.id = v.price_list_id where v.import_batch_id = $1
       union all
       select 'plan', v.id, p.name, v.version, v.status, p.project_id from app.payment_plan_versions v join app.payment_plans p on p.id = v.plan_id where v.import_batch_id = $1`,
      [bid],
    );
    const needs = {
      holdApproval: Boolean(flags[0]?.hold),
      priceRequest: b.record_type === "prices",
      planManage: b.record_type === "payment_plans",
      projectManage: b.record_type === "projects",
    };
    return {
      id: b.id, recordType: b.record_type, status: b.status, fileName: b.file_name, headers: b.headers, sample: (b.raw_rows as string[][]).slice(0, 3), rowCount: b.row_count,
      mapping: b.mapping ?? suggestMapping(b.record_type, b.headers), options: b.options ?? {}, asOf: b.as_of, note: b.note, summary: b.summary,
      source: { id: b.source_id, name: b.source_name, type: b.source_type, authorization: b.authorization_status, trusted: b.trusted, partnerName: b.partner_name },
      partnerSubmitted: Boolean(b.submitted_by_org), createdAt: b.created_at, createdByName: b.created_by_name, validatedAt: b.validated_at,
      appliedAt: b.applied_at, appliedByName: b.applied_by_name, conflictPolicy: b.conflict_policy, confirmedVerified: b.confirmed_verified,
      previewHash: b.preview_hash,
      rows: list.map((r) => ({
        rowNo: r.row_no, action: r.action, targetType: r.target_type, targetId: r.target_id, targetLabel: r.target_label,
        changes: r.changes, errors: r.errors, warnings: r.warnings, raw: (b.raw_rows as string[][])[r.row_no - 1] ?? [],
      })),
      filteredCount: Number(list[0]?.total ?? 0),
      needs,
      can: {
        manage: can(ctx, "inventory.import"),
        apply: can(ctx, "inventory.import") && (!needs.holdApproval || can(ctx, "unit.hold.approve")) && (!needs.priceRequest || can(ctx, "price.change.request"))
          && (!needs.planManage || can(ctx, "payment_plan.manage")) && (!needs.projectManage || can(ctx, "project.manage")),
        confirmVerified: can(ctx, "inventory.verify") && (b.record_type === "units"),
      },
      drafts: drafts.map((d) => ({ kind: d.kind, id: d.id, name: d.name, version: d.version, status: d.status, projectId: d.project_id })),
    };
  });
}

export type BatchListRow = { id: string; recordType: ImportRecordType; status: BatchStatus; sourceName: string; sourceType: SourceType; rowCount: number; summary: Record<RowAction, number> | null; createdAt: Date; createdByName: string | null; fileName: string | null; partnerSubmitted: boolean };

export async function listBatches(db: Db, actor: Actor, f: { status?: string; sourceId?: string } = {}): Promise<BatchListRow[]> {
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "inventory.view");
    const where = ["b.org_id = app.current_org_id()"];
    const args: unknown[] = [];
    if (f.status === "open") where.push("b.status in ('submitted','uploaded','validated')");
    else if (f.status && ["submitted", "uploaded", "validated", "applied", "cancelled"].includes(f.status)) where.push(`b.status = $${args.push(f.status)}`);
    if (f.sourceId) where.push(`b.source_id = $${args.push(id(f.sourceId))}`);
    const { rows } = await c.query(
      `select b.id, b.record_type, b.status, s.name as source_name, s.source_type, b.row_count, b.summary, b.created_at, u.display_name, b.file_name, b.submitted_by_org
         from app.import_batches b join app.inventory_sources s on s.id = b.source_id left join app.users u on u.id = b.created_by
        where ${where.join(" and ")} order by b.created_at desc limit 100`,
      args,
    );
    return rows.map((r) => ({
      id: r.id, recordType: r.record_type, status: r.status, sourceName: r.source_name, sourceType: r.source_type, rowCount: r.row_count, summary: r.summary,
      createdAt: r.created_at, createdByName: r.display_name, fileName: r.file_name, partnerSubmitted: Boolean(r.submitted_by_org),
    }));
  });
}

// ---------------------------------------------------------------- apply

export type ApplyInput = { previewHash: unknown; conflictPolicy?: unknown; confirmVerified?: unknown };
export type ApplyResult = { applied: number; skipped: number; disputed: number; reconfirmed: number; drafts: number };

/**
 * Applies a validated batch after the person reviewed it. Validation runs again inside this transaction
 * against current records; if the result differs from what was reviewed, nothing is applied and the
 * person is asked to review again. Errors, duplicates and (by default) conflicts are never applied.
 */
export async function applyBatch(db: Db, actor: Actor, batchId: string, input: ApplyInput): Promise<ApplyResult> {
  const bid = id(batchId);
  const policy = input.conflictPolicy === "mark_disputed" ? "mark_disputed" : "skip";
  const confirmVerified = input.confirmVerified === true || input.confirmVerified === "on";
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireDeveloper(c, actor, "inventory.import");
    const batch = await loadBatch(c, bid, true);
    if (batch.status !== "validated") throw new IdentityError("invalid_input", "batch_not_validated");
    const source = await loadSource(c, batch.source_id);
    if (source.authorization_status !== "authorized") throw new IdentityError("invalid_input", "source_not_authorized");
    // Lock the records this batch can touch, then validate again.
    if (batch.record_type === "units") await c.query("select 1 from app.units where org_id = app.current_org_id() for update");
    if (batch.record_type === "projects") await c.query("select 1 from app.projects where org_id = app.current_org_id() for update");
    const rows = validateRows(batch.raw_rows, batch.mapping, await buildContext(c, batch, source));
    if (previewHash(rows) !== batch.preview_hash || input.previewHash !== batch.preview_hash) throw new IdentityError("conflict", "changed_since_preview");

    const sourceKind = SOURCE_KIND_FOR[source.source_type as SourceType];
    // Availability is confirmed only by a trusted, authorized feed/integration, or by a person allowed to verify.
    const verify = batch.record_type === "units" && ((source.trusted && ["data_feed", "direct_integration"].includes(source.source_type)) || confirmVerified);
    if (confirmVerified && !can(ctx, "inventory.verify")) throw new IdentityError("forbidden", "inventory.verify");
    const result: ApplyResult = { applied: 0, skipped: 0, disputed: 0, reconfirmed: 0, drafts: 0 };
    const meta = { sourceId: source.id, batchId: bid, sourceKind, asOf: batch.as_of as Date, verify };

    switch (batch.record_type as ImportRecordType) {
      case "units": await applyUnits(c, actor, ctx, rows, policy, meta, result); break;
      case "projects": await applyProjects(c, actor, ctx, rows, policy, meta, result); break;
      case "prices": await applyPrices(c, actor, ctx, rows, batch, source, result); break;
      case "payment_plans": await applyPlans(c, actor, ctx, rows, source, bid, result); break;
    }

    await c.query(
      "update app.import_batches set status = 'applied', applied_at = now(), applied_by = $2, conflict_policy = $3, confirmed_verified = $4, summary = $5 where id = $1",
      [bid, actor.userId, policy, verify, JSON.stringify({ ...summarize(rows), ...Object.fromEntries(Object.entries(result).map(([k, v]) => [`result_${k}`, v])) })],
    );
    // The source's last successful update is when its data last reached the records.
    await c.query("update app.inventory_sources set last_success_at = now(), last_error = null where id = $1", [source.id]);
    await audit(c, actor, {
      type: "import.applied", target: { type: "import_batch", id: bid },
      metadata: { record_type: batch.record_type, applied: String(result.applied), skipped: String(result.skipped), disputed: String(result.disputed), verified: String(verify) },
    });
    return result;
  });
}

type Meta = { sourceId: string; batchId: string; sourceKind: string; asOf: Date; verify: boolean };

async function logUnit(c: Client, actor: Actor, unitId: string, version: number, field: string, from: unknown, to: unknown, m: Meta) {
  await c.query(
    `insert into app.unit_changes (org_id, unit_id, version, actor_user_id, field, from_value, to_value, source_kind, source_id, batch_id)
     values (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [unitId, version, actor.userId, field, JSON.stringify(from ?? null), JSON.stringify(to ?? null), m.sourceKind, m.sourceId, m.batchId],
  );
}

async function applyUnits(c: Client, actor: Actor, ctx: OrgContext, rows: ValidatedRow[], policy: string, m: Meta, res: ApplyResult) {
  const binding = rows.some((r) => (r.action === "create" || r.action === "update") && r.warnings.some((w) => w.code === "needs_hold_approval"));
  if (binding && !can(ctx, "unit.hold.approve")) throw new IdentityError("forbidden", "unit.hold.approve");
  if (!can(ctx, "unit.manage")) throw new IdentityError("forbidden", "unit.manage");
  for (const r of rows) {
    const v = r.values;
    if (r.action === "create") {
      const { rows: ins } = await c.query<{ id: string; is_sample: boolean }>(
        `insert into app.units (org_id, project_id, phase_id, code, property_type, bedrooms, area_sqm, floor, status, source_kind, source_ref, source_id,
                                verification, last_verified_at, verified_by, created_by, last_updated_at)
         select app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                case when $12 and not p.is_sample then 'verified' else 'owner_reported' end,
                case when $12 and not p.is_sample then $13::timestamptz end, case when $12 and not p.is_sample then $14::uuid end, $14, now()
           from app.projects p where p.id = $1 returning id, is_sample`,
        [v.projectId, v.phase_id ?? null, v.code, v.property_type, v.bedrooms ?? null, v.area_sqm ?? null, v.floor ?? null, v.status, m.sourceKind,
          `import ${m.batchId.slice(0, 8)}`, m.sourceId, m.verify, m.asOf, actor.userId],
      );
      await logUnit(c, actor, ins[0]!.id, 1, "created", null, Object.fromEntries(r.changes.map((x) => [x.field, x.to])), m);
      res.applied++;
    } else if (r.action === "update") {
      const { rows: cur } = await c.query("select version, verification, is_sample from app.units where id = $1", [r.targetId]);
      const u = cur[0]!;
      const version = u.version + 1;
      const set = r.changes.map((ch, i) => `${ch.field} = $${i + 2}`).join(", ");
      const verifyNow = m.verify && !u.is_sample;
      await c.query(
        `update app.units set ${set}, version = $${r.changes.length + 2}, last_updated_at = now(), source_kind = $${r.changes.length + 3}, source_id = $${r.changes.length + 4},
                verification = case when $${r.changes.length + 5} then 'verified' when verification = 'verified' then 'owner_reported' else verification end,
                last_verified_at = case when $${r.changes.length + 5} then $${r.changes.length + 6}::timestamptz when verification = 'verified' then null else last_verified_at end,
                verified_by = case when $${r.changes.length + 5} then $${r.changes.length + 7}::uuid when verification = 'verified' then null else verified_by end
          where id = $1`,
        [r.targetId, ...r.changes.map((ch) => ch.to), version, m.sourceKind, m.sourceId, verifyNow, m.asOf, actor.userId],
      );
      for (const ch of r.changes) await logUnit(c, actor, r.targetId!, version, ch.field, ch.from, ch.to, m);
      const newVer = verifyNow ? "verified" : u.verification === "verified" ? "owner_reported" : null;
      if (newVer && newVer !== u.verification) await logUnit(c, actor, r.targetId!, version, "verification", u.verification, newVer, m);
      res.applied++;
    } else if (r.action === "unchanged" && m.verify) {
      // Same values, confirmed again: moves the confirmation time forward (never backward).
      const { rows: upd } = await c.query(
        `update app.units set verification = 'verified', last_verified_at = $2, verified_by = $3, source_id = $4, source_kind = $5
          where id = $1 and not is_sample and verification <> 'disputed' and (last_verified_at is null or last_verified_at < $2) returning version`,
        [r.targetId, m.asOf, actor.userId, m.sourceId, m.sourceKind],
      );
      if (upd[0]) { await logUnit(c, actor, r.targetId!, upd[0].version, "verification", "reconfirmed", "verified", m); res.reconfirmed++; }
    } else if (r.action === "conflict" && policy === "mark_disputed") {
      const { rows: upd } = await c.query(
        "update app.units set verification = 'disputed', last_verified_at = null, verified_by = null where id = $1 and verification <> 'disputed' returning version",
        [r.targetId],
      );
      if (upd[0]) { await logUnit(c, actor, r.targetId!, upd[0].version, "verification", null, "disputed", m); res.disputed++; }
    } else if (r.action !== "unchanged") res.skipped++;
  }
}

async function applyProjects(c: Client, actor: Actor, ctx: OrgContext, rows: ValidatedRow[], policy: string, m: Meta, res: ApplyResult) {
  if (!can(ctx, "project.manage")) throw new IdentityError("forbidden", "project.manage");
  for (const r of rows) {
    if (r.action === "update") {
      const set = r.changes.map((ch, i) => `${ch.field} = $${i + 2}`).join(", ");
      await c.query(`update app.projects set ${set}, updated_at = now(), updated_by = $${r.changes.length + 2} where id = $1`, [r.targetId, ...r.changes.map((x) => x.to), actor.userId]);
      for (const ch of r.changes) {
        await c.query(
          `insert into app.project_changes (org_id, project_id, actor_user_id, field, from_value, to_value, source_id, batch_id)
           values (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7)`,
          [r.targetId, actor.userId, ch.field, JSON.stringify(ch.from), JSON.stringify(ch.to), m.sourceId, m.batchId],
        );
      }
      res.applied++;
    } else if (r.action === "conflict" && policy === "mark_disputed") {
      // Projects carry no verification state; the conflict stays visible in the batch and history.
      await c.query(
        `insert into app.project_changes (org_id, project_id, actor_user_id, field, from_value, to_value, source_id, batch_id)
         values (app.current_org_id(), $1, $2, 'conflict', null, $3, $4, $5)`,
        [r.targetId, actor.userId, JSON.stringify(r.changes), m.sourceId, m.batchId],
      );
      res.disputed++;
    } else if (r.action !== "unchanged") res.skipped++;
  }
}

/** Prices land in one new DRAFT version per price list. Approval still needs a second person. */
async function applyPrices(c: Client, actor: Actor, ctx: OrgContext, rows: ValidatedRow[], batch: Record<string, any>, source: Record<string, any>, res: ApplyResult) {
  if (!can(ctx, "price.change.request")) throw new IdentityError("forbidden", "price.change.request");
  const groups = new Map<string, ValidatedRow[]>();
  for (const r of rows) {
    if (r.action !== "create" && r.action !== "update") { if (r.action !== "unchanged") res.skipped++; continue; }
    const k = `${r.values.projectId}|${String(r.values.listName).toLowerCase()}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const g of groups.values()) {
    const first = g[0]!.values;
    let listId = first.listId as string | null;
    if (!listId) {
      const { rows: ins } = await c.query<{ id: string }>(
        "insert into app.price_lists (org_id, project_id, name, currency, created_by) values (app.current_org_id(), $1, $2, $3, $4) returning id",
        [first.projectId, first.listName, first.currency, actor.userId],
      );
      listId = ins[0]!.id;
    }
    const n = await nextVersionNumber(c, "price", listId);
    const { rows: v } = await c.query<{ id: string }>(
      `insert into app.price_list_versions (org_id, price_list_id, version, effective_from, notes, created_by, import_batch_id)
       values (app.current_org_id(), $1, $2, $3, $4, $5, $6) returning id`,
      [listId, n, batch.options.effective_from, `Imported from ${source.name}`.slice(0, 1000), actor.userId, batch.id],
    );
    const vid = v[0]!.id;
    const prev = (await c.query<{ id: string }>("select id from app.price_list_versions where price_list_id = $1 and status = 'approved' order by effective_from desc, decided_at desc limit 1", [listId])).rows[0];
    if (prev) await c.query("insert into app.price_list_entries (org_id, version_id, unit_id, price_minor) select org_id, $1, unit_id, price_minor from app.price_list_entries where version_id = $2", [vid, prev.id]);
    for (const r of g) {
      await c.query(
        `insert into app.price_list_entries (org_id, version_id, unit_id, price_minor) values (app.current_org_id(), $1, $2, $3)
         on conflict (version_id, unit_id) do update set price_minor = excluded.price_minor`,
        [vid, r.values.unitId, r.values.minor],
      );
      res.applied++;
    }
    await audit(c, actor, { type: "price_version.created", target: { type: "price_version", id: vid }, metadata: { version: n, import_batch: batch.id } });
    res.drafts++;
  }
}

/** Each plan in the file becomes one new DRAFT version with its milestones. */
async function applyPlans(c: Client, actor: Actor, ctx: OrgContext, rows: ValidatedRow[], source: Record<string, any>, batchId: string, res: ApplyResult) {
  if (!can(ctx, "payment_plan.manage")) throw new IdentityError("forbidden", "payment_plan.manage");
  const groups = new Map<string, ValidatedRow[]>();
  for (const r of rows) {
    if (r.action !== "create") { res.skipped++; continue; }
    const k = `${r.values.projectId}|${String(r.values.planName).toLowerCase()}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const g of groups.values()) {
    const first = g[0]!.values;
    let planId = first.planId as string | null;
    if (!planId) {
      const { rows: ins } = await c.query<{ id: string }>(
        "insert into app.payment_plans (org_id, project_id, name, created_by) values (app.current_org_id(), $1, $2, $3) returning id",
        [first.projectId, first.planName, actor.userId],
      );
      planId = ins[0]!.id;
    }
    const n = await nextVersionNumber(c, "plan", planId);
    const { rows: v } = await c.query<{ id: string }>(
      `insert into app.payment_plan_versions (org_id, plan_id, version, currency, effective_from, notes, created_by, import_batch_id)
       values (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7) returning id`,
      [planId, n, first.currency, first.effectiveFrom, `Imported from ${source.name}`.slice(0, 1000), actor.userId, batchId],
    );
    const vid = v[0]!.id;
    for (const r of [...g].sort((a, b) => Number(a.values.seq) - Number(b.values.seq))) {
      const x = r.values;
      await c.query(
        `insert into app.payment_plan_milestones (org_id, version_id, seq, label, trigger_kind, due_date, progress_percent, months_after_handover, percent, amount_minor)
         values (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [vid, x.seq, x.label, x.trigger, x.dueDate, x.progress, x.months, x.percent, x.amount],
      );
      res.applied++;
    }
    await audit(c, actor, { type: "plan_version.created", target: { type: "plan_version", id: vid }, metadata: { version: n, import_batch: batchId } });
    res.drafts++;
  }
}
