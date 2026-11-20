-- Milestone 8: project location intelligence.
--
-- A location profile per developer project (address, area, coordinates) and the nearby places,
-- planned infrastructure and competing developments the developer's team records. Every record
-- carries its source and verification state. Nothing here is fetched from outside: no map or
-- places provider is configured, so all records are entered by people or imported from files.
--
-- Visibility: the owning developer always; a partner brokerage only when its share for the project
-- includes location (project_shares.include_location); the public only when the publication says
-- show_location. All three are explicit choices by the developer.

alter table app.project_shares add column include_location boolean not null default false;
alter table app.project_publications add column show_location boolean not null default false;

-- Adds the 'location' need to the share check used by partner policies.
create or replace function app.shared_with_me(p_project uuid, p_need text) returns boolean
language sql stable security definer set search_path = pg_catalog, app as $$
  select app.is_member(app.current_org_id()) and exists (
    select 1 from app.project_shares s
    where s.project_id = p_project and s.brokerage_org_id = app.current_org_id() and s.status = 'active'
      and (p_need = 'base' or (p_need = 'pricing' and s.include_pricing) or (p_need = 'documents' and s.include_documents)
           or (p_need = 'location' and s.include_location)))
$$;

create table app.project_locations (
  project_id uuid primary key references app.projects(id),
  org_id uuid not null references app.organizations(id),
  address text check (address is null or length(address) <= 300),
  area text check (area is null or length(area) <= 120),
  latitude numeric(9,6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9,6) check (longitude is null or longitude between -180 and 180),
  source_kind text not null default 'manual_entry' check (source_kind in ('manual_entry','structured_import','provider')),
  source_reference text check (source_reference is null or length(source_reference) <= 300),
  verification text not null default 'unverified' check (verification in ('unverified','verified')),
  verified_at timestamptz,
  verified_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references app.users(id),
  check ((latitude is null) = (longitude is null)),
  check (verification <> 'verified' or (verified_at is not null and verified_by is not null))
);

create table app.project_places (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  project_id uuid not null references app.projects(id),
  kind text not null check (kind in ('amenity','infrastructure','competitor')),
  category text not null check (category in ('transport','school','healthcare','retail','leisure','worship','park','government','other',
                                             'road','rail','utility','public_facility','residential','mixed_use','commercial')),
  name text not null check (length(name) between 1 and 160),
  description text check (description is null or length(description) <= 1000),
  latitude numeric(9,6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9,6) check (longitude is null or longitude between -180 and 180),
  -- Distance as recorded by the person entering it, used only when there are no coordinates.
  recorded_distance_m integer check (recorded_distance_m is null or recorded_distance_m between 0 and 200000),
  -- Infrastructure and competitors: stage as stated by the source, and its expected date if given.
  stage text check (stage is null or stage in ('announced','planned','under_construction','operational','launched','completed')),
  expected_date date,
  developer_name text check (developer_name is null or length(developer_name) <= 160),
  source_kind text not null default 'manual_entry' check (source_kind in ('manual_entry','structured_import','provider')),
  source_reference text check (source_reference is null or length(source_reference) <= 300),
  verification text not null default 'unverified' check (verification in ('unverified','verified')),
  verified_at timestamptz,
  verified_by uuid references app.users(id),
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references app.users(id),
  check ((latitude is null) = (longitude is null)),
  check (verification <> 'verified' or (verified_at is not null and verified_by is not null)),
  -- Plans and competitors are claims about the world: they always say where they came from.
  check (kind = 'amenity' or source_reference is not null),
  check (kind <> 'amenity' or category in ('transport','school','healthcare','retail','leisure','worship','park','government','other')),
  check (kind <> 'infrastructure' or category in ('road','rail','utility','public_facility','transport','other')),
  check (kind <> 'competitor' or category in ('residential','mixed_use','commercial','other'))
);
create index project_places_project on app.project_places (project_id, status, kind);

create function app.check_location_org() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if not exists (select 1 from app.projects p where p.id = new.project_id and p.org_id = new.org_id) then
    raise exception 'org_mismatch' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger project_locations_org before insert or update on app.project_locations for each row execute function app.check_location_org();
create trigger project_places_org before insert or update on app.project_places for each row execute function app.check_location_org();

alter table app.project_locations enable row level security;
alter table app.project_places enable row level security;
create policy project_locations_owner on app.project_locations for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy project_places_owner on app.project_places for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy project_locations_partner on app.project_locations for select to baytline_app using (app.shared_with_me(project_id, 'location'));
create policy project_places_partner on app.project_places for select to baytline_app using (status = 'active' and app.shared_with_me(project_id, 'location'));
grant select, insert, update on app.project_locations, app.project_places to baytline_app;

-- Public: only for published projects whose developer chose to show location.
create view app.pub_locations with (security_barrier) as
  select l.project_id, l.address, l.area, l.latitude::text as latitude, l.longitude::text as longitude, l.source_kind, l.source_reference,
         l.verification, l.verified_at, l.updated_at
    from app.project_locations l
    join app.project_publications pub on pub.project_id = l.project_id
    join app.pub_projects pp on pp.id = l.project_id
   where pub.show_location;

create view app.pub_places with (security_barrier) as
  select pl.id, pl.project_id, pl.kind, pl.category, pl.name, pl.description, pl.latitude::text as latitude, pl.longitude::text as longitude,
         pl.recorded_distance_m, pl.stage, pl.expected_date::text as expected_date, pl.developer_name, pl.source_kind, pl.source_reference,
         pl.verification, pl.verified_at, pl.updated_at
    from app.project_places pl
    join app.project_publications pub on pub.project_id = pl.project_id
    join app.pub_projects pp on pp.id = pl.project_id
   where pub.show_location and pl.status = 'active';

grant select on app.pub_locations, app.pub_places to baytline_app;
