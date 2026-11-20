-- Milestone 4: developer workspace — projects, phases, units, price lists, payment plans,
-- documents and project sharing with brokerage partners.
--
-- Isolation model
--   * Every row carries org_id = the developer that owns it.
--   * Members of that developer (active org) read and write; fine-grained role checks are in @baytline/developer.
--   * A brokerage sees a project only through an ACTIVE share granted to it, and pricing/documents only
--     when that share includes them. Platform staff get no access to developer business data.

-- ---------------------------------------------------------------- helpers

-- Writable/readable by the owning developer, in its active-org context.
create function app.owns(p_org uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, app as $$
  select p_org = app.current_org_id() and app.is_member(p_org)
$$;


-- ---------------------------------------------------------------- projects and phases

create table app.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  name text not null check (length(name) between 1 and 160),
  market text not null references app.markets(code),
  city text not null check (length(city) between 1 and 80),
  location text check (location is null or length(location) <= 200),
  property_types text[] not null check (cardinality(property_types) >= 1 and property_types <@
    array['apartment','villa','townhouse','penthouse','duplex','office','retail','plot']),
  description text check (description is null or length(description) <= 4000),
  launch_date date,
  handover_date date,
  status text not null default 'planning' check (status in ('planning','pre_launch','launched','under_construction','completed','on_hold','cancelled')),
  -- Development-only sample records. Always labelled, never presented as real inventory.
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id),
  updated_at timestamptz,
  updated_by uuid references app.users(id),
  check (handover_date is null or launch_date is null or handover_date >= launch_date)
);
create index projects_org on app.projects (org_id, name);

create table app.project_phases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  project_id uuid not null references app.projects(id),
  kind text not null check (kind in ('building','phase')),
  name text not null check (length(name) between 1 and 120),
  expected_handover date,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id),
  updated_at timestamptz,
  updated_by uuid references app.users(id),
  unique (project_id, name)
);

-- ---------------------------------------------------------------- units with provenance

create table app.units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  project_id uuid not null references app.projects(id),
  phase_id uuid references app.project_phases(id),
  code text not null check (length(code) between 1 and 40),
  property_type text not null check (property_type in ('apartment','villa','townhouse','penthouse','duplex','office','retail','plot')),
  bedrooms smallint check (bedrooms is null or bedrooms between 0 and 20), -- 0 = studio
  area_sqm numeric(10,2) check (area_sqm is null or area_sqm > 0),
  floor smallint check (floor is null or floor between -5 and 200),
  status text not null default 'draft' check (status in ('draft','available','reserved','sold','unavailable')),
  -- Provenance (see @baytline/core provenance.ts). Entered in this workspace = partner_portal.
  source_kind text not null default 'partner_portal' check (source_kind in ('developer_api','partner_feed','structured_import','partner_portal','manual_entry')),
  source_ref text check (source_ref is null or length(source_ref) <= 120),
  last_updated_at timestamptz not null default now(),
  verification text not null default 'owner_reported' check (verification in ('verified','owner_reported','pending','unverified','disputed')),
  last_verified_at timestamptz,
  verified_by uuid references app.users(id),
  version integer not null default 1,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id),
  unique (project_id, code),
  check (verification <> 'verified' or (last_verified_at is not null and verified_by is not null))
);
create index units_project on app.units (project_id, code);

-- Field-level history, append-only.
create table app.unit_changes (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  unit_id uuid not null references app.units(id),
  version integer not null,
  at timestamptz not null default now(),
  actor_user_id uuid references app.users(id),
  field text not null,
  from_value jsonb,
  to_value jsonb,
  source_kind text not null
);
create index unit_changes_unit on app.unit_changes (unit_id, id desc);
create trigger unit_changes_append_only before update or delete on app.unit_changes
  for each row execute function app.append_only();

-- A unit's phase must belong to the same project.
create function app.check_unit_phase() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if new.phase_id is not null and not exists (select 1 from app.project_phases p where p.id = new.phase_id and p.project_id = new.project_id) then
    raise exception 'phase_not_in_project' using errcode = '23514';
  end if;
  if new.org_id is distinct from (select org_id from app.projects where id = new.project_id) then
    raise exception 'org_mismatch' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger units_phase_check before insert or update of phase_id, project_id, org_id on app.units
  for each row execute function app.check_unit_phase();

-- ---------------------------------------------------------------- versioned price lists

create table app.price_lists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  project_id uuid not null references app.projects(id),
  name text not null check (length(name) between 1 and 120),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id),
  unique (project_id, name)
);

