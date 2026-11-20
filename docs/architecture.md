# Architecture

Status: **proposal + milestone 1 foundation**. Only the parts marked _built_ exist in code.

## 1. Shape of the system

```
                    ┌──────────────────────────── apps/web (Next.js, built) ─────────────────────────────┐
 Browsers ─────────►│ locale routing (proxy.ts) → org-scoped workspaces /[locale]/o/[orgId]/[section]    │
 (5 workspaces)     │ server components call domain services; no direct DB access from client code      │
                    └───────────────┬───────────────────────────────────────────────┬────────────────────┘
                                    │                                               │
                        packages/core (built)                          services (planned, M2+)
                        roles, permissions, access checks,             ├─ api: domain services + Postgres (RLS)
                        markets, locales, provenance rules             ├─ ingestion: feeds, imports, partner updates
                                    │                                  ├─ messaging: WhatsApp/SMS/email/chat adapters
                                    ▼                                  ├─ ai-gateway: drafting, translation, transcription,
                          imported by every service                    │   scoring; policy-enforced, fully logged
                                                                       └─ jobs: queue workers (freshness, SLAs, reminders)
```

**Monorepo (pnpm workspaces).** `apps/*` are deployables, `packages/*` are shared libraries. `@baytline/core` has no framework or I/O dependencies so the same permission and provenance rules run in the web app, the API, workers and tests.

**Recommended stack for later milestones** (see decisions/0003): PostgreSQL with row-level security as a second enforcement layer behind application checks; a queue (e.g. Postgres-backed or managed) for ingestion and messaging; object storage for documents and voice notes; an AI gateway service that is the *only* path to model providers.

## 2. Tenancy and access control

_Built in milestone 2. Full details are in [identity.md](identity.md)._

- **Organization is the tenant boundary.** Every business record has `owner_org_id`. Individuals get a personal organization of one, so the same rules apply to them.
- **One active membership per request.** A user in two orgs (e.g. an agent who is also a buyer) acts in exactly one at a time, chosen by the URL `/o/[orgId]`. Permissions are never unioned across memberships. _(built: `resolveOrgContext`, `can`)_
- **Grants = permission × scope.** Scopes: `org`, `shared` (explicit share records, e.g. developer → partner brokerage), `assigned`, `self`, `public` (published listings), `platform` (platform staff, always audited). _(built: `ROLE_GRANTS`)_
- **Deny by default, 404 not 403.** Non-members and users without the capability get the same 404, so organization and section IDs can't be probed. _(built)_
- **Actor kinds.** `human`, `ai_assistant`, `integration`. AI assistants inherit the delegating user's scope but only for `read` effects; they produce *drafts* that a human sends. Integrations never use role grants; they write through source-specific ingestion paths. _(built in core)_
- **Consequential actions** (holds, price changes, payment-plan publishing, lease signature, spend approval, commission approval, client-registration decisions, market-rule and AI-policy changes) are human-only. Those with an `approval` permission run as *request → approve* with separation of duties (requester ≠ approver). _(rules built; workflow M3)_
- **Platform staff do not see tenant data by default.** Support access to an org's records will be time-boxed, reason-coded "break-glass" access, visible to that org's admin and written to the audit log (M2).

Full role grid: [permission-matrix.md](permission-matrix.md) (generated from code).

## 3. Core data domains

| Domain | Main records | Owner | Notes |
|---|---|---|---|
| Identity & tenancy | user, organization, membership, role assignment, share agreement, break-glass grant | platform / org | Share agreements drive `shared` scope |
| Markets & rules | market, market rule (key, value, effective dates, source reference, approver), fee schedule, payment-plan constraints | platform | Never hard-code fees; rules are versioned |
| Projects & inventory | project, launch, phase, building, unit, unit type, price list, payment plan, document, inventory source, change log | developer | Every unit/price row carries `Provenance` |
| Area intelligence | area profile, amenity, transport link, infrastructure item, competing development | developer / platform | Each item carries source + date |
| Property management | property, unit occupancy, lease, tenant, tenant request, work order, contractor, spend approval | management company | Tenants see their own via `self` |
| Brokerage | client, client registration (with protection window), lead, viewing, deal, commission | brokerage | Registration protection is per developer rules |
| Demand & matching | enquiry, lead score (config + explanation), intent signal, match, next-best-action suggestion | per org | Scores are explainable and configurable per org |
| Conversations | contact, channel identity, conversation, message, voice note, transcript, translation, call, consent record | per org | Consent recorded before any recording/transcription |
| Campaigns & attribution | campaign, channel, ad source, attribution touch, response SLA policy | per org | Ad-platform data only via authorized connections |
| Approvals | approval request, decision, policy | per org | Generic engine for all consequential actions |
| Audit | audit event (actor, actor kind, org, action, target, before/after, reason, AI involvement) | platform | Append-only; retained per market rules |

