-- Milestone 2: identity, organizations, memberships, invitations, audit.
--
-- Runs as baytline_owner. Three roles exist (created by scripts/setup-local.ts or by ops):
--   baytline_owner  owns all objects, runs migrations. Never used by the running app.
--   baytline_auth   credentials, sessions, reset tokens, user creation. Only used by @baytline/identity auth code.
--   baytline_app    everything else. Subject to row-level security on every app table.
--
-- RLS reads two per-transaction settings, set only by @baytline/db withAppTx():
--   app.user_id  the authenticated user
--   app.org_id   the active organization (from the URL), may be empty
-- If unset, the helpers return NULL and every policy denies.

create schema app;
create schema auth;
revoke all on schema app, auth from public;
grant usage on schema app to baytline_app, baytline_auth;
grant usage on schema auth to baytline_auth;

-- ---------------------------------------------------------------- reference data

-- Mirrors ROLES in packages/core/src/roles.ts (a test asserts they match).
create table app.roles (
  id text primary key,
  org_type text not null check (org_type in ('platform','developer','property_manager','brokerage','individual')),
  is_org_admin boolean not null default false
);
insert into app.roles (id, org_type, is_org_admin) values
  ('platform_admin','platform',true), ('platform_compliance','platform',false), ('platform_support','platform',false),
  ('developer_admin','developer',true), ('developer_sales_manager','developer',false),
  ('developer_inventory_manager','developer',false), ('developer_finance','developer',false),
  ('pm_admin','property_manager',true), ('pm_leasing_manager','property_manager',false),
  ('pm_maintenance_coordinator','property_manager',false), ('pm_finance','property_manager',false),
  ('brokerage_admin','brokerage',true), ('brokerage_manager','brokerage',false), ('brokerage_agent','brokerage',false),
  ('individual','individual',true);

-- ---------------------------------------------------------------- tables

create table app.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and email like '_%@_%'),
  display_name text not null check (length(display_name) between 1 and 120),
  locale text not null default 'en',
  status text not null default 'active' check (status in ('active','disabled')),
  -- Local-development placeholder accounts. The UI labels them; production seeding refuses to create them.
  is_placeholder boolean not null default false,
  created_at timestamptz not null default now()
);

create table auth.credentials (
  user_id uuid primary key references app.users(id) on delete cascade,
  password_hash text not null,
  updated_at timestamptz not null default now()
);

-- id = SHA-256 of the cookie token. The raw token is never stored.
create table auth.sessions (
  id text primary key,
  user_id uuid not null references app.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  last_org_id uuid
);
create index sessions_user_idx on auth.sessions (user_id);

create table auth.password_reset_tokens (
  id text primary key, -- SHA-256 of the emailed token
  user_id uuid not null references app.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

-- email_hash = SHA-256 of the normalized email, used only for throttling. Rows older than a day are purged.
create table auth.sign_in_attempts (
  id bigint generated always as identity primary key,
  email_hash text not null,
  succeeded boolean not null,
  at timestamptz not null default now()
);
create index sign_in_attempts_lookup on auth.sign_in_attempts (email_hash, at desc);

create table app.organizations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('platform','developer','property_manager','brokerage','individual')),
  name text not null check (length(name) between 1 and 160),
  market text check (market in ('AE','SA','QA','KW','BH','OM')),
  status text not null default 'active' check (status in ('active','suspended')),
  created_by uuid references app.users(id),
  created_at timestamptz not null default now(),
  check (type = 'individual' or market is not null)
);
create unique index organizations_single_platform on app.organizations ((true)) where type = 'platform';
create unique index organizations_one_personal on app.organizations (created_by) where type = 'individual';

create table app.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  user_id uuid not null references app.users(id),
  role text not null references app.roles(id),
  status text not null default 'active' check (status in ('active','suspended','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references app.users(id),
  unique (org_id, user_id)
);
create index memberships_user_idx on app.memberships (user_id);

create table app.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  email text not null check (email = lower(email) and email like '_%@_%'),
  role text not null references app.roles(id),
  token_hash text not null unique,
  invited_by uuid references app.users(id), -- null only for the operator bootstrap invitation
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references app.users(id),
  revoked_at timestamptz,
  revoked_by uuid references app.users(id)
);
create unique index invitations_one_pending on app.invitations (org_id, email) where status = 'pending';

-- Append-only. No foreign keys: history must outlive the records it mentions.
create table app.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid,
  actor_kind text not null default 'human' check (actor_kind in ('human','ai_assistant','integration','system')),
  org_id uuid,
  event_type text not null,
  outcome text not null check (outcome in ('success','failure','denied')),
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb
);
create index audit_events_org_time on app.audit_events (org_id, occurred_at desc);
create index audit_events_time on app.audit_events (occurred_at desc);

-- ---------------------------------------------------------------- integrity triggers