create table app.price_list_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  price_list_id uuid not null references app.price_lists(id),
  version integer not null,
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','superseded')),
  effective_from date not null,
  effective_to date,
  notes text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id),
  submitted_at timestamptz,
  submitted_by uuid references app.users(id),
  decided_at timestamptz,
  decided_by uuid references app.users(id),
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  unique (price_list_id, version),
  check (effective_to is null or effective_to >= effective_from),
  -- Separation of duties, enforced by the database: the approver is never the submitter.
  check (decided_by is null or submitted_by is null or decided_by <> submitted_by)
);

create table app.price_list_entries (
  org_id uuid not null references app.organizations(id),
  version_id uuid not null references app.price_list_versions(id),
  unit_id uuid not null references app.units(id),
  price_minor bigint not null check (price_minor > 0),
  primary key (version_id, unit_id)
);

-- ---------------------------------------------------------------- versioned payment plans

create table app.payment_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  project_id uuid not null references app.projects(id),
  name text not null check (length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id),
  unique (project_id, name)
);

create table app.payment_plan_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  plan_id uuid not null references app.payment_plans(id),
  version integer not null,
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','superseded')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  effective_from date not null,
  effective_to date,
  -- The developer's own wording about handover. Stored as provided; the platform adds no terms.
  handover_terms text check (handover_terms is null or length(handover_terms) <= 2000),
  notes text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id),
  submitted_at timestamptz,
  submitted_by uuid references app.users(id),
  decided_at timestamptz,
  decided_by uuid references app.users(id),
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  unique (plan_id, version),
  check (effective_to is null or effective_to >= effective_from),
  check (decided_by is null or submitted_by is null or decided_by <> submitted_by)
);

create table app.payment_plan_milestones (
  org_id uuid not null references app.organizations(id),
  version_id uuid not null references app.payment_plan_versions(id),
  seq smallint not null check (seq between 1 and 60),
  label text not null check (length(label) between 1 and 120),
  trigger_kind text not null check (trigger_kind in ('on_booking','on_date','construction_progress','on_handover','after_handover')),
  due_date date,
  progress_percent numeric(5,2) check (progress_percent is null or (progress_percent > 0 and progress_percent <= 100)),
  months_after_handover smallint check (months_after_handover is null or months_after_handover between 1 and 120),
  percent numeric(5,2) check (percent is null or (percent > 0 and percent <= 100)),
  amount_minor bigint check (amount_minor is null or amount_minor > 0),
  primary key (version_id, seq),
  check ((percent is null) <> (amount_minor is null)),
  check (trigger_kind <> 'on_date' or due_date is not null),
  check (trigger_kind <> 'construction_progress' or progress_percent is not null),
  check (trigger_kind <> 'after_handover' or months_after_handover is not null)
);

-- Only drafts can change. Lifecycle: draft -> submitted -> approved | rejected; approved -> superseded.
create function app.guard_version() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if old.status = 'draft' then
    if new.status not in ('draft','submitted') then raise exception 'invalid_version_transition' using errcode = '23514'; end if;
    return new;
  end if;
  if (old.status, new.status) not in (('submitted','approved'), ('submitted','rejected'), ('approved','superseded')) then
    raise exception 'version_locked' using errcode = '23514';
  end if;
  -- Content columns are frozen once submitted.
  if new.effective_from is distinct from old.effective_from or new.effective_to is distinct from old.effective_to
     or new.notes is distinct from old.notes or new.version is distinct from old.version
     or (tg_table_name = 'payment_plan_versions' and (to_jsonb(new) ->> 'handover_terms') is distinct from (to_jsonb(old) ->> 'handover_terms'))
     or (tg_table_name = 'payment_plan_versions' and (to_jsonb(new) ->> 'currency') is distinct from (to_jsonb(old) ->> 'currency')) then
    raise exception 'version_locked' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger price_versions_guard before update on app.price_list_versions for each row execute function app.guard_version();
create trigger plan_versions_guard before update on app.payment_plan_versions for each row execute function app.guard_version();

create function app.guard_version_children() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
declare
  vid uuid := coalesce(new.version_id, old.version_id);
  st text;
begin
  if tg_table_name = 'price_list_entries' then
    select status into st from app.price_list_versions where id = vid;
  else
    select status into st from app.payment_plan_versions where id = vid;
  end if;
  if st is distinct from 'draft' then raise exception 'version_locked' using errcode = '23514'; end if;
  return coalesce(new, old);
