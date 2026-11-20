-- Refinements found while building the identity services.

-- Email ownership is proven by following an invitation or password-reset link.
-- Self-registered accounts stay unverified until an email provider is configured.
alter table app.users add column email_verified_at timestamptz;
grant select (email_verified_at) on app.users to baytline_app;
grant update (email_verified_at) on app.users to baytline_auth;

-- Platform-wide audit visibility: platform administrators and compliance.
create function app.has_platform_audit() returns boolean
language sql stable security definer set search_path = pg_catalog, app as $$
  select exists (
    select 1 from app.memberships m join app.organizations o on o.id = m.org_id
    where o.type = 'platform' and m.user_id = app.current_user_id()
      and m.role in ('platform_admin','platform_compliance') and m.status = 'active')
$$;
revoke all on function app.has_platform_audit() from public;
grant execute on function app.has_platform_audit() to baytline_app;

drop policy audit_select_app on app.audit_events;
create policy audit_select_app on app.audit_events for select to baytline_app
  using ((org_id = app.current_org_id() and app.is_member(org_id)) or app.has_platform_audit());

-- What an invitee may see before accepting: enough to decide, nothing else.
-- Callable without a signed-in user; the token itself is the credential.
create function app.invitation_preview(p_token_hash text)
returns table (org_name text, org_type text, role text, email text, state text, expires_at timestamptz)
language sql stable security definer set search_path = pg_catalog, app as $$
  select o.name, o.type, i.role, i.email,
         case when i.status <> 'pending' then i.status
              when i.expires_at < now() then 'expired'
              when o.status <> 'active' then 'unavailable'
              else 'pending' end,
         i.expires_at
  from app.invitations i join app.organizations o on o.id = i.org_id
  where i.token_hash = p_token_hash
$$;
revoke all on function app.invitation_preview(text) from public;
grant execute on function app.invitation_preview(text) to baytline_app, baytline_auth;

-- Accepting an invitation now also records that the email address is verified.
create or replace function app.accept_invitation(p_token_hash text)
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

  -- Following the invitation link proves the invitee controls this email address.
  update app.users u set email_verified_at = coalesce(u.email_verified_at, now()) where u.id = me;

  update app.invitations i set status = 'accepted', accepted_at = now(), accepted_by = me where i.id = inv.id;

  insert into app.audit_events (actor_user_id, org_id, event_type, outcome, target_type, target_id, metadata)
  values (me, inv.org_id, 'invitation.accepted', 'success', 'invitation', inv.id::text, jsonb_build_object('role', inv.role));

  return query select inv.org_id, inv.role;
end $$;
