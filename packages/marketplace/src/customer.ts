import {
  APPOINTMENT_HORIZON_DAYS, APPOINTMENT_KINDS, CONTACT_METHODS, DAY_PERIODS, ENQUIRY_SOURCES, LISTING_KINDS, SUPPORT_TOPICS,
  type AppointmentKind, type AppointmentStatus, type ContactMethod, type DayPeriod, type EnquiryStatus, type ListingKind, type SupportStatus, type SupportTopic,
} from "@baytline/core";
import { withAppTx, type Db } from "@baytline/db";
import type { Actor } from "@baytline/identity";
import { f, IdentityError, mapDbError, requireCustomer, validPhone } from "./guard";

/**
 * Customer requests. The customer acts in their personal workspace; the database functions
 * (migration 0009) take the email from their account, decide routing from the publication and
 * record consent time and source. Nothing the browser sends can pick the receiving organization.
 */

export type ContactInput = { name: unknown; phone?: unknown; preferredContact: unknown; consent: unknown };

function contact(i: ContactInput) {
  if (i.consent !== true) throw new IdentityError("invalid_input", "consent");
  const preferred = f.oneOf(i.preferredContact, CONTACT_METHODS, "preferred_contact");
  return { name: f.req(i.name, 120, "name"), phone: validPhone(i.phone, preferred !== "email"), preferred };
}

export type EnquiryInput = ContactInput & { listingKind: unknown; listingId: unknown; message?: unknown; source: unknown; locale: "en" | "ar" };

export async function submitEnquiry(db: Db, actor: Actor, i: EnquiryInput): Promise<string> {
  const kind = f.oneOf(i.listingKind, LISTING_KINDS, "listing");
  const listing = f.id(i.listingId);
  const c0 = contact(i);
  const message = f.opt(i.message, 1000, "message", true);
  const source = f.oneOf(i.source, ENQUIRY_SOURCES, "source");
  return withAppTx(db, actor, async (c) => {
    await requireCustomer(c, actor, "enquiry.create");
    try {
      const { rows } = await c.query<{ id: string }>("select app.submit_enquiry($1,$2,$3,$4,$5,$6,$7,$8) as id", [kind, listing, c0.name, c0.phone, c0.preferred, i.locale, message, source]);
      return rows[0]!.id;
    } catch (e) {
      return mapDbError(e);
    }
  });
}

export type SlotInput = { date: unknown; period: unknown };
export type AppointmentInput = ContactInput & { listingKind: unknown; listingId: unknown; kind: unknown; slots: SlotInput[]; note?: unknown; locale: "en" | "ar" };