end $$;
create trigger price_entries_guard before insert or update or delete on app.price_list_entries for each row execute function app.guard_version_children();
create trigger plan_milestones_guard before insert or update or delete on app.payment_plan_milestones for each row execute function app.guard_version_children();

-- ---------------------------------------------------------------- documents

create table app.project_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  project_id uuid not null references app.projects(id),
  title text not null check (length(title) between 1 and 160),
  doc_type text not null check (doc_type in ('brochure','floor_plan','fact_sheet','price_sheet','payment_plan','site_plan','regulatory','other')),
  -- No file storage is connected yet: a document is an https link or an external reference.
  reference_kind text not null check (reference_kind in ('url','external_ref')),
  reference text not null check (length(reference) between 1 and 500),
  visibility text not null default 'internal' check (visibility in ('internal','partners')),
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references app.users(id),
  check (reference_kind <> 'url' or reference ~ '^https://[^\s/]+\.[^\s]+$')
);
create index project_documents_project on app.project_documents (project_id, updated_at desc);

-- ---------------------------------------------------------------- brokerage partners

create table app.project_shares (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),          -- the developer
  project_id uuid not null references app.projects(id),
  brokerage_org_id uuid not null references app.organizations(id),
  include_pricing boolean not null default false,
  include_documents boolean not null default false,
  status text not null default 'active' check (status in ('active','revoked')),
  granted_at timestamptz not null default now(),
  granted_by uuid references app.users(id),
  updated_at timestamptz,
  updated_by uuid references app.users(id),
  revoked_at timestamptz,
  revoked_by uuid references app.users(id)
);
create unique index project_shares_one_active on app.project_shares (project_id, brokerage_org_id) where status = 'active';

create function app.check_share() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if (select type from app.organizations where id = new.brokerage_org_id) is distinct from 'brokerage' then
    raise exception 'share_target_not_brokerage' using errcode = '23514';
  end if;
  if new.org_id is distinct from (select org_id from app.projects where id = new.project_id) then
    raise exception 'org_mismatch' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger project_shares_check before insert or update on app.project_shares for each row execute function app.check_share();

-- Developers pick partners from active brokerages: names and market only.
create function app.brokerage_directory() returns table (id uuid, name text, market text)
language sql stable security definer set search_path = pg_catalog, app as $$
  select o.id, o.name, o.market from app.organizations o
  where o.type = 'brokerage' and o.status = 'active'
    and app.is_member(app.current_org_id())
    and (select type from app.organizations where id = app.current_org_id()) = 'developer'
  order by o.name
$$;

-- Org-consistency for child rows (they must belong to the same developer as their parent).
create function app.check_child_org() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
declare
  r jsonb := to_jsonb(new);  -- read fields by name, so one function serves tables with different columns
  parent_org uuid;
begin
  if tg_table_name in ('project_phases','price_lists','payment_plans','project_documents') then
    select org_id into parent_org from app.projects where id = (r ->> 'project_id')::uuid;
  elsif tg_table_name = 'price_list_versions' then
    select org_id into parent_org from app.price_lists where id = (r ->> 'price_list_id')::uuid;
  elsif tg_table_name = 'payment_plan_versions' then
    select org_id into parent_org from app.payment_plans where id = (r ->> 'plan_id')::uuid;
  elsif tg_table_name = 'price_list_entries' then
    select org_id into parent_org from app.price_list_versions where id = (r ->> 'version_id')::uuid;
    if (select org_id from app.units where id = (r ->> 'unit_id')::uuid) is distinct from new.org_id then
      raise exception 'org_mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name = 'payment_plan_milestones' then
    select org_id into parent_org from app.payment_plan_versions where id = (r ->> 'version_id')::uuid;
  end if;
  if new.org_id is distinct from parent_org then raise exception 'org_mismatch' using errcode = '23514'; end if;
  return new;
end $$;
create trigger phases_org before insert or update on app.project_phases for each row execute function app.check_child_org();
create trigger price_lists_org before insert or update on app.price_lists for each row execute function app.check_child_org();
create trigger plans_org before insert or update on app.payment_plans for each row execute function app.check_child_org();
create trigger docs_org before insert or update on app.project_documents for each row execute function app.check_child_org();
create trigger price_versions_org before insert or update on app.price_list_versions for each row execute function app.check_child_org();
create trigger plan_versions_org before insert or update on app.payment_plan_versions for each row execute function app.check_child_org();
create trigger price_entries_org before insert or update on app.price_list_entries for each row execute function app.check_child_org();
create trigger plan_milestones_org before insert or update on app.payment_plan_milestones for each row execute function app.check_child_org();

