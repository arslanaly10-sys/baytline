import { ENQUIRY_STATUSES, PAYMENT_FREQUENCIES, type AppointmentKind, type AppointmentStatus, type ContactMethod, type DayPeriod, type EnquiryStatus, type ListingKind } from "@baytline/core";
import { withAppTx, type Db } from "@baytline/db";
import type { Actor } from "@baytline/identity";
import { audit, can, f, IdentityError, mapDbError, requireOrg } from "./guard";

/**
 * Organization side of milestone 7: publishing controls and an inbox for routed requests.
 * Publishing is the explicit approval for public display; it is recorded with who and when.
 */

// ---------------------------------------------------------------- developer project publication

export type ProjectPublication = {
  projectId: string;
  isSample: boolean;
  status: "published" | "withdrawn" | "never";
  showPrices: boolean;
  showPaymentPlans: boolean;
  routeBrokerageOrgId: string | null;
  publishedAt: Date | null;
  publishedByName: string | null;
  units: { id: string; code: string; status: string; isSample: boolean; selected: boolean }[];
  brokerages: { id: string; name: string }[];
  canPublish: boolean;
};

export async function getProjectPublication(db: Db, actor: Actor, projectId: string): Promise<ProjectPublication> {
  const pid = f.id(projectId);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireOrg(c, actor, ["developer"], "project.view");
    const p = (await c.query("select id, is_sample from app.projects where id = $1 and org_id = app.current_org_id()", [pid])).rows[0];
    if (!p) throw new IdentityError("not_found");
    const pub = (await c.query("select pp.*, u.display_name as by_name from app.project_publications pp left join app.users u on u.id = pp.published_by where pp.project_id = $1", [pid])).rows[0];
    const selected = new Set((await c.query("select unit_id from app.project_publication_units where project_id = $1", [pid])).rows.map((r) => r.unit_id));
    const units = (await c.query("select id, code, status, is_sample from app.units where project_id = $1 order by code", [pid])).rows.map((r) => ({
      id: r.id, code: r.code, status: r.status, isSample: r.is_sample, selected: selected.has(r.id),
    }));
    const brokerages = (await c.query(
      `select o.id, o.name from app.project_shares s join app.organizations o on o.id = s.brokerage_org_id
        where s.project_id = $1 and s.status = 'active' order by o.name`, [pid])).rows;
    return {
      projectId: pid,
      isSample: p.is_sample,
      status: pub ? pub.status : "never",
      showPrices: pub?.show_prices ?? false,
      showPaymentPlans: pub?.show_payment_plans ?? false,
      routeBrokerageOrgId: pub?.route_brokerage_org_id ?? null,
      publishedAt: pub?.published_at ?? null,
      publishedByName: pub?.by_name ?? null,
      units,
      brokerages,
      canPublish: can(ctx, "listing.publish") && !p.is_sample,
    };
  });
}

export type PublishProjectInput = { unitIds: unknown[]; showPrices: boolean; showPaymentPlans: boolean; routeBrokerageOrgId?: unknown };

