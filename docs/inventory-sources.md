# Authorized inventory sources and imports (milestone 9)

Every change to a developer's inventory arrives through a **source** the developer authorized, and every
change records which source it came from. Inbound data is **staged** and checked first. Nothing changes
until a person allowed to do it reviews and confirms.

## Source types

| Type | Who authorizes it | What it can change | Provenance label |
| --- | --- | --- | --- |
| `workspace` | Built in, one per developer | Edits the team makes in Baytline | `partner_portal` |
| `partner` | The developer (needs `inventory.import` and `partner.manage`) | Proposed **unit status** for projects already shared with that brokerage | `partner_portal` |
| `file_import` | The developer (`inventory.import`) | Units, projects, prices (as drafts), payment plans (as drafts) | `structured_import` |
| `data_feed` | The developer submits it; a **platform administrator approves** it | Same as file import, delivered by an adapter | `partner_feed` |
| `direct_integration` | Developer and platform, as for feeds | Same, in real time | `developer_api` |

For each source the system stores:
- the owner organization and the source type;
- the authorization status (`draft` → `pending_approval` → `authorized`, or `rejected` / `suspended` / `revoked`);
- an authorization reference, plus who authorized it and when;
- for feeds and direct integrations, the platform's decision and note;
- the projects it may update, or all projects;
- its freshness window;
- for adapters, non-secret settings and secret **names**;
- the last successful update, the last attempt, and the last error.

## Credentials

Secret values never enter the database or the browser.
- A source stores only the **names** of server environment variables, and they must start with `FEED_`, so a source can never point at platform secrets such as `DATABASE_APP_URL`.
- The UI shows each name as *set on the server* or *missing*.
- Feed failures are recorded as fixed summaries, because provider error text can echo URLs or tokens.

## Connection health

Health is derived, never typed in. It is checked in this order: `no_adapter`, `not_authorized`, `platform_disabled` (the platform's `developer_feeds` integration switch), `not_configured`, `failing`, `never_synced`, `stale`, `healthy`.
- A feed is `healthy` only after a fetch succeeded **and its batch was applied** inside the freshness window.
- A fetch alone confirms nothing.

## The import pipeline (files, feeds and partner submissions)

1. **Upload or receive.**
   - Files up to 2 MB and 2,000 rows.
   - The person states when the data was true ("as of"); a feed uses its own data timestamp when it sends one.
   - Everything is stored as a batch. Nothing else changes.
2. **Map columns.**
   - A mapping is suggested from the header names; the person confirms it.
   - A column can be used once, and required fields must be mapped.
3. **Validate and preview.** Every row is checked against current records and labelled:
   - `create` or `update`, with field-by-field changes;
   - `unchanged`;
   - `error`, with the field and the reason;
   - `duplicate`: the same record appears more than once in the file, so none of those rows apply;
   - `conflict`: the record was changed by a different source after the data's "as of" time.
4. **Confirm.**
   - The person chooses what happens to conflicts: leave them, or leave them and mark them **conflicting**.
   - Someone allowed to verify inventory may confirm the data was correct as of its time.
5. **Apply.**
   - Validation runs again inside the transaction, and the result must match the fingerprint of what was reviewed. If records changed in between, nothing is applied and the person reviews again.
   - Errors, duplicates and skipped conflicts are never applied.

Permissions that applying checks:
- `inventory.import` for every import.
- `unit.manage` for units.
- `unit.hold.approve` for any change to or from reserved or sold.
- `project.manage` for projects.
- `price.change.request` for prices.
- `payment_plan.manage` for plans.
- `inventory.verify` to confirm availability.

**Prices and payment plans never go live from an import.**
- They become a new **draft** version, which then goes through the existing two-person approval.
- A price list or plan that already has a version waiting for approval can't receive another import until that version is decided.

## History, verification and freshness

- Unit field changes (`unit_changes`) and project field changes (`project_changes`) record:
  - the source and the batch;
  - the time;
  - the person who made or confirmed the change;
  - the old and new values.

  Draft versions link back to their batch. The *Change history* screen combines all of these.
- Applying changes resets verification, unless the batch is confirmed as verified.
  - Confirmation dates come from the data's "as of" time, never the upload time.
  - Unchanged rows from a confirmed batch move their confirmation forward, never backward.
- Freshness is per source:
  - A source's window can only **shorten** the default for its kind: direct 1 h, feed 24 h, file 72 h.
  - When a source is suspended or revoked, its confirmations stop counting as verified, both inside the workspace and on public pages.
- What people see:
  - **Live** appears only for a trusted, authorized direct integration confirmed inside its window. No direct-integration adapter exists, so nothing is live today.
  - Other states are labelled *Recently confirmed*, *Stale*, *Unverified* or *Conflicting*.
  - Units whose source is no longer authorized are flagged.

## Adapters

`packages/developer/src/sources/adapters.ts`. An adapter has:
- a key and a source type;
- the config fields it needs, validated in code;
- its secret slots;
- a `fetch` that returns rows in the import format.

Everything after the fetch is the shared pipeline. Project and unit screens never call adapters.

| Adapter | Type | Status |
| --- | --- | --- |
| `https_csv` | data feed | Built: fetches CSV from a public HTTPS URL, with an optional bearer token from a `FEED_*` secret. Guards: named host only, no IP literals or local suffixes, DNS answers must be public addresses, no redirects, 15 s timeout, 2 MB limit. The data time comes from `X-Data-As-Of` or `Last-Modified`, otherwise the fetch time, labelled as such. |
| (none) | direct integration | Not built. Creating one is refused with "no adapter". |

To add a provider, add an adapter to `ADAPTERS`. Nothing is listed that doesn't exist in code.

## Access

- Row-level security limits sources, batches, rows and history to the owning developer.
- A partner brokerage sees only the sources that name it and the batches it submitted, never import rows or other batches. It submits through `app.submit_partner_update`, which checks:
  - its role;
  - the source's authorization;
  - that the project is covered;
  - that an active share exists;
  - a rate limit.
- Platform staff see source **metadata** for review, never inventory. Only platform administrators decide (`app.decide_inventory_source`).
- Every step is in the audit history: `source.*` and `import.*` events.

## Not in this milestone

- Scheduled (automatic) feed syncs: fetches run when a person presses *Fetch now*.
- Auto-applying trusted feeds without review.
- Any direct-integration adapter.
- Messaging, lead scoring and payment calculators.
