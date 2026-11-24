-- Milestone 12: leads, matching and brokerage.
--
-- Leads (captured from customer enquiries and appointments, or entered by staff), viewings, deals,
-- client registrations with protection periods (brokerage -> developer) and commission claims with
-- two-person approval (brokerage submits, a developer approver decides). Scores are computed in code
-- from recorded facts; only staff overrides are stored, with their reason.

-- Roles that handle every lead in their organization. Brokerage agents see only leads assigned to them.
create function app.lead_admin_roles() returns text[] language sql immutable as $$
  select array['brokerage_admin','brokerage_manager','developer_admin','developer_sales_manager']
$$;
create function app.registration_review_roles() returns text[] language sql immutable as $$
  select array['developer_admin','developer_sales_manager']
$$;
create function app.registration_submit_roles() returns text[] language sql immutable as $$
  select array['brokerage_admin','brokerage_manager','brokerage_agent']
$$;
create function app.commission_approve_roles() returns text[] language sql immutable as $$
  select array['developer_admin','developer_finance']
$$;
grant execute on function app.lead_admin_roles(), app.registration_review_roles(), app.registration_submit_roles(), app.commission_approve_roles() to baytline_app;

-- ---------------------------------------------------------------- leads

create table app.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  source text not null check (source in ('enquiry','appointment','manual')),
  enquiry_id uuid references app.customer_enquiries(id),
  appointment_id uuid references app.appointment_requests(id),
  contact_name text not null check (length(contact_name) between 1 and 120),
  contact_email text check (contact_email is null or length(contact_email) <= 254),
  contact_phone text check (contact_phone is null or length(contact_phone) between 6 and 24),
  preferred_contact text check (preferred_contact is null or preferred_contact in ('email','phone','whatsapp')),
  locale text check (locale is null or locale in ('en','ar')),
  -- Consent recorded with the customer's request; manual leads record who confirmed consent and when.
  consent_at timestamptz not null,
  interest text check (interest is null or length(interest) <= 300),
  status text not null default 'new' check (status in ('new','contacted','qualified','viewing','negotiating','won','lost','archived')),
  lost_reason text check (lost_reason is null or length(lost_reason) <= 300),
  assignee_user_id uuid references app.users(id),
  -- Requirements, as the customer stated them.
  budget_min_minor bigint check (budget_min_minor is null or budget_min_minor >= 0),
  budget_max_minor bigint check (budget_max_minor is null or budget_max_minor > 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  property_types text[] not null default '{}',
  bedrooms_min smallint check (bedrooms_min is null or bedrooms_min between 0 and 20),
  city text check (city is null or length(city) <= 80),
  timeline text not null default 'unknown' check (timeline in ('now','3_months','6_months','12_months','unknown')),
  financing text not null default 'unknown' check (financing in ('cash','mortgage','unknown')),
  requirements_note text check (requirements_note is null or length(requirements_note) <= 1000),
  -- Staff override of the computed score: always with a reason, always in the timeline.
  override_band text check (override_band is null or override_band in ('hot','warm','cold')),
  override_reason text check (override_reason is null or length(override_reason) between 3 and 300),
  override_by uuid references app.users(id),
  override_at timestamptz,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id),
  updated_at timestamptz,
  updated_by uuid references app.users(id),
  check (contact_email is not null or contact_phone is not null),
  check (budget_min_minor is null or budget_max_minor is null or budget_min_minor <= budget_max_minor),
  check ((budget_min_minor is null and budget_max_minor is null) or currency is not null),
  check ((override_band is null) = (override_reason is null)),
  check (status <> 'lost' or lost_reason is not null)
);
create unique index leads_from_enquiry on app.leads (org_id, enquiry_id) where enquiry_id is not null;
create unique index leads_from_appointment on app.leads (org_id, appointment_id) where appointment_id is not null;
create index leads_org on app.leads (org_id, status, last_activity_at desc);

-- A lead's source request must have been routed to the same organization.
create function app.check_lead_source() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if (select type from app.organizations where id = new.org_id) not in ('developer','brokerage') then
    raise exception 'not_lead_org' using errcode = '23514';
  end if;
  if new.enquiry_id is not null and not exists (select 1 from app.customer_enquiries e where e.id = new.enquiry_id and e.routed_org_id = new.org_id) then
    raise exception 'org_mismatch' using errcode = '23514';
  end if;
  if new.appointment_id is not null and not exists (select 1 from app.appointment_requests a where a.id = new.appointment_id and a.routed_org_id = new.org_id) then
    raise exception 'org_mismatch' using errcode = '23514';
  end if;
  if new.assignee_user_id is not null and not exists (
       select 1 from app.memberships m where m.org_id = new.org_id and m.user_id = new.assignee_user_id and m.status = 'active') then
    raise exception 'assignee_not_member' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger leads_check before insert or update on app.leads for each row execute function app.check_lead_source();

