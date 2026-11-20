# Customer experience (milestone 7)

Buyers, investors, renters and tenants discover published homes, compare them, send enquiries,
request viewings and ask for support. Organizations publish listings and handle what's routed to them.

## What is public, and when

Nothing is public until a person with `listing.publish` approves it, and that is recorded in the audit trail.

| Listing | Published by | Shown publicly |
|---|---|---|
| Developer project (for sale) | `developer_admin`, `developer_sales_manager` | The project, and only the units chosen at publication that aren't drafts. Prices only if "show prices" is on, and only from an approved price list in effect today. Payment plans only if "show plans" is on, approved and in effect today. |
| Rental unit | `pm_admin`, `pm_leasing_manager` | Asking rent, payment frequency, availability date, area label and description as entered. Hidden automatically while the unit isn't recorded as vacant or on notice. |

Sample records can never be published (database trigger). Withdrawing removes a listing at once; requests already received are kept.

Signed-out visitors read only the `pub_*` views (migration 0009): published rows, public columns. They run on the app role with no user, so every other table stays behind row-level security.

## Availability wording

`unitAvailability` / `rentalAvailability` (`@baytline/marketplace`) apply the provenance rule in `@baytline/core`:

- **Available**: only when the owner reports it available *and* confirmed it within the source's freshness window.
- **Availability not confirmed**: reported but never verified.
- **Not recently confirmed**: verified, but too long ago; shows when.
- **Under review**, **reported as reserved / sold**, **not offered right now**.

Rental listings count as confirmed when published or when staff press "Confirm still available".

## Comparison

Up to four units or rentals. Every fact carries a basis: **confirmed** (approved price list or plan, or a detail on a verified unit), **reported by owner**, **estimate** (expected handover dates) or **not provided**.

## Customer requests

| Table | Written by | Readable by |
|---|---|---|
| `customer_enquiries` | `app.submit_enquiry` | the customer; lead roles of the routed organization |
| `appointment_requests` | `app.submit_appointment`, `app.cancel_appointment` | the customer; lead roles of the routed organization (viewing roles may confirm or decline) |
| `support_requests` | `app.submit_support_request` | the customer; `platform_admin`, `platform_support` |

The submit functions take the email from the account, record consent time, source (`listing_page` / `compare_page`) and locale, and decide routing from the publication: the owner, or a brokerage the developer named that holds an active share for the project. The browser can't choose the recipient. Customers can't insert or edit these rows directly; organizations can change only status columns.

Appointments stay **pending** until someone with `viewing.manage` confirms a time they've arranged; nothing is a calendar booking. Confirmed times are stored with the organization's market time zone.

Role lists live in `@baytline/core` (`LEAD_ROLES`, `VIEWING_ROLES`, `PUBLISH_ROLES`, `SUPPORT_ROLES`) and are mirrored by SQL functions; a test checks they match.

## Screens

- Public: `/{locale}/homes` (search, buy/rent), `/homes/projects/{id}`, `/homes/rentals/{id}`, `/homes/compare`.
- Customer workspace: Enquiries, Appointments, Help. Discover points to the public search.
- Developer: project tab "Public listing"; Leads (inbox). Brokerage: Leads. Property manager: rental panel on each unit; Customer requests. Platform: Customer support.
