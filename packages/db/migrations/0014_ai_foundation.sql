-- Milestone 10: AI foundation — a governed gateway, AI policies and a request log.
--
-- AI is OFF twice by default: the platform switch and every organization's policy start disabled,
-- and an organization's capabilities stay off until an administrator chooses a level for each.
-- The request log stores prompts and responses only after personal data was redacted, and the
-- platform team sees usage and cost per organization, never the text.

-- ---------------------------------------------------------------- platform settings (one row)

create table app.ai_platform_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  allowed_models text[] not null default array['claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5'],
  default_model text not null default 'claude-opus-5-5',
  -- Money in micro-dollars (1 USD = 1,000,000). The most any organization may budget per month.
  org_budget_ceiling_micro bigint not null default 50000000 check (org_budget_ceiling_micro >= 0),
  -- All organizations together, per calendar month (UTC).
  platform_monthly_cap_micro bigint not null default 500000000 check (platform_monthly_cap_micro >= 0),
  max_output_tokens_ceiling integer not null default 16000 check (max_output_tokens_ceiling between 256 and 64000),
  -- Prompt and response text (already redacted) is cleared after this many days; metadata stays.
  log_retention_days integer not null default 90 check (log_retention_days between 1 and 730),
  updated_at timestamptz not null default now(),
  updated_by uuid references app.users(id),
  check (default_model = any (allowed_models))
);
insert into app.ai_platform_settings default values;

-- ---------------------------------------------------------------- organization policies

create table app.ai_org_policies (
  org_id uuid primary key references app.organizations(id),
  enabled boolean not null default false,
  allowed_models text[] not null default '{}',
  default_model text,
  monthly_budget_micro bigint not null default 0 check (monthly_budget_micro >= 0),
  max_output_tokens integer not null default 2000 check (max_output_tokens between 256 and 64000),
  -- Capability id -> autonomy level. Missing means off. Checked against the catalogue in code.
  autonomy jsonb not null default '{}'::jsonb check (jsonb_typeof(autonomy) = 'object'),
  -- Keep the (redacted) prompt and response text in the log, or metadata only.
  store_text boolean not null default true,
  -- Set by platform administrators; overrides the organization's own switch.
  platform_blocked boolean not null default false,
  platform_note text check (platform_note is null or length(platform_note) <= 500),
  updated_at timestamptz,
  updated_by uuid references app.users(id),
  check (default_model is null or default_model = any (allowed_models))
);

-- ---------------------------------------------------------------- request log

create table app.ai_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  user_id uuid references app.users(id),
  capability text not null check (length(capability) <= 60),
  autonomy text check (autonomy is null or autonomy in ('off','suggest','draft','approve','auto')),
  model text,
  status text not null check (status in ('reserved','succeeded','refused','failed','blocked')),
  block_reason text check (block_reason is null or length(block_reason) <= 60),
  estimated_cost_micro bigint not null default 0,
  cost_micro bigint not null default 0,
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  served_model text,
  stop_reason text,
  latency_ms integer,
  -- Redacted before storage. Null when the organization keeps metadata only, or after retention.
  prompt_redacted text,
  response_redacted text,
  redactions jsonb not null default '{}'::jsonb,
  -- Which approved, sourced records the request was grounded in, with their labels at the time.
  grounding jsonb not null default '[]'::jsonb,
  rejected_facts integer not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index ai_requests_org on app.ai_requests (org_id, created_at desc);
create index ai_requests_month on app.ai_requests (created_at, status);

-- A request is written once when reserved, finished once, then only its text may be cleared (retention).
create function app.guard_ai_request() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'ai_requests is append-only' using errcode = '42501'; end if;
  if old.status = 'reserved' and new.status in ('succeeded','refused','failed')
     and new.id = old.id and new.org_id = old.org_id and new.user_id is not distinct from old.user_id
     and new.capability = old.capability and new.created_at = old.created_at then
    return new;
  end if;
  if old.status <> 'reserved' and new.prompt_redacted is null and new.response_redacted is null
     and (new.status, new.cost_micro, new.capability, new.org_id) = (old.status, old.cost_micro, old.capability, old.org_id) then
    return new; -- retention purge
  end if;
  raise exception 'ai_request_locked' using errcode = '42501';
end $$;
create trigger ai_requests_guard before update or delete on app.ai_requests for each row execute function app.guard_ai_request();

-- ---------------------------------------------------------------- access

-- Organization roles that manage AI policy and read the request log.
create function app.ai_admin_roles() returns text[] language sql immutable as $$
  select array['developer_admin','pm_admin','brokerage_admin']
$$;

alter table app.ai_platform_settings enable row level security;
alter table app.ai_org_policies enable row level security;
alter table app.ai_requests enable row level security;

-- Every signed-in member can read the platform settings (models, ceilings); only platform admins change them.
create policy ai_platform_read on app.ai_platform_settings for select to baytline_app using (app.current_user_id() is not null);
create policy ai_platform_write on app.ai_platform_settings for update to baytline_app using (app.is_platform_admin()) with check (app.is_platform_admin());

-- An organization's members can read its policy (the gateway needs it); its AI administrators change it.
create policy ai_org_read on app.ai_org_policies for select to baytline_app using (app.owns(org_id));
create policy ai_org_insert on app.ai_org_policies for insert to baytline_app
  with check (app.owns(org_id) and app.has_role_in_active_org(app.ai_admin_roles()) and not platform_blocked);