create table app.lead_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references app.organizations(id),
  lead_id uuid not null references app.leads(id),
  at timestamptz not null default now(),
  actor_user_id uuid references app.users(id),
  kind text not null check (kind in ('created','status','assigned','requirements','note','score_override','viewing','registration','deal','commission')),
  detail jsonb not null default '{}'::jsonb
);
create index lead_events_lead on app.lead_events (lead_id, id desc);
create trigger lead_events_append_only before update or delete on app.lead_events for each row execute function app.append_only();

-- ---------------------------------------------------------------- viewings

create table app.viewings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  lead_id uuid not null references app.leads(id),
  project_id uuid not null references app.projects(id),
  unit_id uuid references app.units(id),
  appointment_id uuid references app.appointment_requests(id),
  scheduled_for timestamptz not null,
  time_zone text not null,
  status text not null default 'scheduled' check (status in ('scheduled','completed','no_show','cancelled')),
  outcome text check (outcome is null or length(outcome) <= 1000),
  assignee_user_id uuid references app.users(id),
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id),
  updated_at timestamptz,
  updated_by uuid references app.users(id)
);
create index viewings_org on app.viewings (org_id, scheduled_for);

-- ---------------------------------------------------------------- client registrations (brokerage -> developer)

create table app.client_registrations (
  id uuid primary key default gen_random_uuid(),
  brokerage_org_id uuid not null references app.organizations(id),
  developer_org_id uuid not null references app.organizations(id),
  project_id uuid not null references app.projects(id),
  lead_id uuid not null references app.leads(id),
  client_name text not null check (length(client_name) between 1 and 120),
  -- For duplicate detection without showing one brokerage's clients to another: hashes of the
  -- normalized email and phone, plus masked forms the developer can recognise.
  email_hash text,
  phone_hash text,
  email_masked text,
  phone_masked text,
  note text check (note is null or length(note) <= 500),
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','withdrawn')),
  protection_days integer check (protection_days is null or protection_days between 1 and 365),
  protected_from timestamptz,
  protected_until timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  decided_by uuid references app.users(id),
  decided_at timestamptz,
  submitted_by uuid not null references app.users(id),
  submitted_at timestamptz not null default now(),
  check (email_hash is not null or phone_hash is not null),
  check (status <> 'approved' or (protection_days is not null and protected_from is not null and protected_until is not null and decided_by is not null)),
  check (status <> 'rejected' or (decided_by is not null and decision_note is not null))
);
create index client_registrations_project on app.client_registrations (project_id, status);
create index client_registrations_brokerage on app.client_registrations (brokerage_org_id, submitted_at desc);

-- ---------------------------------------------------------------- deals

create table app.deals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  lead_id uuid not null references app.leads(id),
  project_id uuid not null references app.projects(id),
  unit_id uuid not null references app.units(id),
  registration_id uuid references app.client_registrations(id),
  stage text not null default 'negotiating' check (stage in ('negotiating','reserved','contracted','won','lost')),
  -- What the parties agreed, as recorded by staff. Baytline calculates no prices.
  agreed_price_minor bigint check (agreed_price_minor is null or agreed_price_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- The approved list price and the unit's inventory label when the deal was opened, for the record.
  list_price_minor bigint,
  list_price_version_id uuid references app.price_list_versions(id),
  availability_label text not null check (availability_label in ('live','recently_confirmed','stale','unverified','disputed')),
  note text check (note is null or length(note) <= 1000),
  lost_reason text check (lost_reason is null or length(lost_reason) <= 300),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id),
  updated_at timestamptz,
  updated_by uuid references app.users(id),
  check (stage <> 'lost' or lost_reason is not null),
  check (stage <> 'won' or agreed_price_minor is not null)
);
create index deals_org on app.deals (org_id, stage, created_at desc);

create function app.check_deal() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if not exists (select 1 from app.leads l where l.id = new.lead_id and l.org_id = new.org_id) then raise exception 'org_mismatch' using errcode = '23514'; end if;
  if not exists (select 1 from app.units u where u.id = new.unit_id and u.project_id = new.project_id and not u.is_sample) then raise exception 'unit' using errcode = '23514'; end if;
  if new.registration_id is not null and not exists (
       select 1 from app.client_registrations r where r.id = new.registration_id and r.brokerage_org_id = new.org_id and r.project_id = new.project_id and r.lead_id = new.lead_id) then
    raise exception 'registration' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger deals_check before insert or update on app.deals for each row execute function app.check_deal();