export async function publishProject(db: Db, actor: Actor, projectId: string, i: PublishProjectInput): Promise<void> {
  const pid = f.id(projectId);
  const unitIds = [...new Set(i.unitIds.map((u) => f.id(u)))];
  const route = i.routeBrokerageOrgId ? f.id(i.routeBrokerageOrgId) : null;
  await withAppTx(db, actor, async (c) => {
    await requireOrg(c, actor, ["developer"], "listing.publish");
    const existing = (await c.query("select status from app.project_publications where project_id = $1 for update", [pid])).rows[0];
    try {
      if (existing) {
        await c.query(
          `update app.project_publications set status = 'published', show_prices = $2, show_payment_plans = $3, route_brokerage_org_id = $4,
                  updated_at = now(), updated_by = $5, published_at = case when status = 'withdrawn' then now() else published_at end,
                  published_by = case when status = 'withdrawn' then $5 else published_by end, withdrawn_at = null, withdrawn_by = null
            where project_id = $1`,
          [pid, i.showPrices, i.showPaymentPlans, route, actor.userId],
        );
      } else {
        const ok = await c.query(
          `insert into app.project_publications (project_id, org_id, status, show_prices, show_payment_plans, route_brokerage_org_id, published_by)
           select id, org_id, 'published', $2, $3, $4, $5 from app.projects where id = $1 and org_id = app.current_org_id()`,
          [pid, i.showPrices, i.showPaymentPlans, route, actor.userId],
        );
        if (!ok.rowCount) throw new IdentityError("not_found");
      }
      await c.query("delete from app.project_publication_units where project_id = $1", [pid]);
      for (const u of unitIds) {
        await c.query("insert into app.project_publication_units (project_id, unit_id, org_id) values ($1, $2, app.current_org_id())", [pid, u]);
      }
    } catch (e) {
      if (e instanceof IdentityError) throw e;
      mapDbError(e);
    }
    await audit(c, actor, {
      type: existing?.status === "published" ? "listing.updated" : "listing.published",
      target: { type: "project", id: pid },
      metadata: { units: unitIds.length, prices: i.showPrices, plans: i.showPaymentPlans, routed: route ? "brokerage" : "developer" },
    });
  });
}

export async function withdrawProject(db: Db, actor: Actor, projectId: string): Promise<void> {
  const pid = f.id(projectId);
  await withAppTx(db, actor, async (c) => {
    await requireOrg(c, actor, ["developer"], "listing.publish");
    const r = await c.query("update app.project_publications set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = $2 where project_id = $1 and status = 'published'", [pid, actor.userId]);
    if (!r.rowCount) throw new IdentityError("not_found");
    await audit(c, actor, { type: "listing.withdrawn", target: { type: "project", id: pid } });
  });
}

// ---------------------------------------------------------------- property-manager rental listing

export type RentalListingAdmin = {
  unitId: string;
  isSample: boolean;
  occupancy: string;
  eligible: boolean; // vacant or notice given
  status: "published" | "withdrawn" | "never";
  askingRentMinor: string | null;
  currency: string;
  paymentFrequency: string | null;
  availableFrom: string | null;
  areaLabel: string | null;
  description: string | null;
  confirmedAt: Date | null;
  confirmedByName: string | null;
  canPublish: boolean;
};

export async function getRentalListingAdmin(db: Db, actor: Actor, unitId: string): Promise<RentalListingAdmin> {
  const uid = f.id(unitId);
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireOrg(c, actor, ["property_manager"], "property.view");
    const u = (await c.query(
      `select u.id, u.is_sample, u.occupancy, mk.currency from app.pm_units u join app.pm_properties p on p.id = u.property_id
         join app.markets mk on mk.code = p.market where u.id = $1 and u.org_id = app.current_org_id()`, [uid])).rows[0];
    if (!u) throw new IdentityError("not_found");
    const l = (await c.query(
      `select l.*, l.asking_rent_minor::text as rent, l.available_from::text as af, cu.display_name as by_name
         from app.pm_rental_listings l left join app.users cu on cu.id = l.confirmed_by where l.unit_id = $1`, [uid])).rows[0];
    return {
      unitId: uid,
      isSample: u.is_sample,
      occupancy: u.occupancy,
      eligible: u.occupancy === "vacant" || u.occupancy === "notice_given",
      status: l ? l.status : "never",
      askingRentMinor: l?.rent ?? null,
      currency: l?.currency ?? u.currency,
      paymentFrequency: l?.payment_frequency ?? null,
      availableFrom: l?.af ?? null,
      areaLabel: l?.area_label ?? null,
      description: l?.description ?? null,
      confirmedAt: l?.confirmed_at ?? null,
      confirmedByName: l?.by_name ?? null,
      canPublish: can(ctx, "listing.publish") && !u.is_sample,
    };
  });
}

export type PublishRentalInput = { rent: unknown; paymentFrequency: unknown; availableFrom?: unknown; areaLabel?: unknown; description?: unknown };