## 4. Inventory-source strategy

Developers will rarely have APIs. Availability is only as trustworthy as its source, so the source is part of the data model, not a footnote.

**Accepted sources, in order of preference** (`SourceKind`, built in core):

1. `developer_api` — authorized, contracted API access. The only source that may be labelled **Live**, and only within a 1-hour window.
2. `partner_feed` — scheduled files (CSV/XLSX/JSON) delivered by the owner to an SFTP drop or signed upload URL.
3. `partner_portal` — owner staff update units directly in the developer workspace.
4. `structured_import` — an authorized user uploads a spreadsheet against a versioned template, with a validation preview before commit.
5. `manual_entry` — platform staff on documented owner instruction (with the instruction attached).

**Rules**

- Every unit/price record stores `sourceKind`, `sourceId`, `ownerOrgId`, `lastUpdatedAt`, `lastVerifiedAt`, `verification`, `version`, plus an append-only change log (`ChangeLogEntry`).
- Display state is computed, never stored: `availabilityLabel()` → `live` | `recently_confirmed` | `stale` | `unverified` | `disputed`, using per-source freshness windows (admin-configurable). _(built + tested)_
- Buyers only see units that are published; `stale` units show their last confirmation date, and `disputed` units are hidden from buyers.
- Imports go through validate → diff preview → commit. Price changes coming in through imports still create approval requests.
- Third-party (non-owner) information is stored as `unverified` and never overrides owner data.
- **No unauthorized scraping, and no getting around access controls.** Every source needs a recorded authorization (who granted it, scope, expiry) before it is enabled.

## 5. AI boundaries

- The AI gateway is the only service with model credentials. Every call is logged with org, user, purpose, input/output references and the model used.
- Permitted: draft replies, translate, transcribe (after consent), summarize, score and explain, suggest next steps, calculate payment schedules (shown with the inputs and the plan version used).
- Not permitted: executing consequential actions, sending messages without a configured human-approval or auto-send policy, or presenting unverified availability as confirmed.
- Calls: consent is captured and stored before recording; staff can see a live transcript and take over at any time; every call has a summary with a handoff note.

## 6. Localization

- UI locales today: `en`, `ar` (RTL). Planned: `ur` (RTL), `ru`, `es`, `pt`, `ms`, all defined in `packages/core/src/locales.ts`. Content and conversation language support comes before UI translation for planned locales.
- Locale is the first URL segment; `proxy.ts` redirects using a saved cookie, then `Accept-Language`.
- Layout uses logical properties only (`ms-`/`me-`/`ps-`/`start-`), so RTL needs no separate styles.
- Typed dictionaries: `ar.ts` must satisfy the `en.ts` shape, so a missing key fails the type check.
- Money is integer minor units + ISO currency; formatting uses `Intl` (KWD/BHD/OMR have three decimals). Dates are stored in UTC and shown in the market's time zone.

## 7. Secrets and configuration

- No secrets in the repo. `.env*` is git-ignored apart from `.env.example`, which holds names only.
- Database URLs carry separate credentials for the owner, auth and app roles. The running app never receives the owner URL.
- Placeholder accounts (`pnpm db:seed-dev`) use reserved `.test` emails, are labelled in the UI, and the seeding script refuses to run in production.
- Security headers are set in `next.config.ts`. Pages are `noindex` until launch.
