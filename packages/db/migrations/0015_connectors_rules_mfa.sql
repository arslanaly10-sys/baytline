-- Milestone 11: connectors, market rules through two-person approval, and admin MFA.

-- ---------------------------------------------------------------- MFA-aware platform checks
--
-- Platform staff act on the platform only from a session that passed a second factor. The app sets
-- app.mfa = 'on' for such sessions (withAppTx); every platform check below requires it, so row-level
-- security and definer functions refuse platform access without MFA even if a code path forgets to.

create function app.mfa_verified() returns boolean language sql stable as $$
  select coalesce(current_setting('app.mfa', true), '') = 'on'
$$;

create or replace function app.is_platform_staff() returns boolean
language sql stable security definer set search_path = pg_catalog, app as $$
  select app.mfa_verified() and exists (
    select 1 from app.memberships m join app.organizations o on o.id = m.org_id
    where o.type = 'platform' and m.user_id = app.current_user_id() and m.status = 'active')
$$;

create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = pg_catalog, app as $$
  select app.mfa_verified() and exists (
    select 1 from app.memberships m join app.organizations o on o.id = m.org_id
    where o.type = 'platform' and m.user_id = app.current_user_id()
      and m.role = 'platform_admin' and m.status = 'active')
$$;

create or replace function app.has_platform_audit() returns boolean
language sql stable security definer set search_path = pg_catalog, app as $$
  select app.mfa_verified() and exists (
    select 1 from app.memberships m join app.organizations o on o.id = m.org_id
    where o.type = 'platform' and m.user_id = app.current_user_id()
      and m.role in ('platform_admin','platform_compliance') and m.status = 'active')
$$;

-- ---------------------------------------------------------------- MFA factors (auth schema: never visible to the app role)

create table auth.mfa_factors (
  user_id uuid primary key references app.users(id) on delete cascade,
  -- TOTP secret, AES-256-GCM encrypted with the server's MFA key (never stored in the clear).
  secret_encrypted text not null,
  confirmed_at timestamptz,
  -- Replay protection: a code's time step can be used once.
  last_used_step bigint,
  created_at timestamptz not null default now()
);

create table auth.mfa_recovery_codes (
  id bigint generated always as identity primary key,
  user_id uuid not null references app.users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  unique (user_id, code_hash)
);

create table auth.mfa_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references app.users(id) on delete cascade,
  at timestamptz not null default now(),
  succeeded boolean not null
);
create index mfa_attempts_user on auth.mfa_attempts (user_id, at desc);

-- A session created by a password sign-in for a user with MFA waits here until the second factor passes.
alter table auth.sessions add column mfa_verified_at timestamptz;

grant select, insert, update, delete on auth.mfa_factors, auth.mfa_recovery_codes, auth.mfa_attempts to baytline_auth;
grant usage on all sequences in schema auth to baytline_auth;

