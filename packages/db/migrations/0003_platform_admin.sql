-- Milestone 3: platform administration.
-- Read access for all platform staff (admin, compliance, support); changes for platform admins only.

create function app.is_platform_staff() returns boolean
language sql stable security definer set search_path = pg_catalog, app as $$
  select exists (
    select 1 from app.memberships m join app.organizations o on o.id = m.org_id
    where o.type = 'platform' and m.user_id = app.current_user_id() and m.status = 'active')
$$;
revoke all on function app.is_platform_staff() from public;
grant execute on function app.is_platform_staff() to baytline_app;

-- Directory reads: staff may look up organizations, people and memberships (identity metadata only;
-- business records added in later milestones get their own policies and are NOT covered by this).
drop policy orgs_select on app.organizations;
create policy orgs_select on app.organizations for select to baytline_app
  using (app.is_member(id) or app.is_platform_staff());
drop policy memberships_select on app.memberships;
create policy memberships_select on app.memberships for select to baytline_app
  using (user_id = app.current_user_id()
         or (org_id = app.current_org_id() and app.is_member(org_id))
         or app.is_platform_staff());
drop policy users_app_select on app.users;
create policy users_app_select on app.users for select to baytline_app
  using (app.can_see_user(id) or app.is_platform_staff());
drop policy invitations_select on app.invitations;
create policy invitations_select on app.invitations for select to baytline_app
  using ((org_id = app.current_org_id() and app.is_member(org_id)) or app.is_platform_staff());

-- ---------------------------------------------------------------- organization profiles
-- "As provided" profile fields. Nothing here is verified by the platform.
alter table app.organizations
  add column legal_name text check (legal_name is null or length(legal_name) between 1 and 200),
  add column registration_ref text check (registration_ref is null or length(registration_ref) between 1 and 100),
  add column website text check (website is null or (length(website) <= 200 and website ~ '^https://[^\s/]+\.[^\s]+$')),
  add column updated_at timestamptz,
  add column updated_by uuid references app.users(id);
grant update (legal_name, registration_ref, website, updated_at, updated_by) on app.organizations to baytline_app;

-- ---------------------------------------------------------------- markets
-- Seeded with stable public facts (ISO 4217 currency, IANA time zone, weekend days).
-- Formatting defaults are starting points for administrators to review.
create table app.markets (
  code text primary key check (code in ('AE','SA','QA','KW','BH','OM')),
  name_en text not null check (length(name_en) between 1 and 80),
  name_ar text not null check (length(name_ar) between 1 and 80),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  time_zone text not null check (length(time_zone) between 3 and 64),
  weekend_days smallint[] not null check (weekend_days <@ array[0,1,2,3,4,5,6]::smallint[] and cardinality(weekend_days) between 1 and 3),
  default_locale text not null check (default_locale in ('en','ar')),
  supported_locales text[] not null check (supported_locales <@ array['en','ar','ur','ru','es','pt','ms'] and cardinality(supported_locales) >= 1),
  numbering_system text not null default 'latn' check (numbering_system in ('latn','arab')),
  date_style text not null default 'medium' check (date_style in ('short','medium','long')),
  status text not null default 'enabled' check (status in ('enabled','disabled')),
  notes text check (notes is null or length(notes) <= 500),
  updated_at timestamptz,
  updated_by uuid references app.users(id),
  check (default_locale = any (supported_locales))
);
insert into app.markets (code, name_en, name_ar, currency, time_zone, weekend_days, default_locale, supported_locales) values
  ('AE', 'United Arab Emirates', 'الإمارات العربية المتحدة', 'AED', 'Asia/Dubai',   '{6,0}', 'en', '{ar,en,ur,ru}'),
  ('SA', 'Saudi Arabia',         'المملكة العربية السعودية', 'SAR', 'Asia/Riyadh',  '{5,6}', 'ar', '{ar,en,ur}'),
  ('QA', 'Qatar',                'قطر',                     'QAR', 'Asia/Qatar',   '{5,6}', 'ar', '{ar,en}'),
  ('KW', 'Kuwait',               'الكويت',                  'KWD', 'Asia/Kuwait',  '{5,6}', 'ar', '{ar,en}'),
  ('BH', 'Bahrain',              'البحرين',                 'BHD', 'Asia/Bahrain', '{5,6}', 'ar', '{ar,en}'),
  ('OM', 'Oman',                 'عُمان',                   'OMR', 'Asia/Muscat',  '{5,6}', 'ar', '{ar,en}');

