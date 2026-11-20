# Identity, tenancy and audit (milestone 2)

## Authentication

**Decision (0008):** first-party email + password, implemented in `@baytline/identity`. No third-party identity service is connected. Reasons:

- No external credentials are needed, and nothing pretends a provider is connected.
- Identity data stays in the same database and region as everything else, which matters for GCC data-protection rules.
- The session model doesn't depend on how someone signed in, so OIDC/SAML for enterprise customers can be added later without changing it.

| Concern | How it works |
|---|---|
| Passwords | scrypt, N=2^17, r=8, p=1, 16-byte salt (OWASP recommendation). Tests may lower the cost; production refuses anything weaker. Policy: 12–128 characters, no composition rules, can't equal the email (NIST 800-63B). |
| Sessions | A 256-bit random token in an `httpOnly`, `SameSite=Lax` cookie. In production the cookie is `__Host-bl_session` (`Secure`, `path=/`, no Domain). Only the SHA-256 of the token is stored. Absolute lifetime 30 days, idle timeout 7 days. Every request validates against the database, so removal, suspension or a disabled account takes effect immediately. |
| Sign-in | The same answer for unknown email, wrong password and disabled account. Unknown emails still pay the full hashing cost, so timing reveals nothing. Five failures in 15 minutes for one email pause further attempts for that email. |
| Sign-out | Deletes the session row. A password reset deletes every session for the account. |
| Recovery | A single-use reset token, valid for 30 minutes and stored hashed. The request always gets the same response. If no email provider is configured, the page says so and no token is created. |
| Registration | Self-service sign-up is for customer accounts only, which get a personal workspace. People at developers, management companies and brokerages join by invitation only. |
| Email verification | Following an invitation or reset link proves the person controls the address (`email_verified_at`). Self-registered customers stay unverified until an email provider exists. |
| CSRF | Server Actions only accept same-origin POSTs (Next.js checks Origin against Host), and the session cookie is `SameSite=Lax`. |
| Open redirects | `?next=` must be a same-site path under a supported locale (`safeNext`). |

## Organizations, invitations, membership

- **Organization types:** `platform` (one only), `developer`, `property_manager`, `brokerage`, and `individual` (a personal organization of one, never shared).
- **One membership per user per organization**, holding **one role** that must belong to that organization's type. Postgres enforces the type match with a trigger, and a test checks that the database role list matches `@baytline/core`.
- **Membership states:** `active`, `suspended` (access paused) and `removed` (gone; a new invitation can reactivate the person). Only `active` memberships in `active` organizations grant access.
- **Invitations:** an admin enters an email and a role and gets a single-use link, valid for 7 days. The link is shown once, and only its hash is stored. Acceptance happens inside Postgres (`app.accept_invitation`), which checks the token, the expiry and that the signed-in user's email matches. It also refuses an invitation you sent yourself, or one for an organization you already belong to. A newer invitation to the same address replaces the older one.
- **Onboarding a new organization:** a platform operator creates it and invites its first administrator. That administrator invites everyone else.
- **First platform operator:** `pnpm db:bootstrap-admin -- --email <address>` prints a one-time invitation link. No password is ever created or printed.
- **Organization switching:** the active organization is the URL (`/[locale]/o/[orgId]`). Every request is evaluated against that one membership only. A user with several memberships sees a selection screen and a switcher in the side panel. Each change of active organization is audited once (`org.switched`).

## Where authorization is enforced

| Layer | What it checks | Code |
|---|---|---|
| 1. Proxy | Locale only. **Never** used for access decisions. | `apps/web/src/proxy.ts` |
| 2. Pages | The session from the database, then membership of the URL's organization (404 if not a member, which is recorded), then the section's capability (access-denied state, also recorded). Called by the layout **and** by every page, because layouts don't re-run on client navigation. | `apps/web/src/server/guards.ts` |
| 3. Server actions | The acting user comes from the session cookie. The org ID sent by the form is only a claim. | `apps/web/src/server/actions/*` |
| 4. Domain services | Reload the actor's memberships from the database in the same transaction, then apply the core rules: `canInvite`, `canChangeMember` (no self-change, role must fit the org type), `auditScope`, `hasCapability`. | `packages/identity/src/*`, `packages/core/src/membership-rules.ts` |
| 5. PostgreSQL | Row-level security on every `app.*` table, using `app.user_id` / `app.org_id` set per transaction. Nobody can update their own membership row. Credentials, sessions and token hashes aren't readable by the app role at all. The audit log is append-only, enforced by a trigger and by the absence of grants. Every organization keeps at least one active admin (trigger). | `packages/db/migrations/*.sql` |