/** Publishing also counts as confirming, today, that the unit is on offer. */
export async function publishRental(db: Db, actor: Actor, unitId: string, i: PublishRentalInput): Promise<void> {
  const uid = f.id(unitId);
  await withAppTx(db, actor, async (c) => {
    await requireOrg(c, actor, ["property_manager"], "listing.publish");
    const u = (await c.query(
      `select u.id, u.occupancy, mk.currency from app.pm_units u join app.pm_properties p on p.id = u.property_id
         join app.markets mk on mk.code = p.market where u.id = $1 and u.org_id = app.current_org_id()`, [uid])).rows[0];
    if (!u) throw new IdentityError("not_found");
    if (u.occupancy !== "vacant" && u.occupancy !== "notice_given") throw new IdentityError("invalid_input", "rental_not_vacant");
    const rent = f.parseMoney(i.rent, u.currency, "rent");
    if (rent === null) throw new IdentityError("invalid_input", "rent");
    const v = {
      frequency: f.oneOf(i.paymentFrequency, PAYMENT_FREQUENCIES, "payment_frequency"),
      availableFrom: f.optDate(i.availableFrom, "available_from"),
      areaLabel: f.opt(i.areaLabel, 120, "area_label"),
      description: f.opt(i.description, 1000, "description", true),
    };
    const existed = (await c.query("select status from app.pm_rental_listings where unit_id = $1 for update", [uid])).rows[0];
    try {
      await c.query(
        `insert into app.pm_rental_listings (unit_id, org_id, status, asking_rent_minor, currency, payment_frequency, available_from, area_label, description,
                confirmed_at, confirmed_by, published_by)
         values ($1, app.current_org_id(), 'published', $2, $3, $4, $5, $6, $7, now(), $8, $8)
         on conflict (unit_id) do update set status = 'published', asking_rent_minor = excluded.asking_rent_minor, currency = excluded.currency,
                payment_frequency = excluded.payment_frequency, available_from = excluded.available_from, area_label = excluded.area_label,
                description = excluded.description, confirmed_at = now(), confirmed_by = excluded.confirmed_by,
                updated_at = now(), updated_by = excluded.confirmed_by, withdrawn_at = null, withdrawn_by = null`,
        [uid, rent.toString(), u.currency, v.frequency, v.availableFrom, v.areaLabel, v.description, actor.userId],
      );
    } catch (e) {
      mapDbError(e);
    }
    await audit(c, actor, { type: existed?.status === "published" ? "listing.updated" : "listing.published", target: { type: "pm_unit", id: uid }, metadata: { purpose: "rent" } });
  });
}

/** "Still available": refreshes the confirmation date that drives the public availability label. */
export async function confirmRental(db: Db, actor: Actor, unitId: string): Promise<void> {
  const uid = f.id(unitId);
  await withAppTx(db, actor, async (c) => {
    await requireOrg(c, actor, ["property_manager"], "listing.publish");
    const occ = (await c.query("select occupancy from app.pm_units where id = $1", [uid])).rows[0]?.occupancy;
    if (occ !== "vacant" && occ !== "notice_given") throw new IdentityError("invalid_input", "rental_not_vacant");
    const r = await c.query("update app.pm_rental_listings set confirmed_at = now(), confirmed_by = $2 where unit_id = $1 and status = 'published'", [uid, actor.userId]);
    if (!r.rowCount) throw new IdentityError("not_found");
    await audit(c, actor, { type: "listing.confirmed", target: { type: "pm_unit", id: uid } });
  });
}

export async function withdrawRental(db: Db, actor: Actor, unitId: string): Promise<void> {
  const uid = f.id(unitId);
  await withAppTx(db, actor, async (c) => {
    await requireOrg(c, actor, ["property_manager"], "listing.publish");
    const r = await c.query("update app.pm_rental_listings set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = $2 where unit_id = $1 and status = 'published'", [uid, actor.userId]);
    if (!r.rowCount) throw new IdentityError("not_found");
    await audit(c, actor, { type: "listing.withdrawn", target: { type: "pm_unit", id: uid } });
  });
}

// ---------------------------------------------------------------- inbox