-- Regulated rules and fees: one slot per market and category, all "needs setup".
-- No values are invented. Filling them in arrives with the approval workflow (next milestone).
create table app.market_rules (
  market text not null references app.markets(code),
  category text not null check (category in (
    'property_transfer_fee','property_registration_fee','vat_treatment','broker_licensing',
    'broker_commission','escrow_requirements','off_plan_payment_plans','foreign_ownership',
    'tenancy_registration','rent_increase','security_deposit','mortgage_financing')),
  status text not null default 'needs_setup' check (status in ('needs_setup','configured')),
  value jsonb,
  source_reference text,
  effective_from date,
  updated_at timestamptz,
  updated_by uuid references app.users(id),
  primary key (market, category),
  check (status = 'needs_setup' or (value is not null and source_reference is not null and effective_from is not null))
);
insert into app.market_rules (market, category)
  select m.code, c from app.markets m,
  unnest(array['property_transfer_fee','property_registration_fee','vat_treatment','broker_licensing',
               'broker_commission','escrow_requirements','off_plan_payment_plans','foreign_ownership',
               'tenancy_registration','rent_increase','security_deposit','mortgage_financing']) as c;

alter table app.markets enable row level security;
alter table app.market_rules enable row level security;
-- Market formatting is needed by every signed-in screen; it isn't sensitive.
create policy markets_read on app.markets for select to baytline_app using (app.current_user_id() is not null);
create policy markets_update on app.markets for update to baytline_app
  using (app.is_platform_admin()) with check (app.is_platform_admin());
create policy market_rules_read on app.market_rules for select to baytline_app using (app.current_user_id() is not null);
grant select, update (name_en, name_ar, currency, time_zone, weekend_days, default_locale, supported_locales,
  numbering_system, date_style, status, notes, updated_at, updated_by) on app.markets to baytline_app;
grant select on app.market_rules to baytline_app;
-- No write grant on market_rules yet: values may only be set through the future approval workflow.

-- ---------------------------------------------------------------- integration registry
-- Providers are defined in code (@baytline/platform); credentials live in the secret manager,
-- never in this database. This stores only the admin switch and connection-check history.
create table app.integration_settings (
  provider_key text primary key check (provider_key ~ '^[a-z_]{2,40}$'),
  enabled boolean not null default true,
  notes text check (notes is null or length(notes) <= 500),
  updated_at timestamptz not null default now(),
  updated_by uuid references app.users(id)
);

create table app.integration_checks (
  id bigint generated always as identity primary key,
  provider_key text not null check (provider_key ~ '^[a-z_]{2,40}$'),
  checked_at timestamptz not null default now(),
  checked_by uuid references app.users(id),
  ok boolean not null,
  latency_ms integer,
  summary text not null check (length(summary) <= 200)
);
create index integration_checks_latest on app.integration_checks (provider_key, checked_at desc);
create function app.append_only() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;
create trigger integration_checks_append_only before update or delete on app.integration_checks
  for each row execute function app.append_only();

alter table app.integration_settings enable row level security;
alter table app.integration_checks enable row level security;
create policy integration_settings_read on app.integration_settings for select to baytline_app using (app.is_platform_staff());
create policy integration_settings_write on app.integration_settings for insert to baytline_app
  with check (app.is_platform_admin() and updated_by = app.current_user_id());
create policy integration_settings_update on app.integration_settings for update to baytline_app
  using (app.is_platform_admin()) with check (app.is_platform_admin() and updated_by = app.current_user_id());
create policy integration_checks_read on app.integration_checks for select to baytline_app using (app.is_platform_staff());
create policy integration_checks_insert on app.integration_checks for insert to baytline_app
  with check (app.is_platform_admin() and checked_by = app.current_user_id());
grant select, insert (provider_key, enabled, notes, updated_at, updated_by), update (enabled, notes, updated_at, updated_by)
  on app.integration_settings to baytline_app;
grant select, insert (provider_key, checked_by, ok, latency_ms, summary) on app.integration_checks to baytline_app;
