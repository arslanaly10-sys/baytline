# Leads, matching and brokerage (milestone 12)

Code: `packages/leads` (services and tests), `packages/core/src/lead-scoring.ts` (score rules), migration `0016_leads_brokerage.sql`, and the screens under `apps/web/src/app/[locale]/o/[orgId]/` (`leads`, `viewings`, `deals`, `registrations`, `clients`, `commissions`).

## Leads

- **Capture.** On Leads → Customer requests, "Add new customer requests as leads" turns enquiries and appointment requests into leads.
  - It is idempotent: each request becomes at most one lead per organization.
  - A request from an email address that already has an open lead is added to that lead instead.
  - The customer's consent time travels with the lead.
- **Added by hand.** Staff can add a lead only after ticking that the person agreed to be contacted. The tick is recorded with the staff member and the time.
- **Visibility.** Lead administrators (`brokerage_admin`, `brokerage_manager`, `developer_admin`, `developer_sales_manager`) see every lead. Everyone else sees only the leads assigned to them. This is enforced by row-level security (`app.lead_visible`), not only in the UI.
- **History.** Every change writes an append-only `lead_events` row and an audit entry: status, assignment, requirements, notes, score overrides, viewings, registrations, deals and claims.

## Scoring: rule-based and explainable

The score is computed when it's shown, from recorded facts. Only staff overrides are stored. There's no AI in it.

| Signal | Points |
| --- | --- |
| Gave a phone number | 10 |
| Stated a budget | 15 |
| Buying timeline: now / 3 months / 6 months / 12 months | 20 / 15 / 8 / 3 |
| Financing: cash / mortgage | 10 / 5 |
| Clear requirements (type, bedrooms or city) | 5 |
| Asked for an appointment | 10 |
| Completed a viewing / viewing booked | 20 / 5 |
| Active in the last 7 days | 10 |
| No activity for more than 30 days | −15 |

Scores are clamped to 0–100: **Hot** is 60 or more, **Warm** 30 to 59, **Cold** below 30. Each lead shows the lines that produced its score and links to the rules.

**Overrides.** Staff can set the band themselves, but must give a reason of at least 3 characters. The override shows who set it, when and why, next to the computed band. Clearing it goes back to the computed band. Both actions are recorded.

## Matching

`matchUnits` lists only units that meet all of these:
- available;
- not sample data;
- in projects that aren't cancelled;
- in the developer's own projects, or, for a brokerage, in projects actively shared with it.

When a lead has a budget, a unit matches only with an **approved price in effect today**, in the same currency and within the range. Units without an approved price are never matched to a budget.

Each match shows:
- its availability label (from source freshness, the same labels as everywhere else);
- which requirements it meets.

A brokerage sees prices only where the share includes pricing.

## Viewings

- Scheduled in the project's market time zone.
- Scheduling moves the lead to "Viewing".
- Completed and upcoming viewings feed the score.

## Client registration and protection

1. **Register.** A brokerage registers a lead's client for a project shared with it.
   - Contact details are stored as SHA-256 hashes of the normalized values (with a fixed Baytline prefix) plus masked forms; the phone shows only its last four digits.
   - Developers can spot duplicates without any brokerage seeing another's clients.
2. **Review.** The developer reviews on the Registrations screen.
   - Possible duplicates (same email or phone hash on the same project, from any brokerage) are flagged.
   - Approving sets a protection period of 1–365 days (90 by default).
   - Rejecting needs a note.
   - The database refuses a second approval while another registration already protects the same client on that project (`already_protected`).
3. **States.** Waiting, Protected, Protection ended, Rejected or Withdrawn. The brokerage can withdraw a registration while it's still waiting.

## Deals

- **Opening.** A deal opens on a real unit that is available or reserved and isn't sample data. It records:
  - the approved list price in effect, with its version;
  - the unit's availability label at that moment.
- **Agreed price.** Entered by staff as agreed. Baytline calculates nothing.
- **Closing.** Marking a deal won needs an agreed price and marks the lead won. Marking it lost needs a reason.

## Commissions with two-person approval

- **Submitting.** A brokerage can claim commission only when all of these hold:
  - the deal is won;
  - it is linked to an approved registration;
  - that registration was protecting the client when the deal opened (otherwise `no_protection`).
- **Amounts.** Entered by staff. With a percentage basis, the amount must equal the agreed price times the rate, within one minor unit. That's a consistency check, not a calculator.
- **Deciding.** Only the paying developer's `developer_admin` or `developer_finance` can approve or reject. The database requires the decider to be someone other than the submitter (`decided_by <> submitted_by`), and a rejection needs a note.
- **One open claim per deal.** A deal can have only one open or approved claim at a time.

## Not in this milestone

- AI intent extraction, scoring or next-best-action;
- messaging campaigns and follow-up sequences;
- payment or commission calculators;
- VIP routing and launch surge triage.