export type InboxEnquiry = {
  id: string; listingKind: ListingKind; listingTitle: string; contactName: string; contactEmail: string; contactPhone: string | null;
  preferredContact: ContactMethod; locale: string; message: string | null; source: string; status: EnquiryStatus; consentAt: Date; createdAt: Date;
};
export type InboxAppointment = {
  id: string; kind: AppointmentKind; listingTitle: string; slots: { date: string; period: DayPeriod }[]; contactName: string; contactEmail: string;
  contactPhone: string | null; preferredContact: ContactMethod; locale: string; note: string | null; status: AppointmentStatus;
  confirmedFor: Date | null; orgNote: string | null; decidedByName: string | null; createdAt: Date;
};
export type Inbox = { enquiries: InboxEnquiry[]; appointments: InboxAppointment[]; canManage: boolean; canConfirm: boolean; timeZone: string };

const INBOX_TYPES = ["developer", "brokerage", "property_manager"];

/** Requests routed to the active organization. Row-level security limits these to its lead-handling roles. */
export async function listInbox(db: Db, actor: Actor, s: { status?: string } = {}): Promise<Inbox> {
  return withAppTx(db, actor, async (c) => {
    const ctx = await requireOrg(c, actor, INBOX_TYPES, "lead.view");
    const open = s.status !== "all";
    const enquiries = (await c.query(
      `select * from app.customer_enquiries where routed_org_id = app.current_org_id() ${open ? "and status <> 'closed'" : ""} order by created_at desc limit 500`)).rows.map((r) => ({
      id: r.id, listingKind: r.listing_kind, listingTitle: r.listing_title, contactName: r.contact_name, contactEmail: r.contact_email, contactPhone: r.contact_phone,
      preferredContact: r.preferred_contact, locale: r.locale, message: r.message, source: r.source, status: r.status, consentAt: r.consent_at, createdAt: r.created_at,
    }));
    const appointments = (await c.query(
      `select a.*, u.display_name as decided_by_name from app.appointment_requests a left join app.users u on u.id = a.decided_by
        where a.routed_org_id = app.current_org_id() ${open ? "and a.status in ('pending','confirmed')" : ""} order by (a.status = 'pending') desc, a.created_at desc limit 500`)).rows.map((r) => ({
      id: r.id, kind: r.kind, listingTitle: r.listing_title, slots: r.preferred_slots, contactName: r.contact_name, contactEmail: r.contact_email,
      contactPhone: r.contact_phone, preferredContact: r.preferred_contact, locale: r.locale, note: r.note, status: r.status,
      confirmedFor: r.confirmed_for, orgNote: r.org_note, decidedByName: r.decided_by_name, createdAt: r.created_at,
    }));
    const tz = (await c.query("select mk.time_zone from app.organizations o join app.markets mk on mk.code = o.market where o.id = app.current_org_id()")).rows[0]?.time_zone ?? "UTC";
    return { enquiries, appointments, canManage: can(ctx, "lead.manage"), canConfirm: can(ctx, "viewing.manage"), timeZone: tz };
  });
}

export async function setEnquiryStatus(db: Db, actor: Actor, enquiryId: string, status: unknown): Promise<void> {
  const id = f.id(enquiryId);
  const st = f.oneOf(status, ENQUIRY_STATUSES, "status");
  await withAppTx(db, actor, async (c) => {
    await requireOrg(c, actor, INBOX_TYPES, "lead.manage");
    const prev = (await c.query("select status from app.customer_enquiries where id = $1 and routed_org_id = app.current_org_id() for update", [id])).rows[0];
    if (!prev) throw new IdentityError("not_found");
    if (prev.status === st) return;
    await c.query("update app.customer_enquiries set status = $2, status_updated_at = now(), status_updated_by = $3 where id = $1", [id, st, actor.userId]);
    await audit(c, actor, { type: "enquiry.status_changed", target: { type: "enquiry", id }, metadata: { from: prev.status, to: st } });
  });
}

/**
 * Confirms a time the organization has actually arranged with the customer. `localDateTime` is
 * "YYYY-MM-DDTHH:mm" in the organization's market time zone.
 */
