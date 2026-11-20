-- Milestone 5: demo requests from the public website, stored as leads for the platform team.
--
-- Visitors are anonymous, so rows are written only through app.submit_demo_request (security definer,
-- callable by the auth role). It validates the input and limits repeat submissions.
-- Platform staff can read requests; nobody can edit or delete them through the app roles.

create table app.demo_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  email text not null check (length(email) between 3 and 254 and email = lower(email)),
  phone text check (phone is null or length(phone) between 5 and 32),
  company text not null check (length(company) between 1 and 160),
  market text not null references app.markets(code),
  org_type text not null check (org_type in ('developer','brokerage','property_manager','other')),
  locale text not null check (locale in ('en','ar')),
  consent_at timestamptz not null,
  status text not null default 'new' check (status in ('new','contacted','closed')),
  created_at timestamptz not null default now()
);
create index demo_requests_created on app.demo_requests (created_at desc);
create index demo_requests_email on app.demo_requests (email, created_at desc);

alter table app.demo_requests enable row level security;
create policy demo_requests_staff_read on app.demo_requests for select to baytline_app using (app.is_platform_staff());
grant select on app.demo_requests to baytline_app;

-- Returns 'ok' or 'throttled'. Raises 'invalid_<field>' for bad input.
create function app.submit_demo_request(
  p_name text, p_email text, p_phone text, p_company text, p_market text, p_org_type text, p_locale text
) returns text
language plpgsql security definer set search_path = pg_catalog, app as $$
declare
  v_email text := lower(btrim(p_email));
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'invalid_email' using errcode = '22023'; end if;
  if not exists (select 1 from app.markets where code = p_market) then raise exception 'invalid_country' using errcode = '22023'; end if;
  -- At most 3 requests per email per day, and a ceiling on total volume per hour.
  if (select count(*) from app.demo_requests where email = v_email and created_at > now() - interval '1 day') >= 3
     or (select count(*) from app.demo_requests where created_at > now() - interval '1 hour') >= 300 then
    return 'throttled';
  end if;
  insert into app.demo_requests (name, email, phone, company, market, org_type, locale, consent_at)
  values (btrim(p_name), v_email, nullif(btrim(coalesce(p_phone, '')), ''), btrim(p_company), p_market, p_org_type, p_locale, now());
  return 'ok';
end $$;
revoke all on function app.submit_demo_request(text, text, text, text, text, text, text) from public;
grant execute on function app.submit_demo_request(text, text, text, text, text, text, text) to baytline_auth;
