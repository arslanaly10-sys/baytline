-- Milestone 9: authorized inventory sources and imports.
--
-- Every inventory update arrives through a SOURCE the developer owns: its own workspace edits, a partner
-- brokerage it authorized, structured file imports, an authorized data feed, or a direct integration.
-- Inbound data is staged as an IMPORT BATCH (mapped, validated, previewed) and changes nothing until an
-- authorized person confirms it. Prices and payment plans only ever arrive as DRAFT versions, which then
-- go through the existing two-person approval.
--
-- Credentials are never stored here: a source lists the NAMES of server-side secrets (environment
-- variables), and the app only reports whether each is present.

-- ---------------------------------------------------------------- sources

create table app.inventory_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  name text not null check (length(name) between 1 and 120),
  source_type text not null check (source_type in ('workspace','partner','file_import','data_feed','direct_integration')),
  -- Code adapter that connects to the provider (feeds and direct integrations only).
  adapter_key text check (adapter_key is null or adapter_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  partner_org_id uuid references app.organizations(id),
  all_projects boolean not null default false,
  authorization_status text not null default 'draft'
    check (authorization_status in ('draft','pending_approval','authorized','rejected','suspended','revoked')),
  -- What authorizes this source: an agreement, instruction or internal reference. Free text, no secrets.
  authorization_ref text check (authorization_ref is null or length(authorization_ref) <= 300),
  authorized_at timestamptz,
  authorized_by uuid references app.users(id),
  -- Platform decision for feeds and direct integrations.
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  decided_at timestamptz,
  decided_by uuid references app.users(id),
  -- Applied batches from a trusted, authorized source confirm availability as of the data's own time.
  trusted boolean not null default false,
  freshness_hours integer not null default 72 check (freshness_hours between 1 and 168),
  -- Non-secret settings for the adapter (validated in code). Never credentials.
  config jsonb not null default '{}'::jsonb,
  secret_names text[] not null default '{}',
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 300),
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id),
  updated_at timestamptz,
  updated_by uuid references app.users(id),
  check (source_type <> 'partner' or partner_org_id is not null),
  check (source_type = 'partner' or partner_org_id is null),
  check (source_type not in ('data_feed','direct_integration') or adapter_key is not null),
  check (source_type <> 'workspace' or all_projects),
  check (trusted = false or source_type in ('data_feed','direct_integration')),
  check (authorization_status <> 'authorized' or (authorized_at is not null)),
  check (cardinality(secret_names) <= 5)
);
create unique index inventory_sources_workspace on app.inventory_sources (org_id) where source_type = 'workspace';
create unique index inventory_sources_name on app.inventory_sources (org_id, lower(name));

-- Secret names: upper-case, and only from the FEED_ namespace, so a source can never point at platform secrets.
create function app.check_source() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
declare n text;
begin
  if (select type from app.organizations where id = new.org_id) <> 'developer' then
    raise exception 'not_developer' using errcode = '23514';
  end if;
  if new.partner_org_id is not null and (select type from app.organizations where id = new.partner_org_id) <> 'brokerage' then
    raise exception 'partner_not_brokerage' using errcode = '23514';
  end if;
  foreach n in array new.secret_names loop
    if n !~ '^FEED_[A-Z0-9_]{2,60}$' then raise exception 'secret_name' using errcode = '23514'; end if;
  end loop;
  return new;
end $$;
create trigger inventory_sources_check before insert or update on app.inventory_sources for each row execute function app.check_source();

create table app.inventory_source_projects (
  source_id uuid not null references app.inventory_sources(id),
  project_id uuid not null references app.projects(id),
  org_id uuid not null references app.organizations(id),
  primary key (source_id, project_id)
);
create trigger inventory_source_projects_org before insert or update on app.inventory_source_projects
  for each row execute function app.check_location_org();

