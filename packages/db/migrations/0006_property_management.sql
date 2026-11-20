-- Milestone 5: property-management workspace — managed properties and units, tenants,
-- leases, tenant requests and maintenance work orders.
--
-- Isolation: every row carries org_id = the property-management organization that owns it.
-- Members of that org read/write in its active-org context (app.owns); fine-grained role checks
-- are in @baytline/management. No other organization, and no platform staff, can see these rows.
-- Tenant contact details have an extra database-level role check.

-- Does the current user hold one of these roles in the active org? Used only where data is
-- sensitive enough to need protection even from members with other roles.
create function app.has_role_in_active_org(p_roles text[]) returns boolean
language sql stable security definer set search_path = pg_catalog, app as $$
  select exists (
    select 1 from app.memberships m join app.organizations o on o.id = m.org_id
    where m.org_id = app.current_org_id() and m.user_id = app.current_user_id()
      and m.status = 'active' and o.status = 'active' and m.role = any (p_roles))
$$;
revoke all on function app.has_role_in_active_org(text[]) from public;
grant execute on function app.has_role_in_active_org(text[]) to baytline_app;

-- Assignees must be active members of the same organization.
create function app.check_assignee() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if new.assignee_user_id is not null and not exists (
       select 1 from app.memberships m where m.org_id = new.org_id and m.user_id = new.assignee_user_id and m.status = 'active') then
    raise exception 'assignee_not_member' using errcode = '23514';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- properties and units

create table app.pm_properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  name text not null check (length(name) between 1 and 160),
  market text not null references app.markets(code),
  city text not null check (length(city) between 1 and 80),
  address text check (address is null or length(address) <= 300),
  property_type text not null check (property_type in ('residential_building','villa_compound','single_villa','mixed_use','commercial_building','retail_center','other')),
  -- Ownership / management relationship, as recorded from the agreement with the owner.
  owner_name text check (owner_name is null or length(owner_name) <= 160),
  management_basis text not null check (management_basis in ('full_management','leasing_only','maintenance_only')),
  agreement_ref text check (agreement_ref is null or length(agreement_ref) <= 120),
  agreement_start date,
  agreement_end date,
  notes text check (notes is null or length(notes) <= 2000),
  status text not null default 'active' check (status in ('active','archived')),
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id),
  updated_at timestamptz,
  updated_by uuid references app.users(id),
  check (agreement_end is null or agreement_start is null or agreement_end >= agreement_start)
);
create index pm_properties_org on app.pm_properties (org_id, name);

create table app.pm_units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  property_id uuid not null references app.pm_properties(id),
  code text not null check (length(code) between 1 and 40),
  unit_type text not null check (unit_type in ('apartment','villa','townhouse','office','retail','storage','other')),
  bedrooms smallint check (bedrooms is null or bedrooms between 0 and 20),
  area_sqm numeric(10,2) check (area_sqm is null or area_sqm > 0),
  floor smallint check (floor is null or floor between -5 and 200),
  -- Recorded by staff; never inferred from leases.
  occupancy text not null default 'vacant' check (occupancy in ('vacant','occupied','notice_given','under_maintenance','not_available')),
  occupancy_updated_at timestamptz not null default now(),
  occupancy_updated_by uuid references app.users(id),
  notes text check (notes is null or length(notes) <= 1000),
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id),
  updated_at timestamptz,
  updated_by uuid references app.users(id),
  unique (property_id, code)
);
create index pm_units_property on app.pm_units (property_id, code);

-- ---------------------------------------------------------------- tenants (contacts kept apart)

create table app.pm_tenants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  display_name text not null check (length(display_name) between 1 and 160),
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id)
);