create function app.check_viewing() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if not exists (select 1 from app.leads l where l.id = new.lead_id and l.org_id = new.org_id) then raise exception 'org_mismatch' using errcode = '23514'; end if;
  if new.unit_id is not null and not exists (select 1 from app.units u where u.id = new.unit_id and u.project_id = new.project_id) then raise exception 'unit' using errcode = '23514'; end if;
  return new;
end $$;
create trigger viewings_check before insert or update on app.viewings for each row execute function app.check_viewing();

-- ---------------------------------------------------------------- commission claims (brokerage claims, developer approves)

create table app.commission_claims (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references app.deals(id),
  claimant_org_id uuid not null references app.organizations(id),
  payer_org_id uuid not null references app.organizations(id),
  registration_id uuid not null references app.client_registrations(id),
  -- What the developer sees, captured when submitted.
  project_name text not null,
  unit_code text not null,
  client_name text not null,
  claimant_name text not null,
  deal_price_minor bigint not null check (deal_price_minor > 0),
  currency text not null,
  basis text not null check (basis in ('percent','fixed')),
  rate_percent numeric(6,3) check (rate_percent is null or (rate_percent > 0 and rate_percent <= 100)),
  amount_minor bigint not null check (amount_minor > 0),
  note text check (note is null or length(note) <= 500),
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','withdrawn')),
  submitted_by uuid not null references app.users(id),
  submitted_at timestamptz not null default now(),
  decided_by uuid references app.users(id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  check ((basis = 'percent') = (rate_percent is not null)),
  -- Two people, always: whoever approves or rejects never submitted the claim.
  check (decided_by is null or decided_by <> submitted_by),
  check ((status in ('approved','rejected')) = (decided_by is not null and decided_at is not null)),
  check (status <> 'rejected' or decision_note is not null)
);
create unique index commission_claims_one_open on app.commission_claims (deal_id) where status in ('submitted','approved');

-- ---------------------------------------------------------------- access

alter table app.leads enable row level security;
alter table app.lead_events enable row level security;
alter table app.viewings enable row level security;
alter table app.client_registrations enable row level security;
alter table app.deals enable row level security;
alter table app.commission_claims enable row level security;

-- Lead admins see every lead; anyone else in the organization only the ones assigned to them.
create function app.lead_visible(p_org uuid, p_assignee uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, app as $$
  select app.owns(p_org) and (app.has_role_in_active_org(app.lead_admin_roles()) or p_assignee = app.current_user_id())
$$;
grant execute on function app.lead_visible(uuid, uuid) to baytline_app;

create policy leads_rw on app.leads for all to baytline_app using (app.lead_visible(org_id, assignee_user_id)) with check (app.lead_visible(org_id, assignee_user_id));
create policy lead_events_read on app.lead_events for select to baytline_app
  using (exists (select 1 from app.leads l where l.id = lead_id and app.lead_visible(l.org_id, l.assignee_user_id)));
create policy lead_events_insert on app.lead_events for insert to baytline_app
  with check (app.owns(org_id) and actor_user_id = app.current_user_id() and exists (select 1 from app.leads l where l.id = lead_id and app.lead_visible(l.org_id, l.assignee_user_id)));
create policy viewings_rw on app.viewings for all to baytline_app
  using (exists (select 1 from app.leads l where l.id = lead_id and app.lead_visible(l.org_id, l.assignee_user_id)))
  with check (app.owns(org_id) and exists (select 1 from app.leads l where l.id = lead_id and app.lead_visible(l.org_id, l.assignee_user_id)));
create policy deals_rw on app.deals for all to baytline_app
  using (exists (select 1 from app.leads l where l.id = lead_id and app.lead_visible(l.org_id, l.assignee_user_id)))
  with check (app.owns(org_id) and exists (select 1 from app.leads l where l.id = lead_id and app.lead_visible(l.org_id, l.assignee_user_id)));
grant select, insert, update on app.leads, app.viewings, app.deals to baytline_app;
grant select, insert on app.lead_events to baytline_app;

-- Registrations: the brokerage sees its own; the developer sees those for its projects. Writes go through functions.
create policy registrations_brokerage on app.client_registrations for select to baytline_app using (app.owns(brokerage_org_id));
create policy registrations_developer on app.client_registrations for select to baytline_app using (app.owns(developer_org_id));
grant select on app.client_registrations to baytline_app;

-- Claims: claimant and payer see them. Writes go through functions.
create policy claims_claimant on app.commission_claims for select to baytline_app using (app.owns(claimant_org_id));
create policy claims_payer on app.commission_claims for select to baytline_app using (app.owns(payer_org_id));
grant select on app.commission_claims to baytline_app;

-- ---------------------------------------------------------------- registration functions

create function app.submit_client_registration(p_lead uuid, p_project uuid, p_email_hash text, p_phone_hash text, p_email_masked text, p_phone_masked text, p_note text)
returns uuid language plpgsql security definer set search_path = pg_catalog, app as $$
declare v_lead app.leads; v_dev uuid; v_id uuid;
begin
  if not app.has_role_in_active_org(app.registration_submit_roles()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_lead from app.leads where id = p_lead;
  if v_lead.id is null or v_lead.org_id <> app.current_org_id() or not app.lead_visible(v_lead.org_id, v_lead.assignee_user_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select p.org_id into v_dev from app.projects p
   where p.id = p_project and not p.is_sample
     and exists (select 1 from app.project_shares s where s.project_id = p.id and s.brokerage_org_id = app.current_org_id() and s.status = 'active');
  if v_dev is null then raise exception 'project_not_shared' using errcode = '23514'; end if;
  -- One open registration per lead and project from this brokerage.
  if exists (select 1 from app.client_registrations r where r.lead_id = p_lead and r.project_id = p_project and r.status = 'submitted'
             or (r.lead_id = p_lead and r.project_id = p_project and r.status = 'approved' and r.protected_until > now())) then
    raise exception 'already_registered' using errcode = '23505';
  end if;
  insert into app.client_registrations (brokerage_org_id, developer_org_id, project_id, lead_id, client_name, email_hash, phone_hash, email_masked, phone_masked, note, submitted_by)
  values (app.current_org_id(), v_dev, p_project, p_lead, v_lead.contact_name, p_email_hash, p_phone_hash, p_email_masked, p_phone_masked, p_note, app.current_user_id())
  returning id into v_id;
  return v_id;
end $$;

-- The developer decides. An approval starts the protection period now. A client already protected for
-- this project by another brokerage (same email or phone) can't be approved twice.
create function app.decide_client_registration(p_id uuid, p_decision text, p_days integer, p_note text) returns void
language plpgsql security definer set search_path = pg_catalog, app as $$
declare v app.client_registrations;
begin
  if not app.has_role_in_active_org(app.registration_review_roles()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v from app.client_registrations where id = p_id for update;
  if v.id is null or v.developer_org_id <> app.current_org_id() then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v.status <> 'submitted' then raise exception 'not_pending' using errcode = '23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended('registration:' || v.project_id::text, 0));
  if p_decision = 'approve' then
    if p_days is null or p_days < 1 or p_days > 365 then raise exception 'protection_days' using errcode = '22023'; end if;
    if exists (select 1 from app.client_registrations o
                where o.project_id = v.project_id and o.id <> v.id and o.status = 'approved' and o.protected_until > now()
                  and ((v.email_hash is not null and o.email_hash = v.email_hash) or (v.phone_hash is not null and o.phone_hash = v.phone_hash))) then
      raise exception 'already_protected' using errcode = '23505';
    end if;
    update app.client_registrations set status = 'approved', protection_days = p_days, protected_from = now(), protected_until = now() + make_interval(days => p_days),
           decided_by = app.current_user_id(), decided_at = now(), decision_note = p_note where id = p_id;
  elsif p_decision = 'reject' then
    if p_note is null or length(p_note) < 1 then raise exception 'decision_note_required' using errcode = '22023'; end if;
    update app.client_registrations set status = 'rejected', decided_by = app.current_user_id(), decided_at = now(), decision_note = p_note where id = p_id;
  else
    raise exception 'decision' using errcode = '22023';
  end if;
end $$;

create function app.withdraw_client_registration(p_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if not app.has_role_in_active_org(app.registration_submit_roles()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update app.client_registrations set status = 'withdrawn' where id = p_id and brokerage_org_id = app.current_org_id() and status = 'submitted';
  if not found then raise exception 'not_pending' using errcode = '23514'; end if;
end $$;

-- ---------------------------------------------------------------- commission claim functions

-- A brokerage claims commission on a deal it won, backed by a registration that was protecting the
-- client for that project when the deal was made. The amount is recorded as agreed; the developer decides.
create function app.submit_commission_claim(p_deal uuid, p_basis text, p_rate numeric, p_amount bigint, p_note text) returns uuid
language plpgsql security definer set search_path = pg_catalog, app as $$
declare d app.deals; r app.client_registrations; v_id uuid; v_project text; v_unit text; v_brokerage text;
begin
  if not app.has_role_in_active_org(array['brokerage_admin','brokerage_manager']) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into d from app.deals where id = p_deal;
  if d.id is null or d.org_id <> app.current_org_id() then raise exception 'not_found' using errcode = 'P0002'; end if;
  if d.stage <> 'won' or d.agreed_price_minor is null then raise exception 'deal_not_won' using errcode = '23514'; end if;
  select * into r from app.client_registrations where id = d.registration_id;
  if r.id is null or r.status <> 'approved' or d.created_at < r.protected_from or d.created_at > r.protected_until then
    raise exception 'no_protection' using errcode = '23514';
  end if;
  select p.name into v_project from app.projects p where p.id = d.project_id;
  select u.code into v_unit from app.units u where u.id = d.unit_id;
  select o.name into v_brokerage from app.organizations o where o.id = d.org_id;
  insert into app.commission_claims (deal_id, claimant_org_id, payer_org_id, registration_id, project_name, unit_code, client_name, claimant_name,
                                     deal_price_minor, currency, basis, rate_percent, amount_minor, note, submitted_by)
  values (d.id, d.org_id, r.developer_org_id, r.id, v_project, v_unit, r.client_name, v_brokerage, d.agreed_price_minor, d.currency, p_basis, p_rate, p_amount, p_note, app.current_user_id())
  returning id into v_id;
  return v_id;
end $$;

create function app.decide_commission_claim(p_id uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = pg_catalog, app as $$
declare v app.commission_claims;
begin
  if not app.has_role_in_active_org(app.commission_approve_roles()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v from app.commission_claims where id = p_id for update;
  if v.id is null or v.payer_org_id <> app.current_org_id() then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v.status <> 'submitted' then raise exception 'not_pending' using errcode = '23514'; end if;
  if v.submitted_by = app.current_user_id() then raise exception 'own_submission' using errcode = '42501'; end if;
  if p_decision = 'approve' then
    update app.commission_claims set status = 'approved', decided_by = app.current_user_id(), decided_at = now(), decision_note = p_note where id = p_id;
  elsif p_decision = 'reject' then
    if p_note is null or length(p_note) < 1 then raise exception 'decision_note_required' using errcode = '22023'; end if;
    update app.commission_claims set status = 'rejected', decided_by = app.current_user_id(), decided_at = now(), decision_note = p_note where id = p_id;
  else
    raise exception 'decision' using errcode = '22023';
  end if;
end $$;

create function app.withdraw_commission_claim(p_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if not app.has_role_in_active_org(array['brokerage_admin','brokerage_manager']) then raise exception 'forbidden' using errcode = '42501'; end if;
  update app.commission_claims set status = 'withdrawn' where id = p_id and claimant_org_id = app.current_org_id() and status = 'submitted';
  if not found then raise exception 'not_pending' using errcode = '23514'; end if;
end $$;

revoke all on function app.submit_client_registration(uuid, uuid, text, text, text, text, text), app.decide_client_registration(uuid, text, integer, text),
  app.withdraw_client_registration(uuid), app.submit_commission_claim(uuid, text, numeric, bigint, text), app.decide_commission_claim(uuid, text, text),
  app.withdraw_commission_claim(uuid) from public;
grant execute on function app.submit_client_registration(uuid, uuid, text, text, text, text, text), app.decide_client_registration(uuid, text, integer, text),
  app.withdraw_client_registration(uuid), app.submit_commission_claim(uuid, text, numeric, bigint, text), app.decide_commission_claim(uuid, text, text),
  app.withdraw_commission_claim(uuid) to baytline_app;

-- A brokerage may know the name of a developer that shares (or shared) a project with it. Nothing else about it.
create function app.sharing_developer_name(p_org uuid) returns text
language sql stable security definer set search_path = pg_catalog, app as $$
  select o.name from app.organizations o
   where o.id = p_org and app.is_member(app.current_org_id())
     and exists (select 1 from app.project_shares s where s.org_id = p_org and s.brokerage_org_id = app.current_org_id())
$$;
revoke all on function app.sharing_developer_name(uuid) from public;
grant execute on function app.sharing_developer_name(uuid) to baytline_app;