-- Connection attempts for feeds and direct integrations. Summaries never contain secret values.
create table app.inventory_sync_runs (
  id bigint generated always as identity primary key,
  org_id uuid not null references app.organizations(id),
  source_id uuid not null references app.inventory_sources(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean not null,
  rows_received integer,
  summary text not null check (length(summary) <= 300),
  batch_id uuid,
  run_by uuid references app.users(id)
);
create index inventory_sync_runs_source on app.inventory_sync_runs (source_id, id desc);
create trigger inventory_sync_runs_append_only before update or delete on app.inventory_sync_runs
  for each row execute function app.append_only();

-- ---------------------------------------------------------------- staged imports

create table app.import_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  source_id uuid not null references app.inventory_sources(id),
  record_type text not null check (record_type in ('units','projects','prices','payment_plans')),
  status text not null default 'uploaded' check (status in ('submitted','uploaded','validated','applied','cancelled')),
  file_name text check (file_name is null or length(file_name) <= 200),
  headers text[] not null,
  raw_rows jsonb not null,
  row_count integer not null check (row_count between 1 and 2000),
  mapping jsonb,
  options jsonb not null default '{}'::jsonb,
  -- When the data was true according to whoever supplied it. Freshness counts from here, never from upload time.
  as_of timestamptz not null,
  note text check (note is null or length(note) <= 500),
  summary jsonb,
  -- Fingerprint of the validated preview; apply refuses if a fresh validation differs.
  preview_hash text,
  conflict_policy text check (conflict_policy is null or conflict_policy in ('skip','mark_disputed')),
  confirmed_verified boolean,
  submitted_by_org uuid references app.organizations(id),
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id),
  validated_at timestamptz,
  validated_by uuid references app.users(id),
  applied_at timestamptz,
  applied_by uuid references app.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references app.users(id),
  check (status <> 'applied' or (applied_at is not null and applied_by is not null))
);
create index import_batches_org on app.import_batches (org_id, created_at desc);
create index import_batches_source on app.import_batches (source_id, created_at desc);

create function app.check_batch() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if not exists (select 1 from app.inventory_sources s where s.id = new.source_id and s.org_id = new.org_id) then
    raise exception 'org_mismatch' using errcode = '23514';
  end if;
  -- Applied and cancelled batches are final.
  if tg_op = 'UPDATE' and old.status in ('applied','cancelled') then
    raise exception 'batch_final' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger import_batches_check before insert or update on app.import_batches for each row execute function app.check_batch();

create table app.import_rows (
  batch_id uuid not null references app.import_batches(id),
  org_id uuid not null references app.organizations(id),
  row_no integer not null,
  action text not null check (action in ('create','update','unchanged','error','duplicate','conflict')),
  target_type text,
  target_id uuid,
  target_label text,
  changes jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  primary key (batch_id, row_no)
);

-- ---------------------------------------------------------------- change history

alter table app.units add column source_id uuid references app.inventory_sources(id);
alter table app.unit_changes add column source_id uuid references app.inventory_sources(id);
alter table app.unit_changes add column batch_id uuid references app.import_batches(id);
alter table app.price_list_versions add column import_batch_id uuid references app.import_batches(id);
alter table app.payment_plan_versions add column import_batch_id uuid references app.import_batches(id);

create table app.project_changes (
  id bigint generated always as identity primary key,
  org_id uuid not null references app.organizations(id),
  project_id uuid not null references app.projects(id),
  at timestamptz not null default now(),
  actor_user_id uuid references app.users(id),
  field text not null,
  from_value jsonb,
  to_value jsonb,
  source_id uuid references app.inventory_sources(id),
  batch_id uuid references app.import_batches(id)
);
create index project_changes_project on app.project_changes (project_id, id desc);
create trigger project_changes_append_only before update or delete on app.project_changes
  for each row execute function app.append_only();

-- Every developer has a built-in "workspace edits" source. Existing units are attributed to it.
insert into app.inventory_sources (org_id, name, source_type, all_projects, authorization_status, authorization_ref, authorized_at, freshness_hours)
  select id, 'Workspace edits', 'workspace', true, 'authorized', 'Edits by the organization''s own team', now(), 24
    from app.organizations where type = 'developer';
update app.units u set source_id = s.id from app.inventory_sources s where s.org_id = u.org_id and s.source_type = 'workspace';

