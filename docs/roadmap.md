# Roadmap

Each milestone is a separate, reviewable build prompt. Section milestone numbers in the UI come from `packages/core/src/workspaces.ts`.

| # | Milestone | Delivers |
|---|---|---|
| 1 | **Foundation** _(done)_ | Monorepo, core domain rules, app shell, design system, en/ar + RTL, role-based workspaces |
| 2 | **Identity, tenancy, audit** _(done)_ | Real auth, organizations, invitations, memberships, roles, Postgres + RLS, audit log |
| 3 | **Platform administration** _(done)_ | Organization directory and profiles, users and memberships, market configuration, integration registry, audit filters |
| 4 | **Developer workspace** _(done)_ | Projects, phases, units with provenance, versioned pricing and payment plans with two-person approval, documents, brokerage sharing |
| 5 | **Website and brand** _(done)_ | New logo, dark-and-gold design system, 3D skyline scroll film, marketing pages in English and Arabic, demo requests saved as leads, draft legal pages |
| 6 | **Property management and app restyle** _(done, except approvals)_ | Portfolio, properties and units with recorded occupancy, leases as recorded with tenant contact limited to authorized roles, tenant requests, work orders with recorded vendor confirmation and completion, portfolio summaries from stored records; the app in the dark-and-gold design. Still to come: lease-signing and maintenance-spend approvals (Approvals section) |
| 7 | AI foundation | AI gateway (Claude), per-organization AI policies and autonomy levels, logging and budgets, workspace copilot, drafting tools (listing copy, request triage, work-order drafts, renewal drafts), website concierge |
| 8 | Connectors, rules and sources | Email, document storage, WhatsApp, SMS and telephony connectors; market rules and fees through approval; validated spreadsheet imports and authorized feeds; admin MFA; document AI (lease abstraction, inspections, quote comparison) |
| 9 | Leads, matching and brokerage | Lead capture, intent extraction, explainable scoring, matching, next-best-action, VIP routing, launch surge triage, viewings, client registration, deals, commissions, partner inventory, area profiles |
| 10 | Conversations and AI calling | Instant replies, follow-up sequences, AI voice agent with consent and handoff, live call assist, tenant assistant, rent reminders, tenant self-service |
| 11 | Insights and discovery | Forecasts, demand insights, attribution, buyer discovery with the home-search assistant |

The AI feature list and its safety rules: [ai-capabilities.md](ai-capabilities.md).