create policy ai_org_update on app.ai_org_policies for update to baytline_app
  using (app.owns(org_id) and app.has_role_in_active_org(app.ai_admin_roles()))
  with check (app.owns(org_id) and app.has_role_in_active_org(app.ai_admin_roles()));

-- Requests: members write their own; AI administrators read the organization's log.
create policy ai_requests_insert on app.ai_requests for insert to baytline_app
  with check (app.owns(org_id) and user_id = app.current_user_id() and status in ('reserved','blocked'));
create policy ai_requests_finish on app.ai_requests for update to baytline_app
  using (app.owns(org_id) and user_id = app.current_user_id() and status = 'reserved')
  with check (app.owns(org_id));
create policy ai_requests_admin_read on app.ai_requests for select to baytline_app
  using (app.owns(org_id) and app.has_role_in_active_org(app.ai_admin_roles()));
-- The requesting user can read their own rows (the gateway reads back what it reserved).
create policy ai_requests_own_read on app.ai_requests for select to baytline_app
  using (app.owns(org_id) and user_id = app.current_user_id());

grant select, update on app.ai_platform_settings to baytline_app;
grant select, insert, update on app.ai_org_policies to baytline_app;
grant select, insert, update on app.ai_requests to baytline_app;

-- Platform admins may block or unblock an organization (only those columns).
create function app.set_ai_org_blocked(p_org uuid, p_blocked boolean, p_note text) returns void
language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if not app.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from app.organizations where id = p_org and type <> 'platform') then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into app.ai_org_policies (org_id, platform_blocked, platform_note) values (p_org, p_blocked, p_note)
  on conflict (org_id) do update set platform_blocked = excluded.platform_blocked, platform_note = excluded.platform_note;
end $$;
revoke all on function app.set_ai_org_blocked(uuid, boolean, text) from public;
grant execute on function app.set_ai_org_blocked(uuid, boolean, text) to baytline_app;

-- Usage per organization for a month, for platform staff: counts and cost only, never text.
create function app.ai_usage_by_org(p_month date)
returns table (org_id uuid, org_name text, org_type text, enabled boolean, platform_blocked boolean, monthly_budget_micro bigint,
               requests bigint, blocked bigint, cost_micro bigint)
language sql stable security definer set search_path = pg_catalog, app as $$
  select o.id, o.name, o.type, coalesce(p.enabled, false), coalesce(p.platform_blocked, false), coalesce(p.monthly_budget_micro, 0),
         count(r.id) filter (where r.status <> 'blocked'), count(r.id) filter (where r.status = 'blocked'), coalesce(sum(r.cost_micro), 0)::bigint
    from app.organizations o
    left join app.ai_org_policies p on p.org_id = o.id
    left join app.ai_requests r on r.org_id = o.id and r.created_at >= date_trunc('month', p_month) and r.created_at < date_trunc('month', p_month) + interval '1 month'
   where app.is_platform_staff() and o.type not in ('platform','individual')
   group by o.id, o.name, o.type, p.enabled, p.platform_blocked, p.monthly_budget_micro
   order by coalesce(sum(r.cost_micro), 0) desc, o.name
$$;
revoke all on function app.ai_usage_by_org(date) from public;
grant execute on function app.ai_usage_by_org(date) to baytline_app;

-- Month-to-date spend across all organizations (reserved estimates included), for the platform cap.
create function app.ai_platform_spend_mtd() returns bigint
language sql stable security definer set search_path = pg_catalog, app as $$
  select coalesce(sum(case when status = 'reserved' then estimated_cost_micro else cost_micro end), 0)::bigint
    from app.ai_requests where created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
$$;
revoke all on function app.ai_platform_spend_mtd() from public;
grant execute on function app.ai_platform_spend_mtd() to baytline_app;

-- Whether a platform integration is switched on (Integrations screen). On unless an administrator turned it off.
create function app.integration_enabled(p_key text) returns boolean
language sql stable security definer set search_path = pg_catalog, app as $$
  select coalesce((select enabled from app.integration_settings where provider_key = p_key), true)
$$;
revoke all on function app.integration_enabled(text) from public;
grant execute on function app.integration_enabled(text) to baytline_app;

-- Clears stored text older than the retention window. Metadata (cost, tokens, status) stays for the audit trail.
create function app.purge_ai_text() returns integer
language plpgsql security definer set search_path = pg_catalog, app as $$
declare n integer;
begin
  update app.ai_requests set prompt_redacted = null, response_redacted = null
   where status <> 'reserved' and (prompt_redacted is not null or response_redacted is not null)
     and created_at < now() - make_interval(days => (select log_retention_days from app.ai_platform_settings));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function app.purge_ai_text() from public;

-- Month-to-date spend for one organization (reserved estimates included), for the budget check.
-- Any member may run AI within the policy, so the check can't depend on who can read the log.
create function app.ai_org_spend_mtd(p_org uuid) returns bigint
language sql stable security definer set search_path = pg_catalog, app as $$
  select case when app.owns(p_org) then
    coalesce((select sum(case when status = 'reserved' then estimated_cost_micro else cost_micro end)
                from app.ai_requests where org_id = p_org and created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'), 0)::bigint
  end
$$;
revoke all on function app.ai_org_spend_mtd(uuid) from public;
grant execute on function app.ai_org_spend_mtd(uuid) to baytline_app;