create function app.create_workspace_source() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if new.type = 'developer' then
    insert into app.inventory_sources (org_id, name, source_type, all_projects, authorization_status, authorization_ref, authorized_at, freshness_hours)
    values (new.id, 'Workspace edits', 'workspace', true, 'authorized', 'Edits by the organization''s own team', now(), 24);
  end if;
  return new;
end $$;
create trigger organizations_workspace_source after insert on app.organizations for each row execute function app.create_workspace_source();

-- ---------------------------------------------------------------- access

alter table app.inventory_sources enable row level security;
alter table app.inventory_source_projects enable row level security;
alter table app.inventory_sync_runs enable row level security;
alter table app.import_batches enable row level security;
alter table app.import_rows enable row level security;
alter table app.project_changes enable row level security;

create policy sources_owner on app.inventory_sources for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy source_projects_owner on app.inventory_source_projects for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy sync_runs_owner_read on app.inventory_sync_runs for select to baytline_app using (app.owns(org_id));
create policy sync_runs_owner_insert on app.inventory_sync_runs for insert to baytline_app with check (app.owns(org_id));
create policy batches_owner on app.import_batches for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy import_rows_owner on app.import_rows for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy project_changes_owner_read on app.project_changes for select to baytline_app using (app.owns(org_id));
create policy project_changes_owner_insert on app.project_changes for insert to baytline_app
  with check (app.owns(org_id) and actor_user_id = app.current_user_id());

-- A partner brokerage sees the sources that name it, their projects, and the batches it submitted. Nothing else.
create policy sources_partner on app.inventory_sources for select to baytline_app
  using (partner_org_id = app.current_org_id() and app.is_member(partner_org_id));
create policy source_projects_partner on app.inventory_source_projects for select to baytline_app
  using (exists (select 1 from app.inventory_sources s where s.id = source_id and s.partner_org_id = app.current_org_id()) and app.is_member(app.current_org_id()));
create policy batches_partner on app.import_batches for select to baytline_app
  using (submitted_by_org = app.current_org_id() and app.is_member(submitted_by_org));

-- Platform staff see source metadata (never inventory data) to review feeds and direct integrations.
create policy sources_platform on app.inventory_sources for select to baytline_app using (app.is_platform_staff());

grant select, insert, update on app.inventory_sources, app.import_batches to baytline_app;
grant select, insert, delete on app.inventory_source_projects, app.import_rows to baytline_app;
grant select, insert on app.inventory_sync_runs, app.project_changes to baytline_app;

