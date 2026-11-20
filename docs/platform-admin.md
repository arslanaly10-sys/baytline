# Platform administration (milestone 3)

All of this lives in the platform organization's workspace (`/[locale]/o/<platform org>/…`). Nobody outside the platform organization can reach it: they get 404.

## Who can do what

| Area | View | Change |
|---|---|---|
| Organizations | `platform.orgs.view`: admin, compliance, support | `platform.orgs.manage`: admin |
| Users and memberships | `platform.users.view`: admin, compliance, support | `platform.users.manage`: admin |
| Markets | `platform.markets.view`: admin, compliance, support | `platform.markets.configure`: admin |
| Integrations | `platform.integrations.view`: admin, compliance, support | `platform.integrations.manage`: admin |
| Audit log | `audit.view` at platform scope: admin, compliance | nobody (append-only) |

Read-only viewers see the same screens without edit controls, plus a note saying who can make changes. Every server action re-checks the permission in the database, so hiding a control is never the protection.

## Screens

- **Organizations.** Search by name, legal name or registration reference. Filter by type, status and market. Each row shows member and invitation counts.
  - The detail page shows the profile (legal name, registration reference and website, labelled "as provided, not verified"), status and members.
  - Admins can edit the profile, suspend or reactivate the organization (members lose or regain access immediately), and manage members and invitations.
  - Personal (customer) organizations are never listed. The platform organization can't be suspended.
  - Only identity metadata is shown, never another organization's business records.
- **Users.** Search by name or email and filter by account status. The detail page shows memberships in every organization with their roles and statuses, signed-in device count and last activity (from the auth store; counts and dates only).
  - Admins can disable or re-enable an account, sign someone out everywhere, change membership roles and statuses, and invite the person to another organization.
  - Nobody can change their own account or membership, and every organization keeps an administrator.
- **Markets.** The six GCC markets, with currency, time zone, weekend, default language, the languages used, digit style, date style and availability.
  - A preview shows a fixed example amount and date in both languages.
  - Twelve rule and fee categories per market are shown as **Needs setup**. None has a value, and the database grants no write access to them yet.
- **Integrations.** Database, email, WhatsApp, SMS, document storage, AI provider, developer feeds, ad channels and maps.
  - For each one: required secret **names** with set/missing, the latest connection check, and a derived status.
  - Admins can run a real check (where a connector exists) and turn optional integrations on or off. The database is core infrastructure and can't be turned off.
- **Audit log.** Filter by event type, outcome, person (name or email), organization (platform scope only) and date range. Dates are read in the viewing organization's market time zone.

Every screen has loading, error, empty and permission-denied states.

## Protections added

| Protection | Where |
|---|---|
| Staff read-only directory access, admin-only writes | RLS: `app.is_platform_staff()` for SELECT, `app.is_platform_admin()` for writes (migration 0003) |
| No changing your own account status | service (`canManageAccount`), RLS policy (`id <> current user`) and trigger `guard_user_status` (0004) |
| Platform organization can't be suspended | service plus trigger `guard_org_status` (0004) |
| Organization type immutable | no UPDATE grant on `type` |
| Market settings validated | runtime's ISO currency and IANA time zone lists; default language must be one of the market's languages |
| Rule and fee values can't be written | no write grant on `app.market_rules`; a CHECK requires value, source and effective date once configured |
| Integration secrets never reach the browser | the registry reads only `Boolean(env[name])`; check summaries are fixed strings or error codes (no driver messages); a test asserts no secret values appear in the output |
| "Connected" can't be faked | status is derived: connector exists, enabled, secrets present, and a successful check within 24 hours; checks are append-only (trigger) and only admins can insert them |
| Audit can't be widened or edited | the org filter is applied only at platform scope; the person filter matches only actors the viewer can see; `audit_events` is append-only (trigger, no grants) |
| Searches safe from injection and wildcards | parameterised SQL; LIKE wildcards escaped |

Every change writes an audit event: `org.updated` (field names), `org.suspended` and `org.reactivated`, `user.disabled`, `user.enabled` and `user.sessions_revoked`, `market.updated` (field names), `integration.checked`, `integration.enabled` and `integration.disabled`, plus the membership and invitation events from milestone 2.

## Still needs configuration

- **Review market defaults** (default language, digit style, date style) with the business. They're starting points.
- **Rules and fees:** every category needs a verified source, an effective date and an approver. That needs the approval workflow (next milestone).
- **Email:** no provider connector yet, so the registry honestly says "Not built yet".
- **Other connectors** are planned for the milestones shown on each card. Their secrets get added to the deployment's secret manager only when the connector is built.