create function app.forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'audit_events is append-only' using errcode = '42501';
end $$;
create trigger audit_events_append_only before update or delete on app.audit_events
  for each row execute function app.forbid_change();
create trigger audit_events_no_truncate before truncate on app.audit_events
  for each statement execute function app.forbid_change();

-- A role must belong to the organization's type (e.g. no "developer_admin" in a brokerage).
create function app.check_role_matches_org() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if (select r.org_type from app.roles r where r.id = new.role)
     is distinct from (select o.type from app.organizations o where o.id = new.org_id) then
    raise exception 'role_org_type_mismatch' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger memberships_role_matches before insert or update of role, org_id on app.memberships
  for each row execute function app.check_role_matches_org();
create trigger invitations_role_matches before insert or update of role, org_id on app.invitations
  for each row execute function app.check_role_matches_org();

-- Every non-personal organization keeps at least one active administrator.
create function app.keep_one_admin() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if old.status = 'active' and (select is_org_admin from app.roles where id = old.role)
     and (new.status <> 'active' or not (select is_org_admin from app.roles where id = new.role))
     and not exists (
       select 1 from app.memberships m join app.roles r on r.id = m.role
       where m.org_id = old.org_id and m.status = 'active' and r.is_org_admin and m.id <> old.id)
  then
    raise exception 'last_admin' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger memberships_keep_admin before update on app.memberships
  for each row execute function app.keep_one_admin();

-- ---------------------------------------------------------------- RLS helpers

create function app.current_user_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;
create function app.current_org_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.org_id', true), '')::uuid
$$;

-- SECURITY DEFINER so policies can consult memberships without recursing into memberships' own RLS.
create function app.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, app as $$
  select exists (
    select 1 from app.memberships m join app.organizations o on o.id = m.org_id
    where m.org_id = p_org and m.user_id = app.current_user_id()
      and m.status = 'active' and o.status = 'active')
$$;

create function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = pg_catalog, app as $$
  select exists (
    select 1 from app.memberships m join app.organizations o on o.id = m.org_id
    where o.type = 'platform' and m.user_id = app.current_user_id()
      and m.role = 'platform_admin' and m.status = 'active')
$$;