-- Platform decision on a feed or direct integration. Only platform administrators; only pending or authorized sources.
create function app.decide_inventory_source(p_source uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = pg_catalog, app as $$
declare v app.inventory_sources;
begin
  if not app.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v from app.inventory_sources where id = p_source for update;
  if v.id is null or v.source_type not in ('data_feed','direct_integration') then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_decision = 'approve' and v.authorization_status = 'pending_approval' then
    update app.inventory_sources set authorization_status = 'authorized', authorized_at = now(), authorized_by = app.current_user_id(),
           decision_note = p_note, decided_at = now(), decided_by = app.current_user_id() where id = p_source;
  elsif p_decision = 'reject' and v.authorization_status = 'pending_approval' then
    update app.inventory_sources set authorization_status = 'rejected', decision_note = p_note, decided_at = now(), decided_by = app.current_user_id() where id = p_source;
  elsif p_decision = 'suspend' and v.authorization_status = 'authorized' then
    update app.inventory_sources set authorization_status = 'suspended', decision_note = p_note, decided_at = now(), decided_by = app.current_user_id() where id = p_source;
  else
    raise exception 'invalid_transition' using errcode = '23514';
  end if;
end $$;
revoke all on function app.decide_inventory_source(uuid, text, text) from public;
grant execute on function app.decide_inventory_source(uuid, text, text) to baytline_app;

-- A partner brokerage submits an update for review. It changes no inventory: the developer validates and confirms it.
create function app.partner_update_roles() returns text[] language sql immutable as $$
  select array['brokerage_admin','brokerage_manager']
$$;

create function app.submit_partner_update(p_source uuid, p_project uuid, p_headers text[], p_rows jsonb, p_as_of timestamptz, p_note text) returns uuid
language plpgsql security definer set search_path = pg_catalog, app as $$
declare v app.inventory_sources; v_id uuid; v_n integer;
begin
  if not app.has_role_in_active_org(app.partner_update_roles()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v from app.inventory_sources where id = p_source;
  if v.id is null or v.partner_org_id is distinct from app.current_org_id() then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v.authorization_status <> 'authorized' then raise exception 'source_not_authorized' using errcode = '23514'; end if;
  if not (v.all_projects or exists (select 1 from app.inventory_source_projects sp where sp.source_id = v.id and sp.project_id = p_project)) then
    raise exception 'project_not_in_source' using errcode = '23514';
  end if;
  if not exists (select 1 from app.project_shares s where s.project_id = p_project and s.brokerage_org_id = app.current_org_id() and s.status = 'active') then
    raise exception 'project_not_shared' using errcode = '23514';
  end if;
  v_n := jsonb_array_length(p_rows);
  if v_n < 1 or v_n > 200 then raise exception 'row_count' using errcode = '23514'; end if;
  if p_as_of > now() + interval '5 minutes' then raise exception 'as_of_future' using errcode = '23514'; end if;
  -- Rate limit: a partner can't flood the developer's review queue.
  if (select count(*) from app.import_batches where submitted_by_org = app.current_org_id() and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'rate_limited' using errcode = '23514';
  end if;
  insert into app.import_batches (org_id, source_id, record_type, status, headers, raw_rows, row_count, mapping, options, as_of, note, submitted_by_org, created_by)
  values (v.org_id, v.id, 'units', 'submitted', p_headers, p_rows, v_n, null, jsonb_build_object('project_id', p_project), p_as_of, p_note, app.current_org_id(), app.current_user_id())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function app.submit_partner_update(uuid, uuid, text[], jsonb, timestamptz, text) from public;
grant execute on function app.submit_partner_update(uuid, uuid, text[], jsonb, timestamptz, text) to baytline_app;

-- ---------------------------------------------------------------- public freshness

-- Public availability uses the source's freshness window, and ignores confirmations from sources that are no longer authorized.
create or replace view app.pub_units with (security_barrier) as
  select u.id, u.project_id, pp.name as project_name, pp.owner_name, pp.market, pp.city, pp.location, ph.name as phase_name,
         ph.expected_handover::text as phase_expected_handover, u.code, u.property_type, u.bedrooms, u.area_sqm::text as area_sqm,
         u.floor, u.status, u.source_kind, u.last_updated_at, u.verification, u.last_verified_at,
         case when pp.show_prices then cp.price_minor end as price_minor,
         case when pp.show_prices then cp.currency end as price_currency,
         case when pp.show_prices then cp.effective_from end as price_effective_from,
         pp.handover_date::text as project_handover_date, pp.listing_updated_at,
         src.freshness_hours as source_freshness_hours,
         coalesce(src.authorization_status = 'authorized', true) as source_authorized
    from app.project_publication_units pu
    join app.pub_projects pp on pp.id = pu.project_id
    join app.units u on u.id = pu.unit_id
    left join app.project_phases ph on ph.id = u.phase_id
    left join app.inventory_sources src on src.id = u.source_id
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

-- The platform-wide switch for feeds (Integrations → developer_feeds). Feeds are on unless an administrator turned them off.
create function app.feeds_enabled() returns boolean
language sql stable security definer set search_path = pg_catalog, app as $$
  select coalesce((select enabled from app.integration_settings where provider_key = 'developer_feeds'), true)
$$;
revoke all on function app.feeds_enabled() from public;
grant execute on function app.feeds_enabled() to baytline_app;

-- A partner brokerage may know the name of a developer that named it on a source. Nothing else about that developer.
create function app.partner_developer_name(p_org uuid) returns text
language sql stable security definer set search_path = pg_catalog, app as $$
  select o.name from app.organizations o
   where o.id = p_org and app.is_member(app.current_org_id())
     and exists (select 1 from app.inventory_sources s where s.org_id = p_org and s.partner_org_id = app.current_org_id())
$$;
revoke all on function app.partner_developer_name(uuid) from public;
grant execute on function app.partner_developer_name(uuid) to baytline_app;
