import { DOCUMENT_TYPES, DOCUMENT_VISIBILITIES, type DocumentType, type DocumentVisibility } from "@baytline/core";
import { withAppTx, type Db } from "@baytline/db";
import type { Actor } from "@baytline/identity";
import { audit, IdentityError, requireDeveloper } from "./guard";
import { id, oneOf, req } from "./validation";

/**
 * Project documents. No file storage is connected yet, so a document is a link (https only)
 * or an external reference such as a document-management ID. Uploads arrive with the
 * document-storage connector.
 */
export type DocumentRow = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  docType: DocumentType;
  referenceKind: "url" | "external_ref";
  reference: string;
  visibility: DocumentVisibility;
  status: "active" | "archived";
  updatedAt: Date;
  updatedByName: string | null;
};

export async function listDocuments(db: Db, actor: Actor, s: { projectId?: string; includeArchived?: boolean; visibility?: string; docType?: string } = {}): Promise<DocumentRow[]> {
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "document.view");
    const where = ["d.org_id = app.current_org_id()"];
    const args: unknown[] = [];
    if (s.projectId) where.push(`d.project_id = $${args.push(id(s.projectId))}`);
    if (!s.includeArchived) where.push("d.status = 'active'");
    if (s.visibility && (DOCUMENT_VISIBILITIES as readonly string[]).includes(s.visibility)) where.push(`d.visibility = $${args.push(s.visibility)}`);
    if (s.docType && (DOCUMENT_TYPES as readonly string[]).includes(s.docType)) where.push(`d.doc_type = $${args.push(s.docType)}`);
    const { rows } = await c.query(
      `select d.*, p.name as project_name, u.display_name as updated_by_name
         from app.project_documents d join app.projects p on p.id = d.project_id left join app.users u on u.id = d.updated_by
        where ${where.join(" and ")} order by d.status, d.updated_at desc`,
      args,
    );
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      projectName: r.project_name,
      title: r.title,
      docType: r.doc_type,
      referenceKind: r.reference_kind,
      reference: r.reference,
      visibility: r.visibility,
      status: r.status,
      updatedAt: r.updated_at,
      updatedByName: r.updated_by_name,
    }));
  });
}

export type DocumentInput = { title: unknown; docType: unknown; referenceKind: unknown; reference: unknown; visibility: unknown };

function validate(i: DocumentInput) {
  const kind = oneOf(i.referenceKind, ["url", "external_ref"] as const, "reference_kind");
  const reference = req(i.reference, 500, "reference");
  if (kind === "url" && !/^https:\/\/[^\s/]+\.[^\s]+$/.test(reference)) throw new IdentityError("invalid_input", "reference_url");
  return {
    title: req(i.title, 160, "title"),
    doc_type: oneOf(i.docType, DOCUMENT_TYPES, "doc_type"),
    reference_kind: kind,
    reference,
    visibility: oneOf(i.visibility, DOCUMENT_VISIBILITIES, "visibility"),
  };
}

export async function addDocument(db: Db, actor: Actor, projectId: string, input: DocumentInput): Promise<string> {
  const pid = id(projectId);
  const v = validate(input);
  return withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "document.manage");
    const p = await c.query("select 1 from app.projects where id = $1", [pid]);
    if (!p.rowCount) throw new IdentityError("not_found");
    const { rows } = await c.query<{ id: string }>(
      `insert into app.project_documents (org_id, project_id, title, doc_type, reference_kind, reference, visibility, created_by, updated_by)
       values (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $7) returning id`,
      [pid, v.title, v.doc_type, v.reference_kind, v.reference, v.visibility, actor.userId],
    );
    await audit(c, actor, { type: "document.added", target: { type: "document", id: rows[0]!.id }, metadata: { visibility: v.visibility } });
    return rows[0]!.id;
  });
}

export async function updateDocument(db: Db, actor: Actor, documentId: string, input: DocumentInput): Promise<void> {
  const did = id(documentId);
  const v = validate(input);
  await withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "document.manage");
    const { rows } = await c.query("select visibility from app.project_documents where id = $1 and status = 'active' for update", [did]);
    if (!rows[0]) throw new IdentityError("not_found");
    await c.query(
      "update app.project_documents set title = $2, doc_type = $3, reference_kind = $4, reference = $5, visibility = $6, updated_at = now(), updated_by = $7 where id = $1",
      [did, v.title, v.doc_type, v.reference_kind, v.reference, v.visibility, actor.userId],
    );
    await audit(c, actor, { type: "document.updated", target: { type: "document", id: did }, metadata: { visibility: v.visibility, visibilityChanged: rows[0].visibility !== v.visibility } });
  });
}

/** Archived documents disappear from partners immediately and are kept for the developer's records. */
export async function archiveDocument(db: Db, actor: Actor, documentId: string): Promise<void> {
  const did = id(documentId);
  await withAppTx(db, actor, async (c) => {
    await requireDeveloper(c, actor, "document.manage");
    const res = await c.query("update app.project_documents set status = 'archived', updated_at = now(), updated_by = $2 where id = $1 and status = 'active'", [did, actor.userId]);
    if (res.rowCount !== 1) throw new IdentityError("not_found");
    await audit(c, actor, { type: "document.archived", target: { type: "document", id: did } });
  });
}
