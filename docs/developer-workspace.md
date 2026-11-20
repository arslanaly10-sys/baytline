# Developer workspace (milestone 4)

Everything here runs in a developer organization's workspace (`/[locale]/o/<developer org>/…`). Services live in `@baytline/developer`; the schema is in `packages/db/migrations/0005_developer.sql`.

## Workflows

| Workflow | Who (default roles) | Notes |
|---|---|---|
| Create and edit projects; buildings and phases | admin, inventory manager (`project.manage`) | Name, market (enabled markets only), city, location, property types, description, launch and handover dates, status. Search and filter by text, status, market and property type. |
| Create and edit units | admin, inventory manager (`unit.manage`) | Code (unique per project), building or phase, type, bedrooms (0 = studio), area, floor, status. |
| Set or undo **reserved** and **sold** | admin, sales manager (`unit.hold.approve`) | Binding states; human-only. Others aren't offered them, and the server refuses them. |
| Verify a unit | admin, inventory manager (`inventory.verify`) | Confirms the current data. Any later edit resets it to "reported by your team". |
| Draft and submit price-list versions | admin, sales manager, inventory manager (`price.change.request`) | Prices per unit in the list's currency (defaults to the market's currency). |
| Approve or reject prices | admin, finance (`price.change.approve`) | **Never your own submission.** Rejection needs a note. |
| Draft payment-plan versions | admin, inventory manager (`payment_plan.manage`) | Milestones: on booking, on a date, at construction progress, on handover, or N months after handover; each one a percentage **or** an amount. Handover terms are the developer's own wording. |
| Submit plans / approve plans | `payment_plan.publish` / `payment_plan.approve` | An all-percentage plan must total exactly 100%. That's the only check: arithmetic, not policy. |
| Project documents | view: all developer roles; manage: admin, inventory manager | Title, type, https link or internal reference, visibility (internal or partners), archive. |
| Brokerage partners | view: admin, sales manager, inventory manager; manage: admin, sales manager | Share a project with a brokerage on the platform: base access (project plus published units), with **approved pricing** and **partner documents** as separate switches. Revoke at any time. |
| Approvals queue | all roles with `approval.view` | Lists submitted versions and says whether you can decide. Decisions are made on the version page after reviewing it. |

## Data structures

```
projects ─┬─ project_phases (building | phase)
          ├─ units ── unit_changes (append-only, field-level history)
          ├─ price_lists ── price_list_versions ── price_list_entries (unit, price_minor)
          ├─ payment_plans ── payment_plan_versions ── payment_plan_milestones
          ├─ project_documents
          └─ project_shares (→ brokerage org; include_pricing, include_documents)
```

- **Money** is stored as integer minor units with an ISO currency code. Parsing is done on the exact string, with no floating point; KWD, BHD and OMR keep 3 decimals.
- **Unit provenance:** `source_kind` (entries made here are `partner_portal`), `source_ref`, `last_updated_at`, `verification`, `last_verified_at` and `verified_by`, `version`. The display label comes from `@baytline/core` `availabilityLabel()`, and anything entered in the workspace can at best be "recently confirmed", **never "live"**. Sample records are always "unverified".
- **Current price** = the entry from the latest **approved** version of a list whose effective dates include today, in the market's time zone. Drafts and submitted versions never affect what's shown.
- **Version lifecycle:** draft → submitted → approved | rejected; approved → superseded when a newer approved version starts on or after it.

## Enforcement

| Rule | Where |
|---|---|
| Only the owning developer reads or writes its records, in its active-org context | `app.owns(org_id)` RLS on every table, plus `requireDeveloper()` permission checks in every service |
| Child rows belong to the same developer as their parent | trigger `check_child_org`; units' phases must be in the same project (`check_unit_phase`) |
| Only drafts can change | triggers `guard_version` and `guard_version_children` |
| The approver is never the submitter | core `canApprove` in the service, and a CHECK constraint in the database |
| Unit history can't be edited | `unit_changes` append-only trigger; no update or delete grants |
| Partners see only what's shared | RLS `app.shared_with_me(project, 'base' / 'pricing' / 'documents')`. Partners never see drafts, rejected versions, draft units, sample records, internal or archived documents, or unit history. Read-only. |
| Shares go only to brokerages; sample projects are never shared | trigger `check_share`; service check |
| Platform staff don't see developer business data | no platform policy on these tables |

Every change writes an audit event: projects, phases, units, verification, price and plan versions (created, submitted, approved, rejected), documents and partner shares.

## Honest limits

- **No file uploads:** the document-storage connector isn't built, so the page says so and accepts https links or internal references.
- **No imports or feeds:** units are entered in the workspace. The roadmap's inventory-source work brings validated imports.
- **No country rules:** prices and plans aren't checked against market rules (fees, escrow, payment-plan limits), because those are still "needs setup" under Platform, Markets. The platform adds no taxes, fees or financing terms.
- **The brokerage side** of shared projects (a "partner inventory" screen) isn't built. Only the database access rules are, and they're tested.
- **Sample data:** `pnpm db:seed-dev` adds one project flagged `is_sample`, titled "Sample project (not real)", with four units and no prices.