-- Whether a user has confirmed MFA, for platform staff lists (no secrets).
create function app.user_mfa_enrolled(p_user uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, app, auth as $$
  select app.is_platform_staff() and exists (select 1 from auth.mfa_factors f where f.user_id = p_user and f.confirmed_at is not null)
$$;
revoke all on function app.user_mfa_enrolled(uuid) from public;
grant execute on function app.user_mfa_enrolled(uuid) to baytline_app;

-- ---------------------------------------------------------------- connector readiness

-- A connector is ready when the platform hasn't switched it off and its latest connection check
-- succeeded within p_hours. Used by the AI gateway: nothing depends on a connector that hasn't
-- proven it works recently.
create function app.connector_ready(p_key text, p_hours integer default 24) returns boolean
language sql stable security definer set search_path = pg_catalog, app as $$
  select app.integration_enabled(p_key) and coalesce((
    select k.ok and k.checked_at > now() - make_interval(hours => p_hours)
      from app.integration_checks k where k.provider_key = p_key order by k.checked_at desc limit 1), false)
$$;
revoke all on function app.connector_ready(text, integer) from public;
grant execute on function app.connector_ready(text, integer) to baytline_app;

-- ---------------------------------------------------------------- market rules: proposals and two-person approval

-- Every change to a market rule or fee is a proposal with a source, and applies only when a second
-- platform person approves it. Approved values never change in place: a new proposal supersedes them.
create table app.market_rule_changes (
  id uuid primary key default gen_random_uuid(),
  market text not null references app.markets(code),
  category text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn','superseded')),
  value jsonb not null check (jsonb_typeof(value) = 'object'),
  source_reference text not null check (length(source_reference) between 3 and 500),
  effective_from date not null,
  proposed_by uuid not null references app.users(id),
  proposed_at timestamptz not null default now(),
  decided_by uuid references app.users(id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  foreign key (market, category) references app.market_rules(market, category),
  -- Separation of duties, enforced here as well as in code.
  check (decided_by is null or decided_by <> proposed_by),
  -- Approved, rejected and superseded (once approved) changes carry their decision; pending and withdrawn ones don't.
  check ((status in ('approved','rejected','superseded')) = (decided_by is not null and decided_at is not null))
);
create unique index market_rule_changes_one_pending on app.market_rule_changes (market, category) where status = 'pending';
create index market_rule_changes_rule on app.market_rule_changes (market, category, proposed_at desc);

alter table app.market_rule_changes enable row level security;
create policy rule_changes_read on app.market_rule_changes for select to baytline_app using (app.is_platform_staff());
grant select on app.market_rule_changes to baytline_app;

-- Who may propose and who may approve is checked in code (permissions) and here (platform roles).
create function app.propose_market_rule(p_market text, p_category text, p_value jsonb, p_source text, p_effective date) returns uuid
language plpgsql security definer set search_path = pg_catalog, app as $$
declare v_id uuid;
begin
  if not app.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from app.market_rules where market = p_market and category = p_category) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if exists (select 1 from app.market_rule_changes where market = p_market and category = p_category and status = 'pending') then
    raise exception 'pending_exists' using errcode = '23505';
  end if;
  insert into app.market_rule_changes (market, category, value, source_reference, effective_from, proposed_by)
  values (p_market, p_category, p_value, p_source, p_effective, app.current_user_id()) returning id into v_id;
  return v_id;
end $$;

create function app.decide_market_rule(p_change uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = pg_catalog, app as $$
declare v app.market_rule_changes;
begin
  -- Approvers: platform administrators and compliance, never the proposer.
  if not app.has_platform_audit() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v from app.market_rule_changes where id = p_change for update;
  if v.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v.status <> 'pending' then raise exception 'not_pending' using errcode = '23514'; end if;
  if v.proposed_by = app.current_user_id() then raise exception 'own_proposal' using errcode = '42501'; end if;
  if p_decision = 'approve' then
    update app.market_rule_changes set status = 'superseded' where market = v.market and category = v.category and status = 'approved';
    update app.market_rule_changes set status = 'approved', decided_by = app.current_user_id(), decided_at = now(), decision_note = p_note where id = p_change;
    update app.market_rules set status = 'configured', value = v.value, source_reference = v.source_reference, effective_from = v.effective_from,
           updated_at = now(), updated_by = app.current_user_id()
     where market = v.market and category = v.category;
  elsif p_decision = 'reject' then
    update app.market_rule_changes set status = 'rejected', decided_by = app.current_user_id(), decided_at = now(), decision_note = p_note where id = p_change;
  else
    raise exception 'decision' using errcode = '22023';
  end if;
end $$;

create function app.withdraw_market_rule(p_change uuid) returns void
language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if not app.is_platform_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  update app.market_rule_changes set status = 'withdrawn' where id = p_change and status = 'pending' and proposed_by = app.current_user_id();
  if not found then raise exception 'not_pending' using errcode = '23514'; end if;
end $$;

revoke all on function app.propose_market_rule(text, text, jsonb, text, date), app.decide_market_rule(uuid, text, text), app.withdraw_market_rule(uuid) from public;
grant execute on function app.propose_market_rule(text, text, jsonb, text, date), app.decide_market_rule(uuid, text, text), app.withdraw_market_rule(uuid) to baytline_app;