-- Readable by a brokerage through an active share. p_need: 'base' | 'pricing' | 'documents'.
create function app.shared_with_me(p_project uuid, p_need text) returns boolean
language sql stable security definer set search_path = pg_catalog, app as $$
  select app.is_member(app.current_org_id()) and exists (
    select 1 from app.project_shares s
    where s.project_id = p_project and s.brokerage_org_id = app.current_org_id() and s.status = 'active'
      and (p_need = 'base' or (p_need = 'pricing' and s.include_pricing) or (p_need = 'documents' and s.include_documents)))
$$;

-- ---------------------------------------------------------------- row-level security

alter table app.projects enable row level security;
alter table app.project_phases enable row level security;
alter table app.units enable row level security;
alter table app.unit_changes enable row level security;
alter table app.price_lists enable row level security;
alter table app.price_list_versions enable row level security;
alter table app.price_list_entries enable row level security;
alter table app.payment_plans enable row level security;
alter table app.payment_plan_versions enable row level security;
alter table app.payment_plan_milestones enable row level security;
alter table app.project_documents enable row level security;
alter table app.project_shares enable row level security;

-- Owner: full read/write in its own context.
create policy projects_owner on app.projects for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy phases_owner on app.project_phases for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy units_owner on app.units for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy unit_changes_owner_read on app.unit_changes for select to baytline_app using (app.owns(org_id));
create policy unit_changes_owner_insert on app.unit_changes for insert to baytline_app with check (app.owns(org_id) and actor_user_id = app.current_user_id());
create policy price_lists_owner on app.price_lists for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy price_versions_owner on app.price_list_versions for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy price_entries_owner on app.price_list_entries for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy plans_owner on app.payment_plans for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy plan_versions_owner on app.payment_plan_versions for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy plan_milestones_owner on app.payment_plan_milestones for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy documents_owner on app.project_documents for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy shares_owner on app.project_shares for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));

-- Brokerage partner: read-only, and only what the active share includes.
-- Drafts, rejected versions, unit history, internal documents and sample records are never shared.
create policy projects_partner on app.projects for select to baytline_app using (not is_sample and app.shared_with_me(id, 'base'));
create policy phases_partner on app.project_phases for select to baytline_app using (app.shared_with_me(project_id, 'base'));
create policy units_partner on app.units for select to baytline_app using (not is_sample and status <> 'draft' and app.shared_with_me(project_id, 'base'));
create policy price_lists_partner on app.price_lists for select to baytline_app using (app.shared_with_me(project_id, 'pricing'));
create policy price_versions_partner on app.price_list_versions for select to baytline_app
  using (status = 'approved' and app.shared_with_me((select project_id from app.price_lists l where l.id = price_list_id), 'pricing'));
create policy price_entries_partner on app.price_list_entries for select to baytline_app
  using (exists (select 1 from app.price_list_versions v join app.price_lists l on l.id = v.price_list_id
                 where v.id = version_id and v.status = 'approved' and app.shared_with_me(l.project_id, 'pricing')));
create policy plans_partner on app.payment_plans for select to baytline_app using (app.shared_with_me(project_id, 'pricing'));
create policy plan_versions_partner on app.payment_plan_versions for select to baytline_app
  using (status = 'approved' and app.shared_with_me((select project_id from app.payment_plans p where p.id = plan_id), 'pricing'));
create policy plan_milestones_partner on app.payment_plan_milestones for select to baytline_app
  using (exists (select 1 from app.payment_plan_versions v join app.payment_plans p on p.id = v.plan_id
                 where v.id = version_id and v.status = 'approved' and app.shared_with_me(p.project_id, 'pricing')));
create policy documents_partner on app.project_documents for select to baytline_app
  using (visibility = 'partners' and status = 'active' and app.shared_with_me(project_id, 'documents'));
create policy shares_partner on app.project_shares for select to baytline_app
  using (brokerage_org_id = app.current_org_id() and app.is_member(brokerage_org_id));

revoke all on function app.owns(uuid), app.shared_with_me(uuid, text), app.brokerage_directory() from public;
grant execute on function app.owns(uuid), app.shared_with_me(uuid, text), app.brokerage_directory() to baytline_app;

grant select, insert, update on app.projects, app.project_phases, app.units, app.price_lists, app.price_list_versions,
  app.payment_plans, app.payment_plan_versions, app.project_documents, app.project_shares to baytline_app;
grant select, insert, update, delete on app.price_list_entries, app.payment_plan_milestones to baytline_app; -- draft-only by trigger
grant select, insert on app.unit_changes to baytline_app;