/** Dates are calendar days in the listing's market; checked again by the database. */
export function validateSlots(slots: SlotInput[], today: string): { date: string; period: DayPeriod }[] {
  const out: { date: string; period: DayPeriod }[] = [];
  const last = new Date(`${today}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() + APPOINTMENT_HORIZON_DAYS);
  const lastDay = last.toISOString().slice(0, 10);
  for (const s of slots) {
    const date = typeof s.date === "string" ? s.date.trim() : "";
    if (!date && !s.period) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || date < today || date > lastDay) throw new IdentityError("invalid_input", "slots");
    out.push({ date, period: f.oneOf(s.period, DAY_PERIODS, "slots") });
  }
  if (out.length < 1 || out.length > 3) throw new IdentityError("invalid_input", "slots");
  return out;
}

export async function submitAppointment(db: Db, actor: Actor, i: AppointmentInput, today = new Date().toISOString().slice(0, 10)): Promise<string> {
  const listingKind = f.oneOf(i.listingKind, LISTING_KINDS, "listing");
  const listing = f.id(i.listingId);
  const kind = f.oneOf(i.kind, APPOINTMENT_KINDS, "kind");
  const slots = validateSlots(i.slots, today);
  const c0 = contact(i);
  const note = f.opt(i.note, 1000, "note", true);
  return withAppTx(db, actor, async (c) => {
    await requireCustomer(c, actor, "appointment.book");
    try {
      const { rows } = await c.query<{ id: string }>("select app.submit_appointment($1,$2,$3,$4,$5,$6,$7,$8,$9) as id", [
        listingKind, listing, kind, JSON.stringify(slots), c0.name, c0.phone, c0.preferred, i.locale, note,
      ]);
      return rows[0]!.id;
    } catch (e) {
      return mapDbError(e);
    }
  });
}

export async function cancelAppointment(db: Db, actor: Actor, appointmentId: string): Promise<void> {
  const id = f.id(appointmentId);
  await withAppTx(db, actor, async (c) => {
    await requireCustomer(c, actor, "appointment.book");
    try {
      await c.query("select app.cancel_appointment($1)", [id]);
    } catch (e) {
      mapDbError(e);
    }
  });
}

export type SupportInput = { topic: unknown; subject: unknown; message: unknown; relatedEnquiryId?: unknown; locale: "en" | "ar" };

export async function submitSupportRequest(db: Db, actor: Actor, i: SupportInput): Promise<string> {
  const topic = f.oneOf(i.topic, SUPPORT_TOPICS, "topic");
  const subject = f.req(i.subject, 160, "subject");
  const message = f.req(typeof i.message === "string" ? i.message.replace(/\r\n/g, "\n") : i.message, 2000, "message");
  const related = i.relatedEnquiryId ? f.id(i.relatedEnquiryId) : null;
  return withAppTx(db, actor, async (c) => {
    await requireCustomer(c, actor, "support.request");
    try {
      const { rows } = await c.query<{ id: string }>("select app.submit_support_request($1,$2,$3,$4,$5) as id", [topic, subject, message, related, i.locale]);
      return rows[0]!.id;
    } catch (e) {
      return mapDbError(e);
    }
  });
}

// ---------------------------------------------------------------- the customer's own requests

export type MyEnquiry = { id: string; listingKind: ListingKind; listingTitle: string; listingRef: { kind: ListingKind; projectId: string | null; unitId: string | null; rentalId: string | null }; preferredContact: ContactMethod; message: string | null; status: EnquiryStatus; createdAt: Date };
export type MyAppointment = { id: string; kind: AppointmentKind; listingTitle: string; slots: { date: string; period: DayPeriod }[]; preferredContact: ContactMethod; status: AppointmentStatus; confirmedFor: Date | null; orgNote: string | null; createdAt: Date };
export type MySupportRequest = { id: string; topic: SupportTopic; subject: string; message: string; status: SupportStatus; response: string | null; respondedAt: Date | null; createdAt: Date };

/** Row-level security returns only rows whose customer is the signed-in user. */
export async function listMyRequests(db: Db, actor: Actor): Promise<{ enquiries: MyEnquiry[]; appointments: MyAppointment[]; support: MySupportRequest[] }> {
  return withAppTx(db, actor, async (c) => {
    await requireCustomer(c, actor, "enquiry.create");
    const enquiries = (await c.query("select * from app.customer_enquiries where customer_user_id = app.current_user_id() order by created_at desc limit 200")).rows.map((r) => ({
      id: r.id, listingKind: r.listing_kind, listingTitle: r.listing_title,
      listingRef: { kind: r.listing_kind, projectId: r.project_id, unitId: r.unit_id, rentalId: r.rental_unit_id },
      preferredContact: r.preferred_contact, message: r.message, status: r.status, createdAt: r.created_at,
    }));
    const appointments = (await c.query("select * from app.appointment_requests where customer_user_id = app.current_user_id() order by created_at desc limit 200")).rows.map((r) => ({
      id: r.id, kind: r.kind, listingTitle: r.listing_title, slots: r.preferred_slots, preferredContact: r.preferred_contact,
      status: r.status, confirmedFor: r.confirmed_for, orgNote: r.org_note, createdAt: r.created_at,
    }));
    const support = (await c.query("select * from app.support_requests where customer_user_id = app.current_user_id() order by created_at desc limit 200")).rows.map((r) => ({
      id: r.id, topic: r.topic, subject: r.subject, message: r.message, status: r.status, response: r.response, respondedAt: r.responded_at, createdAt: r.created_at,
    }));
    return { enquiries, appointments, support };
  });
}
