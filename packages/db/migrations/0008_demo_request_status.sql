-- Platform admins track follow-up on demo requests (new -> contacted -> closed). Only the status
-- can change; the visitor's details stay exactly as submitted.
alter table app.demo_requests add column updated_at timestamptz, add column updated_by uuid references app.users(id);
create policy demo_requests_admin_update on app.demo_requests for update to baytline_app
  using (app.is_platform_admin()) with check (app.is_platform_admin());
grant update (status, updated_at, updated_by) on app.demo_requests to baytline_app;