-- Personal contact details. Visible only to roles in TENANT_CONTACT_ROLES (@baytline/core).
create table app.pm_tenant_contacts (
  tenant_id uuid primary key references app.pm_tenants(id),
  org_id uuid not null references app.organizations(id),
  email text check (email is null or (length(email) <= 254 and email like '_%@_%')),
  phone text check (phone is null or phone ~ '^\+?[0-9 ()-]{6,24}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references app.users(id)
);

-- ---------------------------------------------------------------- leases (recorded contract details)

create table app.pm_leases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  unit_id uuid not null references app.pm_units(id),
  tenant_id uuid not null references app.pm_tenants(id),
  reference text check (reference is null or length(reference) <= 120),
  status text not null default 'draft' check (status in ('draft','active','renewed','ended','terminated')),
  start_date date not null,
  end_date date not null,
  renewal_date date, -- the date the parties recorded for deciding on renewal
  rent_minor bigint check (rent_minor is null or rent_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  payment_frequency text check (payment_frequency is null or payment_frequency in ('monthly','quarterly','semi_annual','annual','other')),
  payment_terms text check (payment_terms is null or length(payment_terms) <= 500), -- as written in the contract
  deposit_minor bigint check (deposit_minor is null or deposit_minor > 0),
  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id),
  updated_at timestamptz,
  updated_by uuid references app.users(id),
  check (end_date >= start_date)
);
create index pm_leases_unit on app.pm_leases (unit_id, start_date desc);
create index pm_leases_end on app.pm_leases (org_id, status, end_date);

-- ---------------------------------------------------------------- tenant requests

create table app.pm_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  property_id uuid not null references app.pm_properties(id),
  unit_id uuid references app.pm_units(id),
  tenant_id uuid references app.pm_tenants(id),
  title text not null check (length(title) between 1 and 160),
  description text check (description is null or length(description) <= 4000),
  category text not null check (category in ('plumbing','electrical','air_conditioning','appliance','pest_control','cleaning','access_security','noise','billing','other')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','in_progress','waiting','resolved','closed')),
  assignee_user_id uuid references app.users(id),
  reported_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id),
  updated_at timestamptz,
  updated_by uuid references app.users(id)
);
create index pm_requests_org on app.pm_requests (org_id, status, priority);
create trigger pm_requests_assignee before insert or update of assignee_user_id on app.pm_requests
  for each row execute function app.check_assignee();

