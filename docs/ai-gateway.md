# AI gateway and policies (milestone 10)

Every model call in Baytline goes through one gateway, `runAi` in `packages/ai/src/gateway.ts`. No AI
feature for end users exists yet. This milestone builds the gateway, the policies it enforces, the log
it writes and the tests. Features arrive in later milestones and must call the gateway; nothing may call
the provider directly.

## Off by default, twice

- **Platform:** `app.ai_platform_settings.enabled = false`. Platform administrators turn it on and set:
  - the allowed models;
  - the default model;
  - the most any organization may budget per month;
  - a monthly cap for all organizations together;
  - the longest answer allowed;
  - how long request text is kept.
- **Organization:** with no policy row, the organization has no AI. An organization administrator (`ai_policy.manage`: developer, property-manager and brokerage admins) chooses:
  - whether AI runs;
  - which of the platform's models it may use, and its default;
  - a monthly budget in USD;
  - the longest answer;
  - whether the redacted text is kept in the log;
  - an **autonomy level per capability**.
- **Capability levels:** every capability starts **Off**. A level can't exceed the catalogue's maximum (`packages/core/src/ai-capabilities.ts`); anything leading to a binding decision stops at **Draft**. Saving a higher level is refused, not silently clamped.
- **Platform pause:** platform administrators can pause AI for an organization, with a reason the organization sees.

## What happens to every request

1. **Checks, in order.** The first failure stops the request, and the attempt is logged with its reason:
   1. the capability exists and belongs to this workspace;
   2. AI is on for the platform;
   3. the provider key is set (`AI_PROVIDER_API_KEY`);
   4. the provider isn't switched off in Integrations;
   5. the organization isn't paused, and its AI is on;
   6. the capability's level isn't Off;
   7. every connector the capability needs exists. Only the AI provider does today, so anything needing WhatsApp, SMS, email, telephony, maps and so on stays blocked as `dependency_unavailable`;
   8. the model is allowed by both the platform and the organization.
2. **Grounding** (`grounding.ts`). The caller passes facts, and each must name the record it describes and where its data came from. These are dropped before anything reaches the model:
   - facts without a source;
   - sample records;
   - prices or payment plans not from an approved version.

   Each unit fact carries its inventory label in plain words. Only *live* or *recently confirmed* may be described as available; *stale*, *unverified* and *conflicting* are stated as such. Every request also carries fixed rules: use only the given data, cite it, never invent places or prices, no legal or financial advice, and the output is a draft for a person.
3. **Redaction** (`redact.ts`). Removed from everything sent and everything stored:
   - email addresses;
   - payment card numbers (Luhn-checked);
   - IBANs;
   - UAE Emirates ID and Saudi national ID / iqama numbers;
   - phone numbers;
   - any other run of 9–15 digits.

   Prices written with separators (`1,450,000`) and unit codes are kept. This is a pattern-based safety net, so callers still pass only what a task needs.
4. **Budget reservation.**
   - The worst-case cost is reserved against the organization's monthly budget and the platform cap: the estimated input plus the full output allowance, at the model's price.
   - Reservations for one organization are serialized with an advisory lock, so concurrent requests can't overspend; a test proves it.
   - The platform-wide cap check isn't serialized, so concurrent requests from different organizations can go a little over it.
5. **Provider call**, outside any database transaction.
   - It uses the official Anthropic TypeScript SDK (`@anthropic-ai/sdk`), with `claude-opus-5-5` as the default and adaptive thinking. Effort is `medium` and set explicitly.
   - Server-side refusal fallbacks are on (`fallbacks: "default"`).
   - Each attempt is priced at the model that actually ran it.
6. **Finish.** The log row records:
   - the exact cost, tokens, served model, stop reason and latency;
   - the redacted answer.

   A refusal returns no text. A provider failure charges nothing and releases the reservation; failure codes are fixed and never carry provider text.

The gateway never acts. Whatever the level, its result is marked `requiresReview: true`.

## Log and audit

- **`app.ai_requests`:**
  - one row per attempt, blocked ones included;
  - written once, finished once, then only its text may be cleared;
  - deletion is refused.
- **Who sees what:**
  - Organization AI admins see their organization's log.
  - The requesting user sees only their own rows.
  - Platform staff see usage and cost per organization through `app.ai_usage_by_org`, never the text.
- **Retention:** `app.purge_ai_text()` clears stored text older than the platform's retention window, and metadata stays. It's an operator job and isn't scheduled yet.
- **Audit events:** `ai.requested`, `ai.blocked`, `ai_policy.updated`, `ai_platform.updated`, `ai_org.blocked`, `ai_org.unblocked`.

## Screens

- **Organization → AI policy:**
  - whether AI can run now, and why not;
  - this month's spend against the budget;
  - the policy form, with each capability's limit, rules and missing connectors;
  - *Check what would be sent*: runs every check and shows the redacted text, never calls the model and logs nothing;
  - the request log with redacted text, grounding and cost.
- **Platform → AI policies:** provider status, platform settings, total spend against the cap, and per-organization usage with pause and resume.

## Provider configuration

- **API key:** set `AI_PROVIDER_API_KEY` (an Anthropic API key) in the server's secret store. The value is never read beyond "is it set?" outside the provider client.
- **Connection check:** Platform → Integrations → AI gateway runs a token-free check (`models.retrieve`).
- **Prices:** `packages/ai/src/models.ts` lists the models and their prices; a model that isn't listed can't be allowed. Review the prices when Anthropic's pricing changes. The Claude Haiku 5.5 cache-read and cache-write rates there are estimates (10% and 125% of its input price).