export async function confirmAppointment(db: Db, actor: Actor, appointmentId: string, i: { localDateTime: unknown; note?: unknown }): Promise<void> {
  const id = f.id(appointmentId);
  const at = typeof i.localDateTime === "string" ? i.localDateTime.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) throw new IdentityError("invalid_input", "confirmed_for");
  const note = f.opt(i.note, 500, "org_note");
  await withAppTx(db, actor, async (c) => {
    await requireOrg(c, actor, INBOX_TYPES, "viewing.manage");
    const a = (await c.query("select status from app.appointment_requests where id = $1 and routed_org_id = app.current_org_id() for update", [id])).rows[0];
    if (!a) throw new IdentityError("not_found");
    if (a.status !== "pending" && a.status !== "confirmed") throw new IdentityError("invalid_input", "appointment_closed");
    const r = await c.query(
      `update app.appointment_requests a set status = 'confirmed', confirmed_for = ($2::timestamp at time zone mk.time_zone), confirmed_time_zone = mk.time_zone, org_note = $3,
              decided_at = now(), decided_by = $4
         from app.organizations o join app.markets mk on mk.code = o.market
        where a.id = $1 and o.id = a.routed_org_id and ($2::timestamp at time zone mk.time_zone) > now()`,
      [id, at, note, actor.userId],
    );
    if (!r.rowCount) throw new IdentityError("invalid_input", "confirmed_for");
    await audit(c, actor, { type: "appointment.confirmed", target: { type: "appointment", id } });
  });
}

export async function declineAppointment(db: Db, actor: Actor, appointmentId: string, i: { note?: unknown }): Promise<void> {
  const id = f.id(appointmentId);
  const note = f.opt(i.note, 500, "org_note");
  await withAppTx(db, actor, async (c) => {
    await requireOrg(c, actor, INBOX_TYPES, "viewing.manage");
    const a = (await c.query("select status from app.appointment_requests where id = $1 and routed_org_id = app.current_org_id() for update", [id])).rows[0];
    if (!a) throw new IdentityError("not_found");
    if (a.status !== "pending" && a.status !== "confirmed") throw new IdentityError("invalid_input", "appointment_closed");
    await c.query("update app.appointment_requests set status = 'declined', org_note = $2, decided_at = now(), decided_by = $3 where id = $1", [id, note, actor.userId]);
    await audit(c, actor, { type: "appointment.declined", target: { type: "appointment", id } });
  });
}

// ---------------------------------------------------------------- platform support

export type SupportQueueItem = { id: string; topic: string; subject: string; message: string; locale: string; status: string; response: string | null; respondedAt: Date | null; createdAt: Date };

/** Support staff see the request itself, not the customer's other records. */
export async function listSupportQueue(db: Db, actor: Actor, s: { status?: string } = {}): Promise<SupportQueueItem[]> {
  return withAppTx(db, actor, async (c) => {
    await requireOrg(c, actor, ["platform"], "support.handle");
    const st = s.status && ["open", "answered", "closed"].includes(s.status) ? s.status : null;
    const { rows } = await c.query(
      `select * from app.support_requests ${st ? "where status = $1" : ""} order by (status = 'open') desc, created_at desc limit 500`, st ? [st] : []);
    return rows.map((r) => ({ id: r.id, topic: r.topic, subject: r.subject, message: r.message, locale: r.locale, status: r.status, response: r.response, respondedAt: r.responded_at, createdAt: r.created_at }));
  });
}

export async function answerSupportRequest(db: Db, actor: Actor, requestId: string, i: { response: unknown; close?: boolean }): Promise<void> {
  const id = f.id(requestId);
  const response = f.req(typeof i.response === "string" ? i.response.replace(/\r\n/g, "\n") : i.response, 2000, "response");
  await withAppTx(db, actor, async (c) => {
    await requireOrg(c, actor, ["platform"], "support.handle");
    const r = await c.query("update app.support_requests set status = $2, response = $3, responded_at = now(), responded_by = $4 where id = $1",
      [id, i.close ? "closed" : "answered", response, actor.userId]);
    if (!r.rowCount) throw new IdentityError("not_found");
    await audit(c, actor, { type: i.close ? "support.closed" : "support.answered", target: { type: "support_request", id } });
  });
}