create table app.pm_request_notes (
  id bigint generated always as identity primary key,
  org_id uuid not null references app.organizations(id),
  request_id uuid not null references app.pm_requests(id),
  author_user_id uuid not null references app.users(id),
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create trigger pm_request_notes_append_only before update or delete on app.pm_request_notes
  for each row execute function app.append_only();

-- ---------------------------------------------------------------- work orders

create table app.pm_work_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references app.organizations(id),
  property_id uuid not null references app.pm_properties(id),
  unit_id uuid references app.pm_units(id),
  request_id uuid references app.pm_requests(id),
  title text not null check (length(title) between 1 and 160),
  description text check (description is null or length(description) <= 4000),
  status text not null default 'draft' check (status in ('draft','scheduled','in_progress','on_hold','completed','cancelled')),
  assignee_user_id uuid references app.users(id),
  vendor_name text check (vendor_name is null or length(vendor_name) <= 160),
  -- Only true when a person records that the vendor confirmed.
  vendor_confirmed boolean not null default false,
  vendor_confirmed_at timestamptz,
  vendor_confirmed_by uuid references app.users(id),
  scheduled_for date,
  completed_at timestamptz,
  completed_by uuid references app.users(id),
  completion_notes text check (completion_notes is null or length(completion_notes) <= 2000),
  cost_minor bigint check (cost_minor is null or cost_minor >= 0),
  cost_currency text check (cost_currency is null or cost_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  created_by uuid references app.users(id),
  updated_at timestamptz,
  updated_by uuid references app.users(id),
  -- "Booked" and "done" must be recorded by someone, with who and when.
  check (not vendor_confirmed or (vendor_name is not null and vendor_confirmed_at is not null and vendor_confirmed_by is not null)),
  check (status <> 'completed' or (completed_at is not null and completed_by is not null and completion_notes is not null)),
  check ((cost_minor is null) = (cost_currency is null))
);
create index pm_work_orders_org on app.pm_work_orders (org_id, status);
create trigger pm_work_orders_assignee before insert or update of assignee_user_id on app.pm_work_orders
  for each row execute function app.check_assignee();

-- ---------------------------------------------------------------- consistency

-- Child rows must belong to the same organization as their parents, and units to the same property.
create function app.check_pm_links() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
declare r jsonb := to_jsonb(new);
begin
  if (r ? 'property_id') and (select org_id from app.pm_properties where id = (r ->> 'property_id')::uuid) is distinct from new.org_id then
    raise exception 'org_mismatch' using errcode = '23514';
  end if;
  if (r ->> 'unit_id') is not null then
    if (select org_id from app.pm_units where id = (r ->> 'unit_id')::uuid) is distinct from new.org_id then
      raise exception 'org_mismatch' using errcode = '23514';
    end if;
    if (r ? 'property_id') and (select property_id from app.pm_units where id = (r ->> 'unit_id')::uuid) is distinct from (r ->> 'property_id')::uuid then
      raise exception 'unit_not_in_property' using errcode = '23514';
    end if;
  end if;
  if (r ->> 'tenant_id') is not null and (select org_id from app.pm_tenants where id = (r ->> 'tenant_id')::uuid) is distinct from new.org_id then
    raise exception 'org_mismatch' using errcode = '23514';
  end if;
  if (r ->> 'request_id') is not null and (select org_id from app.pm_requests where id = (r ->> 'request_id')::uuid) is distinct from new.org_id then
    raise exception 'org_mismatch' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger pm_units_links before insert or update on app.pm_units for each row execute function app.check_pm_links();
create trigger pm_tenant_contacts_links before insert or update on app.pm_tenant_contacts for each row execute function app.check_pm_links();
create trigger pm_leases_links before insert or update on app.pm_leases for each row execute function app.check_pm_links();
create trigger pm_requests_links before insert or update on app.pm_requests for each row execute function app.check_pm_links();
create trigger pm_request_notes_links before insert on app.pm_request_notes for each row execute function app.check_pm_links();
create trigger pm_work_orders_links before insert or update on app.pm_work_orders for each row execute function app.check_pm_links();

-- Only property-management organizations hold these records.
create function app.check_pm_org() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if (select type from app.organizations where id = new.org_id) is distinct from 'property_manager' then
    raise exception 'not_property_manager' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger pm_properties_org before insert on app.pm_properties for each row execute function app.check_pm_org();
create trigger pm_tenants_org before insert on app.pm_tenants for each row execute function app.check_pm_org();

-- ---------------------------------------------------------------- row-level security

alter table app.pm_properties enable row level security;
alter table app.pm_units enable row level security;
alter table app.pm_tenants enable row level security;
alter table app.pm_tenant_contacts enable row level security;
alter table app.pm_leases enable row level security;
alter table app.pm_requests enable row level security;
alter table app.pm_request_notes enable row level security;
alter table app.pm_work_orders enable row level security;

create policy pm_properties_owner on app.pm_properties for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy pm_units_owner on app.pm_units for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy pm_tenants_owner on app.pm_tenants for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy pm_leases_owner on app.pm_leases for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy pm_requests_owner on app.pm_requests for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
create policy pm_request_notes_read on app.pm_request_notes for select to baytline_app using (app.owns(org_id));
create policy pm_request_notes_insert on app.pm_request_notes for insert to baytline_app
  with check (app.owns(org_id) and author_user_id = app.current_user_id());
create policy pm_work_orders_owner on app.pm_work_orders for all to baytline_app using (app.owns(org_id)) with check (app.owns(org_id));
-- Contacts: owner org AND a contact-authorized role, enforced here as well as in the service.
create policy pm_tenant_contacts_restricted on app.pm_tenant_contacts for all to baytline_app
  using (app.owns(org_id) and app.has_role_in_active_org(array['pm_admin','pm_leasing_manager']))
  with check (app.owns(org_id) and app.has_role_in_active_org(array['pm_admin','pm_leasing_manager']));

grant select, insert, update on app.pm_properties, app.pm_units, app.pm_tenants, app.pm_tenant_contacts,
  app.pm_leases, app.pm_requests, app.pm_work_orders to baytline_app;
grant select, insert on app.pm_request_notes to baytline_app;
