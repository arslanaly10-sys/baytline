# Permission matrix

_Generated from `packages/core/src/permissions.ts` by `pnpm --filter @baytline/core matrix`. Do not edit by hand._

Scopes: **P** platform-wide, **O** own organization, **S** own org + records explicitly shared with it, **A** assigned to the user, **U** the user themself, **Pub** published listings.
Effect: R read, W write, **C** consequential (human-only; † = needs a second person's approval).

| Permission | Effect | platform_admin | platform_compliance | platform_support | developer_admin | developer_sales_manager | developer_inventory_manager | developer_finance | pm_admin | pm_leasing_manager | pm_maintenance_coordinator | pm_finance | brokerage_admin | brokerage_manager | brokerage_agent | individual |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `org.settings.manage` | W | O |  |  | O |  |  |  | O |  |  |  | O |  |  |  |
| `org.members.view` | R | O | O | O | O |  |  |  | O |  |  |  | O |  |  |  |
| `org.members.manage` | W | O |  |  | O |  |  |  | O |  |  |  | O |  |  |  |
| `approval.view` | R | O | O |  | O | O | O | O | O | O |  | O | O | O |  |  |
| `project.view` | R |  |  |  | O | O | O | O |  |  |  |  | S | S | S |  |
| `project.manage` | W |  |  |  | O |  | O |  |  |  |  |  |  |  |  |  |
| `inventory.view` | R |  |  |  | O | O | O | O |  |  |  |  | S | S | S |  |
| `inventory.import` | W |  |  |  | O |  | O |  |  |  |  |  |  |  |  |  |
| `unit.manage` | W |  |  |  | O |  | O |  |  |  |  |  |  |  |  |  |
| `partner.view` | R |  |  |  | O | O | O |  |  |  |  |  |  |  |  |  |
| `partner.manage` | W |  |  |  | O | O |  |  |  |  |  |  |  |  |  |  |
| `inventory.verify` | **C** |  |  |  | O |  | O |  |  |  |  |  |  |  |  |  |
| `unit.hold.request` | **C**† |  |  |  |  | O |  |  |  |  |  |  | S | S | S |  |
| `unit.hold.approve` | **C** |  |  |  | O | O |  |  |  |  |  |  |  |  |  |  |
| `price.view` | R |  |  |  | O | O | O | O |  |  |  |  | S | S | S |  |
| `price.change.request` | **C**† |  |  |  | O | O | O |  |  |  |  |  |  |  |  |  |
| `price.change.approve` | **C** |  |  |  | O |  |  | O |  |  |  |  |  |  |  |  |
| `payment_plan.manage` | W |  |  |  | O |  | O |  |  |  |  |  |  |  |  |  |
| `payment_plan.publish` | **C**† |  |  |  | O |  | O |  |  |  |  |  |  |  |  |  |
| `payment_plan.approve` | **C** |  |  |  | O |  |  | O |  |  |  |  |  |  |  |  |
| `document.view` | R |  |  |  | O | O | O | O |  |  |  |  | S | S | S |  |
| `document.manage` | W |  |  |  | O |  | O |  |  |  |  |  |  |  |  |  |
| `area_profile.view` | R |  |  |  | O | O | O | O |  |  |  |  | S | S | S |  |
| `area_profile.manage` | W |  |  |  | O |  | O |  |  |  |  |  |  |  |  |  |
| `property.view` | R |  |  |  |  |  |  |  | O | O | O | O |  |  |  |  |
| `property.manage` | W |  |  |  |  |  |  |  | O |  |  |  |  |  |  |  |
| `occupancy.view` | R |  |  |  |  |  |  |  | O | O |  | O |  |  |  |  |
| `lease.view` | R |  |  |  |  |  |  |  | O | O |  | O |  |  |  |  |
| `lease.manage` | W |  |  |  |  |  |  |  | O | O |  |  |  |  |  |  |
| `lease.sign.request` | **C**† |  |  |  |  |  |  |  |  | O |  |  |  |  |  |  |
| `lease.sign.approve` | **C** |  |  |  |  |  |  |  | O |  |  | O |  |  |  |  |
| `tenant.contact.view` | R |  |  |  |  |  |  |  | O | O |  |  |  |  |  |  |
| `tenant_request.view` | R |  |  |  |  |  |  |  | O | O | O |  |  |  |  |  |
| `tenant_request.manage` | W |  |  |  |  |  |  |  | O | O | O |  |  |  |  |  |
| `maintenance.view` | R |  |  |  |  |  |  |  | O |  | O | O |  |  |  |  |
| `maintenance.manage` | W |  |  |  |  |  |  |  | O |  | O |  |  |  |  |  |
| `maintenance.spend.approve` | **C** |  |  |  |  |  |  |  | O |  |  | O |  |  |  |  |
| `client_registration.submit` | W |  |  |  |  |  |  |  |  |  |  |  | O | O | O |  |
| `client_registration.review` | **C** |  |  |  | O | O |  |  |  |  |  |  |  |  |  |  |
| `lead.view` | R |  |  |  | O | O |  |  |  | O |  |  | O | O | A |  |
| `lead.manage` | W |  |  |  |  | O |  |  |  | O |  |  | O | O | A |  |
| `lead.assign` | W |  |  |  | O | O |  |  |  |  |  |  | O | O |  |  |
| `viewing.manage` | W |  |  |  |  |  |  |  |  | O |  |  | O | O | A |  |
| `deal.view` | R |  |  |  |  |  |  |  |  |  |  |  | O | O | A |  |
| `deal.manage` | W |  |  |  |  |  |  |  |  |  |  |  | O | O | A |  |
| `commission.view` | R |  |  |  | O | O |  | O |  |  |  |  | O | O | A |  |
| `commission.approve` | **C** |  |  |  | O |  |  | O |  |  |  |  |  |  |  |  |
| `conversation.view` | R |  |  |  | O | O |  |  | O | O |  |  | O | O | A | U |
| `conversation.reply` | W |  |  |  |  | O |  |  |  | O | O |  | O | O | A | U |
| `campaign.view` | R |  |  |  | O | O |  |  |  |  |  |  | O |  |  |  |
| `analytics.view` | R |  |  |  | O | O |  |  | O |  |  |  | O | O |  |  |
| `audit.view` | R | P | P |  | O |  |  | O | O |  |  | O | O |  |  |  |
| `listing.browse` | R |  |  |  |  |  |  |  |  |  |  |  |  |  |  | Pub |
| `shortlist.manage` | W |  |  |  |  |  |  |  |  |  |  |  |  |  |  | U |
| `enquiry.create` | W |  |  |  |  |  |  |  |  |  |  |  |  |  |  | U |
| `appointment.book` | W |  |  |  |  |  |  |  |  |  |  |  |  |  |  | U |
| `tenancy.view` | R |  |  |  |  |  |  |  |  |  |  |  |  |  |  | U |
| `support.request` | W |  |  |  |  |  |  |  |  |  |  |  |  |  |  | U |
| `platform.orgs.view` | R | P | P | P |  |  |  |  |  |  |  |  |  |  |  |  |
| `platform.orgs.manage` | W | P |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `platform.users.view` | R | P | P | P |  |  |  |  |  |  |  |  |  |  |  |  |
| `platform.users.manage` | W | P |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `platform.markets.view` | R | P | P | P |  |  |  |  |  |  |  |  |  |  |  |  |
| `platform.integrations.view` | R | P | P | P |  |  |  |  |  |  |  |  |  |  |  |  |
| `platform.integrations.manage` | W | P |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `platform.markets.configure` | **C** | P |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `platform.sources.manage` | W | P |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `platform.ai_policy.manage` | **C** | P |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
