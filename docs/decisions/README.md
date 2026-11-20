# Decision records

Short, dated records of decisions that would be expensive to reverse.

| ID | Decision | Status |
|---|---|---|
| 0001 | Monorepo: pnpm workspaces, Next.js App Router web app, framework-free `@baytline/core` | Accepted |
| 0002 | Organization = tenant; one active membership per request; org ID in the URL; 404 for anything outside scope | Accepted |
| 0003 | PostgreSQL with RLS as a second enforcement layer behind application checks | Accepted (M2) |
| 0004 | Provenance is part of the inventory data model; "live" only from authorized real-time APIs | Accepted |
| 0005 | AI actors are read-only and produce drafts; consequential actions are human-only, some with two-person approval | Accepted |
| 0006 | Own minimal typed i18n (no library) for now; switch to an ICU library if plural/select rules get complex | Accepted, review in M4 |
| 0008 | First-party email + password auth with opaque, database-backed sessions; OIDC/SAML later | Accepted (M2) |
| 0009 | Three database roles (owner / auth / app); raw `pg` + SQL migrations, no ORM | Accepted (M2) |
| 0010 | Market configuration lives in the database, edited by platform admins; core keeps only the market codes and seed facts | Accepted (M3) |
| 0011 | Integration status is derived from facts (connector, secrets present, recent successful check), never set by hand | Accepted (M3) |
| 0012 | Separate view and manage permissions for each platform area; compliance and support are read-only | Accepted (M3) |
| 0013 | Unit prices come only from approved price-list versions; prices and payment plans are versioned with two-person approval | Accepted (M4) |
| 0014 | Documents are https links or internal references until a storage connector exists | Accepted (M4) |
| 0015 | Brokerage access is per-project shares with separate pricing and document switches, enforced in RLS | Accepted (M4) |
| 0007 | Working name "Baytline" and a self-designed visual identity (Gulf palette, Readex Pro for Latin and Arabic); final brand open | Provisional |

## 0001 — Monorepo layout
Domain rules (who can do what, what counts as live) must be identical in the web app, API, workers and tests. Keeping them in a dependency-free package makes that possible and keeps them easy to test. Next.js App Router gives server components, so permission checks run on the server by default.

## 0002 — Tenancy in the URL
Putting `/o/[orgId]` in the URL makes the active org explicit and shareable, and it supports users in several orgs of the same type. Returning 404 instead of 403 stops anyone from enumerating organizations.

## 0003 — Database
Relational integrity, transactional approvals and row-level security suit the domain. Data-residency needs (for example Saudi PDPL and UAE data-protection law) may decide the hosting region; this needs confirming before M2.

## 0008 — Authentication
Milestone 1 left the sign-in provider open. Milestone 2 chose first-party auth: no vendor credentials are needed to run it, identity data stays in the chosen region, and enterprise sign-in can be added later without changing how sessions work. Details and threat notes are in [identity.md](../identity.md).

## 0009 — Database access
Row-level security depends on per-transaction settings and on knowing exactly which role runs each query. Plain SQL through `pg` keeps that visible and reviewable. An ORM would hide it, and would be one more framework. The owner, auth and app roles mean a bug in the app layer can't read password hashes or other organizations' rows.

## 0010 — Market configuration
Pages read market settings from `app.markets` (per-request loader `getMarketsConfig`). `@baytline/core` keeps only the six market codes as a type plus the seed facts. Regulated values (fees, taxes, licensing) have slots marked "needs setup" and can't be written until the approval workflow exists.

## 0011 — Integration status
An admin can't mark something "connected". The registry computes it from whether a connector exists, the admin switch, whether the required secrets are present (names only), and the latest connection check. Core infrastructure (the database) can't be switched off, because that would only change a label.

## 0013 — Pricing
Price is a consequential field. Letting it be edited directly on a unit would bypass the request-and-approve rule defined in milestone 1. Unit screens show the price from the approved list in effect today, and changes go through a new version. The database itself refuses edits to non-drafts and approvals by the submitter.

## 0015 — Partner sharing
Sharing works per project, not per unit, so it stays simple to grant and audit. Partners never see drafts, sample records, internal documents or history. Revoking takes effect on the partner's next query.

## 0006 — i18n approach
Two complete UI locales and simple interpolation don't justify a library yet. The `Dictionary` type keeps keys in sync. Arabic has six plural forms, so revisit this once counts appear in UI text.

## 0007 — Identity
Palette: salt-flat canvas `#eef2f1`, deep gulf `#0b5566`/`#073d4a`, mangrove `#2c6a4c` for confirmed, saffron `#b97a0c` for needs-attention, coral-stone `#ad3e32` for problems. Readex Pro is one family that covers Latin and Arabic, so both scripts share one voice. The signature element is the provenance chip system: each state has a different edge (solid, outline, hatch, dashed, double), so status never relies on colour alone.