create function app.can_see_user(p_user uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, app as $$
  select p_user = app.current_user_id()
      or (app.is_member(app.current_org_id()) and exists (
            select 1 from app.memberships m where m.user_id = p_user and m.org_id = app.current_org_id()))
$$;

-- Accepting an invitation is the only way a user joins an existing organization.
-- The database itself checks the token, expiry, that the signed-in user's email
-- matches, and that nobody accepts an invitation they issued themselves.
create function app.accept_invitation(p_token_hash text)
returns table (org_id uuid, role text)
language plpgsql security definer set search_path = pg_catalog, app as $$
declare
  me uuid := app.current_user_id();
  inv app.invitations;
  my_email text;
  existing app.memberships;
begin
  if me is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select * into inv from app.invitations i where i.token_hash = p_token_hash for update;
  if not found or inv.status <> 'pending' or inv.expires_at < now() then
    raise exception 'invitation_invalid' using errcode = 'P0001';
  end if;

  select u.email into my_email from app.users u where u.id = me and u.status = 'active';
  if my_email is distinct from inv.email then
    raise exception 'invitation_email_mismatch' using errcode = 'P0001';
  end if;
  if inv.invited_by = me then
    raise exception 'invitation_self' using errcode = 'P0001';
  end if;
  if not exists (select 1 from app.organizations o where o.id = inv.org_id and o.status = 'active') then
    raise exception 'invitation_invalid' using errcode = 'P0001';
  end if;

  select * into existing from app.memberships m where m.org_id = inv.org_id and m.user_id = me for update;
  if found and existing.status <> 'removed' then
    raise exception 'already_member' using errcode = 'P0001';
  elsif found then
    update app.memberships m set status = 'active', role = inv.role, updated_at = now(), updated_by = me
      where m.id = existing.id;
  else
    insert into app.memberships (org_id, user_id, role, updated_by) values (inv.org_id, me, inv.role, me);
  end if;

  update app.invitations i set status = 'accepted', accepted_at = now(), accepted_by = me where i.id = inv.id;

  insert into app.audit_events (actor_user_id, org_id, event_type, outcome, target_type, target_id, metadata)
  values (me, inv.org_id, 'invitation.accepted', 'success', 'invitation', inv.id::text, jsonb_build_object('role', inv.role));

  return query select inv.org_id, inv.role;
end $$;

-- Customers get a personal organization of one. Idempotent.
create function app.ensure_personal_org(p_name text) returns uuid
language plpgsql security definer set search_path = pg_catalog, app as $$
declare
  me uuid := app.current_user_id();
  oid uuid;
begin
  if me is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select o.id into oid from app.organizations o where o.type = 'individual' and o.created_by = me;
  if oid is not null then return oid; end if;
  insert into app.organizations (type, name, created_by) values ('individual', left(p_name, 160), me) returning id into oid;
  insert into app.memberships (org_id, user_id, role, updated_by) values (oid, me, 'individual', me);
  return oid;
end $$;

-- Organization status (suspension) may only be changed by platform administrators.
create function app.guard_org_status() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if new.status is distinct from old.status and not app.is_platform_admin() then
    raise exception 'status_change_requires_platform_admin' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger organizations_status_guard before update on app.organizations
  for each row execute function app.guard_org_status();

revoke all on all functions in schema app from public;
grant execute on function app.current_user_id(), app.current_org_id(), app.is_member(uuid),
  app.is_platform_admin(), app.can_see_user(uuid), app.accept_invitation(text), app.ensure_personal_org(text)
  to baytline_app;

-- ---------------------------------------------------------------- row-level security

alter table app.users enable row level security;
alter table app.organizations enable row level security;
alter table app.memberships enable row level security;
alter table app.invitations enable row level security;
alter table app.audit_events enable row level security;
alter table app.roles enable row level security;

create policy roles_read on app.roles for select to baytline_app, baytline_auth using (true);
grant select on app.roles to baytline_app, baytline_auth;

-- users: app sees itself, members of the active org, or everyone if platform admin. Never credentials.
create policy users_app_select on app.users for select to baytline_app
  using (app.can_see_user(id) or app.is_platform_admin());
create policy users_app_update_self on app.users for update to baytline_app
  using (id = app.current_user_id()) with check (id = app.current_user_id());
create policy users_auth_all on app.users for all to baytline_auth using (true) with check (true);
grant select (id, email, display_name, locale, status, is_placeholder, created_at) on app.users to baytline_app;
grant update (display_name, locale) on app.users to baytline_app;
grant select, insert, update (status, display_name, locale) on app.users to baytline_auth;

-- organizations
create policy orgs_select on app.organizations for select to baytline_app
  using (app.is_member(id) or app.is_platform_admin());
create policy orgs_insert on app.organizations for insert to baytline_app
  with check (app.is_platform_admin() and type not in ('platform','individual') and created_by = app.current_user_id());
create policy orgs_update on app.organizations for update to baytline_app
  using (app.is_platform_admin() or (id = app.current_org_id() and app.is_member(id)))
  with check (app.is_platform_admin() or (id = app.current_org_id() and app.is_member(id)));
grant select, insert (type, name, market, created_by) , update (name, market, status) on app.organizations to baytline_app;

-- memberships: no direct INSERT (only via accept_invitation / ensure_personal_org).
-- Nobody can update their own membership row, so nobody can change their own role or status.
create policy memberships_select on app.memberships for select to baytline_app
  using (user_id = app.current_user_id()
         or (org_id = app.current_org_id() and app.is_member(org_id))
         or app.is_platform_admin());
create policy memberships_update on app.memberships for update to baytline_app
  using (user_id <> app.current_user_id()
         and ((org_id = app.current_org_id() and app.is_member(org_id)) or app.is_platform_admin()))
  with check (user_id <> app.current_user_id()
         and ((org_id = app.current_org_id() and app.is_member(org_id)) or app.is_platform_admin()));
grant select, update (role, status, updated_at, updated_by) on app.memberships to baytline_app;

-- invitations
create policy invitations_select on app.invitations for select to baytline_app
  using ((org_id = app.current_org_id() and app.is_member(org_id)) or app.is_platform_admin());
create policy invitations_insert on app.invitations for insert to baytline_app
  with check (invited_by = app.current_user_id()
              and ((org_id = app.current_org_id() and app.is_member(org_id)) or app.is_platform_admin()));
create policy invitations_update on app.invitations for update to baytline_app
  using ((org_id = app.current_org_id() and app.is_member(org_id)) or app.is_platform_admin())
  with check ((org_id = app.current_org_id() and app.is_member(org_id)) or app.is_platform_admin());
grant select (id, org_id, email, role, invited_by, status, expires_at, created_at, accepted_at, accepted_by, revoked_at, revoked_by),
  insert (org_id, email, role, token_hash, invited_by, expires_at),
  update (status, revoked_at, revoked_by) on app.invitations to baytline_app;

-- audit: insert as yourself; read your active org's events, or all if platform admin.
create policy audit_insert_app on app.audit_events for insert to baytline_app
  with check (actor_user_id = app.current_user_id());
create policy audit_select_app on app.audit_events for select to baytline_app
  using ((org_id = app.current_org_id() and app.is_member(org_id)) or app.is_platform_admin());
create policy audit_insert_auth on app.audit_events for insert to baytline_auth with check (true);
grant select, insert on app.audit_events to baytline_app;
grant insert on app.audit_events to baytline_auth;

-- auth schema: auth role only.
grant select, insert, update, delete on auth.credentials, auth.sessions, auth.password_reset_tokens to baytline_auth;
grant select, insert, delete on auth.sign_in_attempts to baytline_auth;