Navigation hides sections the role can't use, but that's for convenience only. Requesting such a URL directly gets the same refusal.

### Database roles

| Role | Used by | Can do |
|---|---|---|
| `baytline_owner` | migrations, bootstrap, local seeding | owns every object; never used by the running app |
| `baytline_auth` | sign-in, sessions, recovery, account creation | `auth.*` tables; insert and update users; insert audit events |
| `baytline_app` | everything else | `app.*` through RLS only; no access to the `auth` schema; no reading of `password_hash` or `token_hash` |

## Platform staff access (milestone 3)

Platform staff (admin, compliance, support) can read the identity directory: organizations, memberships, users and invitations. Only platform administrators can change them. This covers identity metadata only. Business records added in later milestones get their own policies and are not opened up by this. See [platform-admin.md](platform-admin.md).

## Audit history

Event types are listed in `packages/core/src/audit.ts`. They cover:

- sign-up, sign-in success, failure and throttling, and sign-out
- password reset requested and completed
- organization created and organization switched
- invitation created, withdrawn, accepted and refused
- member role changed, suspended, reactivated and removed
- access refused

Each event stores the time, actor, actor kind, organization, event type, outcome (`success`, `failure`, `denied`), target type and ID, and small structured metadata (role names, reason codes). Metadata keys that look like secrets or contact details are rejected in code. Emails, passwords, tokens, IP addresses and user agents are never stored in the log.

- **Visibility:** organization admins (`audit.view` at org scope) see their organization's events, including attempts by outsiders to open it. Platform administrators and compliance see everything, including sign-in outcomes. RLS enforces the same rule.
- **Denied attempts** are written in a separate transaction, so they survive the rollback of the refused operation.

## Configuration still needed

| Item | Status |
|---|---|
| PostgreSQL 16+ with three roles | Done locally (`pnpm db:setup`). Shared environments need the roles and database provisioned by infrastructure and the three `DATABASE_*_URL` secrets injected. |
| `APP_URL` | Required in production for invitation and reset links. |
| Email delivery | **SMTP connector** (`MAIL_SMTP_URL`, `MAIL_FROM`). Until it is configured and checked, invitation links are shown to the inviter and password reset says it is unavailable. The dev console outbox works in development only. |
| Data residency | Pick the hosting region (and the database location within it) before real users sign up. |
| Hardening before launch | IP-based rate limiting at the edge, breached-password screening, MFA (TOTP or passkeys) for administrators, an audit retention policy per market, and break-glass support access (designed in architecture.md, not built). |

## Two-step sign-in (milestone 11)

Authenticator-app codes (TOTP, RFC 6238) with ten one-time recovery codes. Secrets are AES-256-GCM encrypted under `BAYTLINE_MFA_KEY`; codes are accepted once per time step, five wrong codes in 15 minutes pause verification, and every step is audited (`auth.mfa.*`).

- **Platform staff must use it.** The platform workspace refuses a session without a verified second factor in three places: the page guard (redirects to setup), `requireContext` (`mfa_required`), and SQL (`app.is_platform_staff()` / `is_platform_admin()` / `has_platform_audit()` require `app.mfa = on`, set by `withAppTx` from the session).
- **Sign-in:** a password sign-in for a user with MFA creates a session that only the code step can use; every other page treats it as signed out.
- **Everyone else** may turn it on (and off, with a current code) under *Two-step sign-in*.
- **Lost phone:** a platform administrator resets someone else's MFA from the user's page; their sessions end. Nobody can reset their own.
