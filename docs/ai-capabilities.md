# AI capabilities

The full list lives in code: `packages/core/src/ai-capabilities.ts` (39 capabilities). The app, the AI-policy admin screen and the marketing site all read from it, and tests enforce its safety rules.

## How much the AI may do

Each organization picks a level for each capability, up to that capability's limit:

| Level | Meaning |
|---|---|
| **Off** | Doesn't run. |
| **Suggest** | Shows a recommendation inside the app. Nothing is created. |
| **Draft** | Prepares a reply, work order or price draft. A person sends or saves it. |
| **Approve** | Acts after a person approves each item. |
| **Auto** | Acts on its own within configured limits. Every action is logged and can be reversed. |

**Hard rules (checked by tests):**
- **Binding actions:** anything that can lead to one (unit holds, prices, payment plans, lease signature, maintenance spend, commissions) stops at **draft**. The binding decision is always a person's, through the existing two-person approval.
- **Contacting people:** anything that talks to customers must say it's an AI and let a person take over at any time.
- **Reaching out first:** anything that initiates contact must respect the market's quiet hours and opt-out lists.
- **Calls:** callers are asked for consent before anything is recorded or transcribed.
- **Data:** the AI reads only what the acting user may read. It runs as a read-only "AI assistant" actor with that user's permissions.

**Guardrails used across the list:**
- Uses only approved data: published inventory, approved prices and approved plans.
- Gives no legal or financial advice.
- Explains its reasons and lets staff override with a reason recorded.
- Labels forecasts as estimates.
- A person verifies extracted data before it's saved.
- Per-organization usage limits.

## What's included

| Area | Capabilities | Milestone |
|---|---|---|
| **Conversations** | Instant replies on WhatsApp, web chat, SMS and email, in the customer's language, using approved data only. Translation across 7 languages. Voice-note transcription. Conversation summaries. Follow-up sequences. | 7–10 |
| **AI calling** | A voice agent for inbound and outbound calls that discloses it's an AI, asks consent to record, qualifies callers, books viewings and hands off to a person. Live call assist for staff. Call summaries. | 10 |
| **Leads** | Intent extraction (budget, area, type, timeline, financing). Explainable lead scoring with your own weights. Property matching. A ranked next-best-action list for each advisor. VIP routing. Launch-night surge triage. Viewing scheduler. Unit-hold drafts. Client-registration assistant. | 9 |
| **Automation** | A workflow builder (trigger, condition, action), with an autonomy level for each action. A workspace copilot that answers questions about your own data within your permissions. Document checklists. | 7–9 |
| **Developer inventory** | Listing and brochure copywriter (English and Arabic). Spreadsheet import mapping. Pricing suggestions, which produce a draft version only. A plain-language payment-plan explainer. | 7–9 |
| **Property management** | Tenant-request triage (urgency and category). A tenant assistant on WhatsApp and web. Work-order drafts. A preventive maintenance planner. Vendor quote comparison. A renewal assistant. Lease abstraction from documents. Rent reminders. Inspection reports from photos. | 7–10 |
| **Insights** | Occupancy and renewal forecasts. Demand insights. Channel attribution. An area-profile writer from licensed data sources. | 9–11 |
| **Website** | A website concierge that answers product questions and books demos. A home-search assistant over published listings. | 7, 11 |

## What each one depends on

Every capability lists what it needs: the AI provider (Claude), WhatsApp, SMS, email, telephony, document storage, maps, ad channels or web chat. Until the matching connector is set up and passes a real connection check (Platform, Integrations), the capability stays off, and the app says why.

## On the marketing site

The site describes what each capability does. Until a capability has shipped, it carries an "In development" label, and nothing is presented as live. No performance figures are shown.
