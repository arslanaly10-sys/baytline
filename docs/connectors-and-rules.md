# Connectors, market rules and admin MFA (milestone 11)

## Connectors

Connectors are provider adapters in `packages/platform/src/connectors/`. Each one:
- reads its secrets only from the server environment, and the UI shows names and present/missing, never values;
- has a **real connection check** with no side effects, run from Platform → Integrations and recorded in `app.integration_checks`;
- reports failures as fixed sentences, never provider replies, because those can echo user names, hosts or keys.

| Connector | Secrets | Check | Use |
| --- | --- | --- | --- |
| **Email** (any SMTP service) | `MAIL_SMTP_URL` (`smtps://…:465`, or `smtp://…:587` with STARTTLS; plain SMTP is refused in production), `MAIL_FROM` | Connects, upgrades to TLS, signs in. **Sends nothing.** | Invitations and password-reset emails, once configured (`apps/web/src/server/db.ts`). Without it, the console outbox still works in development only. |
| **Document storage** (Amazon S3 or an S3-compatible service) | `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`; optional `STORAGE_ENDPOINT` (https only) | `HeadBucket`: proves the key and bucket. **Writes nothing.** | `documentStore()` gives `put` (server-side encrypted), short-lived signed downloads (1–60 minutes) and `remove`. Keys are always `orgs/<orgId>/<folder>/<name>`. No screen uploads files yet; that comes with document features. |

**Connector status** on the Integrations page is worked out from what actually happened. It is "connected" only when all of these hold:
- the adapter exists;
- it's switched on;
- every secret is present;
- the latest check succeeded within 24 hours.

**For the AI gateway**, `app.connector_ready(key)` gives the same answer from the database: switched on, and the latest check succeeded within 24 hours.
- A capability that needs email or document storage stays blocked as `dependency_unavailable` until then.
- Telephony and web chat have no connector, so capabilities that need them stay blocked.
- No check runs on a schedule yet. Readiness lapses after 24 hours unless someone runs the check again.

## Market rules and fees through two-person approval

`app.market_rules` holds one slot per market and category, and every slot starts at **Needs setup**. Baytline fills in nothing. Changes go through `app.market_rule_changes`:

1. **Propose.** A platform administrator (`platform.market_rules.propose`) enters:
   - what applies, as the source states it, in English and optionally Arabic;
   - optionally a rate (%), a fixed amount in the market's currency, and who pays;
   - a **source** a second person can check;
   - an **effective date**.

   Only one proposal per rule can be waiting at a time.
2. **Decide.** A **different** platform administrator or compliance officer (`platform.market_rules.approve`) approves, or rejects with a reason. The database refuses a decision by the proposer (`own_proposal` and a check constraint), and the app role has no write access to either table.
3. **Apply.** Approval copies the value, source and date to the rule and marks it **Configured**. The previous approved value becomes **Replaced**; values are never edited in place. Proposers can withdraw a proposal while it's waiting.

Every step is audited (`market_rule.*`). Nothing in the app uses these values for calculations yet.

## Admin MFA

See [identity.md](identity.md#two-step-sign-in-milestone-11). In short:
- Platform staff must have two-step sign-in. It's enforced in three places: the page guard, the service layer and the database.
- Anyone else may turn it on.
- Secrets are encrypted with `BAYTLINE_MFA_KEY`, which must be set in production.
