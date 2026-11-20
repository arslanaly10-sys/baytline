-- Milestone 7: customer discovery, comparison, enquiries, appointment requests and support.
--
-- Nothing is public until an authorized person at the owning organization publishes it:
--   project_publications (+ project_publication_units)  developer projects and chosen units, for sale
--   pm_rental_listings                                    property-manager units, for rent
-- Sample records can never be published.
--
-- Signed-out visitors read only the pub_* views below. They are owned by the migration owner, so
-- they read past row-level security, and expose only published rows and public columns. Every
-- other table stays behind RLS; with no user set, the app role sees nothing in them.
--
-- Customer requests (enquiries, appointment requests, support) are written only through security
-- definer functions that decide routing from the publication record, never from the browser.
-- A request is visible to the customer who made it and to the routed organization's lead-handling
-- roles; no other organization can read it.

-- ---------------------------------------------------------------- role lists (mirrored in @baytline/core, checked by a test)

create function app.lead_roles() returns text[] language sql immutable as $$
  select array['brokerage_admin','brokerage_manager','developer_admin','developer_sales_manager','pm_admin','pm_leasing_manager']
$$;
create function app.viewing_roles() returns text[] language sql immutable as $$
  select array['brokerage_admin','brokerage_manager','developer_admin','developer_sales_manager','pm_admin','pm_leasing_manager']
$$;
create function app.publish_roles() returns text[] language sql immutable as $$
  select array['developer_admin','developer_sales_manager','pm_admin','pm_leasing_manager']
$$;
create function app.support_roles() returns text[] language sql immutable as $$
  select array['platform_admin','platform_support']
$$;
grant execute on function app.lead_roles(), app.viewing_roles(), app.publish_roles(), app.support_roles() to baytline_app;

-- ---------------------------------------------------------------- publications

create table app.project_publications (
  project_id uuid primary key references app.projects(id),
  org_id uuid not null references app.organizations(id),
  status text not null check (status in ('published','withdrawn')),
  show_prices boolean not null default false,
  show_payment_plans boolean not null default false,
  -- Enquiries go to the developer unless it names a brokerage with an active share for this project.
  route_brokerage_org_id uuid references app.organizations(id),
  published_at timestamptz not null default now(),
  published_by uuid not null references app.users(id),
  updated_at timestamptz,
  updated_by uuid references app.users(id),
  withdrawn_at timestamptz,
  withdrawn_by uuid references app.users(id)
);

create table app.project_publication_units (
  project_id uuid not null references app.project_publications(project_id),
  unit_id uuid not null references app.units(id),
  org_id uuid not null references app.organizations(id),
  primary key (project_id, unit_id)
);

