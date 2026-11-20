-- Platform administrators can disable or re-enable OTHER people's accounts.
-- Permission check and change happen in one app-role transaction.

grant update (status) on app.users to baytline_app;
create policy users_admin_status on app.users for update to baytline_app
  using (app.is_platform_admin() and id <> app.current_user_id())
  with check (app.is_platform_admin() and id <> app.current_user_id());

-- users_app_update_self (display name, locale) is also an UPDATE policy, and policies combine
-- with OR, so this trigger makes sure status can only change through the admin path.
create function app.guard_user_status() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if new.status is distinct from old.status and session_user = 'baytline_app'
     and (not app.is_platform_admin() or new.id = app.current_user_id()) then
    raise exception 'status_change_not_allowed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger users_status_guard before update on app.users
  for each row execute function app.guard_user_status();

-- The platform organization can never be suspended (it would lock out every operator).
create or replace function app.guard_org_status() returns trigger
language plpgsql security definer set search_path = pg_catalog, app as $$
begin
  if new.status is distinct from old.status then
    if not app.is_platform_admin() then
      raise exception 'status_change_requires_platform_admin' using errcode = '42501';
    end if;
    if old.type = 'platform' then
      raise exception 'platform_org_cannot_be_suspended' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