create table app.pm_rental_listings (
  unit_id uuid primary key references app.pm_units(id),
  org_id uuid not null references app.organizations(id),
  status text not null check (status in ('published','withdrawn')),
  asking_rent_minor bigint not null check (asking_rent_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  payment_frequency text not null check (payment_frequency in ('monthly','quarterly','semi_annual','annual','other')),
  available_from date,
  area_label text check (area_label is null or length(area_label) <= 120),
  description text check (description is null or length(description) <= 1000),
  -- When a person last confirmed the unit is still on offer. Drives the availability label.
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid not null references app.users(id),
  published_at timestamptz not null default now(),
  published_by uuid not null references app.users(id),
  updated_at timestamptz,
  updated_by uuid references app.users(id),
  withdrawn_at timestamptz,
  withdrawn_by uuid references app.users(id)
);

create function app.check_publication() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
declare
  r record;
begin
  if tg_table_name = 'project_publications' then
    select org_id, is_sample into r from app.projects where id = new.project_id;
    if r.org_id is distinct from new.org_id then raise exception 'org_mismatch' using errcode = '23514'; end if;
    if r.is_sample then raise exception 'sample_not_publishable' using errcode = '23514'; end if;
    if new.route_brokerage_org_id is not null and not exists (
         select 1 from app.project_shares s where s.project_id = new.project_id and s.brokerage_org_id = new.route_brokerage_org_id and s.status = 'active') then
      raise exception 'route_not_shared' using errcode = '23514';
    end if;
  elsif tg_table_name = 'project_publication_units' then
    select org_id, project_id, is_sample into r from app.units where id = new.unit_id;
    if r.org_id is distinct from new.org_id or r.project_id is distinct from new.project_id then raise exception 'unit' using errcode = '23514'; end if;
    if r.is_sample then raise exception 'sample_not_publishable' using errcode = '23514'; end if;
  elsif tg_table_name = 'pm_rental_listings' then
    select org_id, is_sample into r from app.pm_units where id = new.unit_id;
    if r.org_id is distinct from new.org_id then raise exception 'org_mismatch' using errcode = '23514'; end if;
    if r.is_sample then raise exception 'sample_not_publishable' using errcode = '23514'; end if;
  end if;
  return new;
end $$;
create trigger project_publications_check before insert or update on app.project_publications for each row execute function app.check_publication();
create trigger project_publication_units_check before insert or update on app.project_publication_units for each row execute function app.check_publication();
create trigger pm_rental_listings_check before insert or update on app.pm_rental_listings for each row execute function app.check_publication();

alter table app.project_publications enable row level security;
alter table app.project_publication_units enable row level security;
alter table app.pm_rental_listings enable row level security;
create policy project_publications_owner on app.project_publications for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy project_publication_units_owner on app.project_publication_units for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy pm_rental_listings_owner on app.pm_rental_listings for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
grant select, insert, update on app.project_publications, app.pm_rental_listings to baytline_app;
grant select, insert, delete on app.project_publication_units to baytline_app;

-- ---------------------------------------------------------------- public views

create view app.pub_projects with (security_barrier) as
  select p.id, p.org_id as owner_org_id, o.name as owner_name, p.name, p.market, p.city, p.location, p.property_types,
         p.description, p.launch_date, p.handover_date, p.status, pub.show_prices, pub.show_payment_plans,
         pub.route_brokerage_org_id, pub.published_at, coalesce(pub.updated_at, pub.published_at) as listing_updated_at,
         mk.currency, mk.time_zone
    from app.project_publications pub
    join app.projects p on p.id = pub.project_id
    join app.organizations o on o.id = p.org_id
    join app.markets mk on mk.code = p.market
   where pub.status = 'published' and not p.is_sample and o.status = 'active' and mk.status = 'enabled' and p.status <> 'cancelled';

create view app.pub_units with (security_barrier) as
  select u.id, u.project_id, pp.name as project_name, pp.owner_name, pp.market, pp.city, pp.location, ph.name as phase_name,
         ph.expected_handover::text as phase_expected_handover, u.code, u.property_type, u.bedrooms, u.area_sqm::text as area_sqm,
         u.floor, u.status, u.source_kind, u.last_updated_at, u.verification, u.last_verified_at,
         case when pp.show_prices then cp.price_minor end as price_minor,
         case when pp.show_prices then cp.currency end as price_currency,
         case when pp.show_prices then cp.effective_from end as price_effective_from,
         pp.handover_date::text as project_handover_date, pp.listing_updated_at
    from app.project_publication_units pu
    join app.pub_projects pp on pp.id = pu.project_id
    join app.units u on u.id = pu.unit_id
    left join app.project_phases ph on ph.id = u.phase_id
    left join lateral (
      select e.price_minor, l.currency, v.effective_from::text
        from app.price_list_entries e
        join app.price_list_versions v on v.id = e.version_id
        join app.price_lists l on l.id = v.price_list_id
       where e.unit_id = u.id and v.status = 'approved'
         and v.effective_from <= (now() at time zone pp.time_zone)::date
         and (v.effective_to is null or v.effective_to >= (now() at time zone pp.time_zone)::date)
       order by v.effective_from desc, v.decided_at desc
       limit 1) cp on true
   where not u.is_sample and u.status <> 'draft';

-- Approved payment plans in effect today, for projects published with payment plans shown.
create view app.pub_plans with (security_barrier) as
  select v.id, pl.project_id, pl.name, v.currency, v.effective_from::text, v.effective_to::text, v.handover_terms,
         (select coalesce(jsonb_agg(jsonb_build_object('seq', m.seq, 'label', m.label, 'trigger', m.trigger_kind, 'dueDate', m.due_date,
                   'progressPercent', m.progress_percent, 'monthsAfterHandover', m.months_after_handover,
                   'percent', m.percent, 'amountMinor', m.amount_minor::text) order by m.seq), '[]'::jsonb)
            from app.payment_plan_milestones m where m.version_id = v.id) as milestones
    from app.payment_plan_versions v
    join app.payment_plans pl on pl.id = v.plan_id
    join app.pub_projects pp on pp.id = pl.project_id
   where pp.show_payment_plans and v.status = 'approved'
     and v.effective_from <= (now() at time zone pp.time_zone)::date
     and (v.effective_to is null or v.effective_to >= (now() at time zone pp.time_zone)::date);

-- Rentals disappear on their own when the unit is no longer recorded as vacant or on notice.
create view app.pub_rentals with (security_barrier) as
  select l.unit_id as id, l.org_id as owner_org_id, o.name as owner_name, p.name as property_name, p.market, p.city,
         l.area_label, p.property_type, u.unit_type, u.bedrooms, u.area_sqm::text as area_sqm, u.floor, u.occupancy,
         l.asking_rent_minor::text as asking_rent_minor, l.currency, l.payment_frequency, l.available_from::text as available_from,
         l.description, l.confirmed_at, l.published_at, coalesce(l.updated_at, l.published_at) as listing_updated_at
    from app.pm_rental_listings l
    join app.pm_units u on u.id = l.unit_id
    join app.pm_properties p on p.id = u.property_id
    join app.organizations o on o.id = l.org_id
    join app.markets mk on mk.code = p.market
   where l.status = 'published' and not u.is_sample and p.status = 'active' and o.status = 'active' and mk.status = 'enabled'
     and u.occupancy in ('vacant','notice_given');

grant select on app.pub_projects, app.pub_units, app.pub_plans, app.pub_rentals to baytline_app;

-- ---------------------------------------------------------------- customer requests

create table app.customer_enquiries (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references app.users(id),
  routed_org_id uuid not null references app.organizations(id),
  listing_kind text not null check (listing_kind in ('project','unit','rental')),
  project_id uuid references app.projects(id),
  unit_id uuid references app.units(id),
  rental_unit_id uuid references app.pm_units(id),
  -- What was asked about, as shown at the time (the listing may change or be withdrawn later).
  listing_title text not null check (length(listing_title) between 1 and 300),
  contact_name text not null check (length(contact_name) between 1 and 120),
  contact_email text not null check (length(contact_email) <= 254),
  contact_phone text check (contact_phone is null or length(contact_phone) between 6 and 24),
  preferred_contact text not null check (preferred_contact in ('email','phone','whatsapp')),
  locale text not null check (locale in ('en','ar')),
  message text check (message is null or length(message) <= 1000),
  source text not null check (source in ('listing_page','compare_page')),
  consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new','in_progress','closed')),
  status_updated_at timestamptz,
  status_updated_by uuid references app.users(id),
  check (preferred_contact = 'email' or contact_phone is not null)
);
create index customer_enquiries_customer on app.customer_enquiries (customer_user_id, created_at desc);
create index customer_enquiries_routed on app.customer_enquiries (routed_org_id, created_at desc);

create table app.appointment_requests (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references app.users(id),
  routed_org_id uuid not null references app.organizations(id),
  kind text not null check (kind in ('viewing','consultation')),
  listing_kind text not null check (listing_kind in ('project','unit','rental')),
  project_id uuid references app.projects(id),
  unit_id uuid references app.units(id),
  rental_unit_id uuid references app.pm_units(id),
  listing_title text not null check (length(listing_title) between 1 and 300),
  -- 1 to 3 preferred slots: [{ "date": "YYYY-MM-DD", "period": "morning"|"afternoon"|"evening" }]
  preferred_slots jsonb not null check (jsonb_typeof(preferred_slots) = 'array' and jsonb_array_length(preferred_slots) between 1 and 3),
  contact_name text not null check (length(contact_name) between 1 and 120),
  contact_email text not null check (length(contact_email) <= 254),
  contact_phone text check (contact_phone is null or length(contact_phone) between 6 and 24),
  preferred_contact text not null check (preferred_contact in ('email','phone','whatsapp')),
  locale text not null check (locale in ('en','ar')),
  note text check (note is null or length(note) <= 1000),
  consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- Pending until an authorized person confirms a time. Nothing here is a calendar booking.
  status text not null default 'pending' check (status in ('pending','confirmed','declined','cancelled')),
  confirmed_for timestamptz,
  org_note text check (org_note is null or length(org_note) <= 500),
  decided_at timestamptz,
  decided_by uuid references app.users(id),
  cancelled_at timestamptz,
  check (preferred_contact = 'email' or contact_phone is not null),
  check (status <> 'confirmed' or (confirmed_for is not null and decided_by is not null and decided_at is not null)),
  check (status <> 'declined' or (decided_by is not null and decided_at is not null))
);
create index appointment_requests_customer on app.appointment_requests (customer_user_id, created_at desc);
create index appointment_requests_routed on app.appointment_requests (routed_org_id, created_at desc);

create table app.support_requests (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references app.users(id),
  topic text not null check (topic in ('account','enquiry','appointment','listing','privacy','other')),
  subject text not null check (length(subject) between 1 and 160),
  message text not null check (length(message) between 1 and 2000),
  related_enquiry_id uuid references app.customer_enquiries(id),
  locale text not null check (locale in ('en','ar')),
  created_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open','answered','closed')),
  response text check (response is null or length(response) <= 2000),
  responded_at timestamptz,
  responded_by uuid references app.users(id),
  check (status <> 'answered' or (response is not null and responded_by is not null))
);
create index support_requests_customer on app.support_requests (customer_user_id, created_at desc);
create index support_requests_open on app.support_requests (status, created_at);

alter table app.customer_enquiries enable row level security;
alter table app.appointment_requests enable row level security;
alter table app.support_requests enable row level security;

create policy enquiries_customer on app.customer_enquiries for select to baytline_app using (customer_user_id = app.current_user_id());
create policy enquiries_routed_read on app.customer_enquiries for select to baytline_app
  using (app.owns(routed_org_id) and app.has_role_in_active_org(app.lead_roles()));
create policy enquiries_routed_update on app.customer_enquiries for update to baytline_app
  using (app.owns(routed_org_id) and app.has_role_in_active_org(app.lead_roles()))
  with check (app.owns(routed_org_id) and app.has_role_in_active_org(app.lead_roles()));
grant select on app.customer_enquiries to baytline_app;
grant update (status, status_updated_at, status_updated_by) on app.customer_enquiries to baytline_app;

create policy appointments_customer on app.appointment_requests for select to baytline_app using (customer_user_id = app.current_user_id());
create policy appointments_routed_read on app.appointment_requests for select to baytline_app
  using (app.owns(routed_org_id) and app.has_role_in_active_org(app.lead_roles()));
create policy appointments_routed_update on app.appointment_requests for update to baytline_app
  using (app.owns(routed_org_id) and app.has_role_in_active_org(app.viewing_roles()))
  with check (app.owns(routed_org_id) and app.has_role_in_active_org(app.viewing_roles()));
grant select on app.appointment_requests to baytline_app;
grant update (status, confirmed_for, org_note, decided_at, decided_by) on app.appointment_requests to baytline_app;

create policy support_customer on app.support_requests for select to baytline_app using (customer_user_id = app.current_user_id());
create policy support_staff_read on app.support_requests for select to baytline_app
  using (app.has_role_in_active_org(app.support_roles()) and exists (select 1 from app.organizations o where o.id = app.current_org_id() and o.type = 'platform'));
create policy support_staff_update on app.support_requests for update to baytline_app
  using (app.has_role_in_active_org(app.support_roles()) and exists (select 1 from app.organizations o where o.id = app.current_org_id() and o.type = 'platform'))
  with check (app.has_role_in_active_org(app.support_roles()));
grant select on app.support_requests to baytline_app;
grant update (status, response, responded_at, responded_by) on app.support_requests to baytline_app;

-- ---------------------------------------------------------------- submit functions

-- Resolves a published listing to its routing target and the title shown to the organization.
create function app.resolve_listing(p_kind text, p_id uuid, out routed_org uuid, out title text, out project uuid, out unit uuid, out rental uuid)
language plpgsql stable security definer set search_path = pg_catalog, app as $$
declare
  r record;
begin
  if p_kind = 'project' then
    select * into r from app.pub_projects where id = p_id;
    if not found then raise exception 'listing_not_found' using errcode = 'P0002'; end if;
    project := r.id; title := r.name;
    routed_org := r.owner_org_id;
    if r.route_brokerage_org_id is not null and exists (
         select 1 from app.project_shares s join app.organizations o on o.id = s.brokerage_org_id
          where s.project_id = r.id and s.brokerage_org_id = r.route_brokerage_org_id and s.status = 'active' and o.status = 'active') then
      routed_org := r.route_brokerage_org_id;
    end if;
  elsif p_kind = 'unit' then
    select u.id, u.project_id, u.project_name, u.code into r from app.pub_units u where u.id = p_id;
    if not found then raise exception 'listing_not_found' using errcode = 'P0002'; end if;
    select o.routed_org into routed_org from app.resolve_listing('project', r.project_id) o;
    project := r.project_id; unit := r.id; title := r.project_name || ' · ' || r.code;
  elsif p_kind = 'rental' then
    select * into r from app.pub_rentals where id = p_id;
    if not found then raise exception 'listing_not_found' using errcode = 'P0002'; end if;
    routed_org := r.owner_org_id; rental := r.id;
    title := r.property_name || coalesce(' · ' || r.area_label, '');
  else
    raise exception 'listing_kind' using errcode = '22023';
  end if;
end $$;

create function app.require_customer() returns app.users
language plpgsql stable security definer set search_path = pg_catalog, app as $$
declare
  u app.users;
begin
  select * into u from app.users where id = app.current_user_id() and status = 'active';
  if not found then raise exception 'not_signed_in' using errcode = '42501'; end if;
  return u;
end $$;

create function app.submit_enquiry(p_kind text, p_listing uuid, p_name text, p_phone text, p_contact text, p_locale text, p_message text, p_source text)
returns uuid
language plpgsql security definer set search_path = pg_catalog, app as $$
declare
  me app.users := app.require_customer();
  l record;
  v_id uuid;
begin
  if (select count(*) from app.customer_enquiries where customer_user_id = me.id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'throttled' using errcode = '54000';
  end if;
  select * into l from app.resolve_listing(p_kind, p_listing);
  insert into app.customer_enquiries (customer_user_id, routed_org_id, listing_kind, project_id, unit_id, rental_unit_id, listing_title,
         contact_name, contact_email, contact_phone, preferred_contact, locale, message, source, consent_at)
  values (me.id, l.routed_org, p_kind, l.project, l.unit, l.rental, l.title, btrim(p_name), me.email, nullif(btrim(coalesce(p_phone, '')), ''),
          p_contact, p_locale, nullif(btrim(coalesce(p_message, '')), ''), p_source, now())
  returning id into v_id;
  insert into app.audit_events (actor_user_id, org_id, event_type, outcome, target_type, target_id, metadata)
  values (me.id, l.routed_org, 'enquiry.received', 'success', 'enquiry', v_id::text, jsonb_build_object('kind', p_kind, 'source', p_source));
  return v_id;
end $$;

create function app.submit_appointment(p_kind text, p_listing uuid, p_type text, p_slots jsonb, p_name text, p_phone text, p_contact text, p_locale text, p_note text)
returns uuid
language plpgsql security definer set search_path = pg_catalog, app as $$
declare
  me app.users := app.require_customer();
  l record;
  s jsonb;
  v_id uuid;
begin
  if (select count(*) from app.appointment_requests where customer_user_id = me.id and created_at > now() - interval '1 day') >= 10 then
    raise exception 'throttled' using errcode = '54000';
  end if;
  if jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) not between 1 and 3 then raise exception 'slots' using errcode = '22023'; end if;
  for s in select * from jsonb_array_elements(p_slots) loop
    if (s->>'period') not in ('morning','afternoon','evening') or (s->>'date')::date < current_date or (s->>'date')::date > current_date + 90 then
      raise exception 'slots' using errcode = '22023';
    end if;
  end loop;
  select * into l from app.resolve_listing(p_kind, p_listing);
  insert into app.appointment_requests (customer_user_id, routed_org_id, kind, listing_kind, project_id, unit_id, rental_unit_id, listing_title,
         preferred_slots, contact_name, contact_email, contact_phone, preferred_contact, locale, note, consent_at)
  values (me.id, l.routed_org, p_type, p_kind, l.project, l.unit, l.rental, l.title, p_slots, btrim(p_name), me.email,
          nullif(btrim(coalesce(p_phone, '')), ''), p_contact, p_locale, nullif(btrim(coalesce(p_note, '')), ''), now())
  returning id into v_id;
  insert into app.audit_events (actor_user_id, org_id, event_type, outcome, target_type, target_id, metadata)
  values (me.id, l.routed_org, 'appointment.requested', 'success', 'appointment', v_id::text, jsonb_build_object('kind', p_type));
  return v_id;
end $$;

-- Customers may cancel their own pending or confirmed requests; nothing else about them changes.
create function app.cancel_appointment(p_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, app as $$
declare
  me app.users := app.require_customer();
  a record;
begin
  select * into a from app.appointment_requests where id = p_id and customer_user_id = me.id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.status not in ('pending','confirmed') then raise exception 'appointment_closed' using errcode = '22023'; end if;
  update app.appointment_requests set status = 'cancelled', cancelled_at = now() where id = p_id;
  insert into app.audit_events (actor_user_id, org_id, event_type, outcome, target_type, target_id, metadata)
  values (me.id, a.routed_org_id, 'appointment.cancelled', 'success', 'appointment', p_id::text, '{}'::jsonb);
end $$;

create function app.submit_support_request(p_topic text, p_subject text, p_message text, p_enquiry uuid, p_locale text) returns uuid
language plpgsql security definer set search_path = pg_catalog, app as $$
declare
  me app.users := app.require_customer();
  v_id uuid;
begin
  if (select count(*) from app.support_requests where customer_user_id = me.id and created_at > now() - interval '1 day') >= 10 then
    raise exception 'throttled' using errcode = '54000';
  end if;
  if p_enquiry is not null and not exists (select 1 from app.customer_enquiries where id = p_enquiry and customer_user_id = me.id) then
    raise exception 'related_enquiry' using errcode = '22023';
  end if;
  insert into app.support_requests (customer_user_id, topic, subject, message, related_enquiry_id, locale)
  values (me.id, p_topic, btrim(p_subject), btrim(p_message), p_enquiry, p_locale)
  returning id into v_id;
  insert into app.audit_events (actor_user_id, org_id, event_type, outcome, target_type, target_id, metadata)
  values (me.id, null, 'support.requested', 'success', 'support_request', v_id::text, jsonb_build_object('topic', p_topic));
  return v_id;
end $$;

revoke all on function app.resolve_listing(text, uuid), app.require_customer(), app.submit_enquiry(text, uuid, text, text, text, text, text, text),
  app.submit_appointment(text, uuid, text, jsonb, text, text, text, text, text), app.cancel_appointment(uuid),
  app.submit_support_request(text, text, text, uuid, text) from public;
grant execute on function app.submit_enquiry(text, uuid, text, text, text, text, text, text),
  app.submit_appointment(text, uuid, text, jsonb, text, text, text, text, text), app.cancel_appointment(uuid),
  app.submit_support_request(text, text, text, uuid, text) to baytline_app;
