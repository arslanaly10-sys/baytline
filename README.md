# Baytline (working name)

A GCC real estate platform connecting developers, property management companies, brokerages and agents, and buyers, investors, renters and tenants. AI handles repetitive work; people keep control of important decisions.

**Status: milestone 4 (developer workspace).** Sign-in, organizations, role-based workspaces enforced on the server and in PostgreSQL row-level security, audit history, platform administration, and the developer workspace: projects, units with provenance, versioned pricing and payment plans with two-person approval, documents and brokerage sharing. There's no live inventory connection; everything is entered in the workspace and labelled by source.

## Run it locally

Needs Node 22+, pnpm 10 and PostgreSQL 16+.

```bash
pnpm install
cp .env.example apps/web/.env.local   # then set real local passwords (CHANGE_ME)
pnpm db:setup                         # creates the 3 database roles + database, runs migrations
pnpm db:seed-dev                      # optional: labelled placeholder accounts (needs DEV_SEED_PASSWORD)
pnpm dev                              # http://localhost:3000
```

First real platform administrator (no password is ever printed; you choose it from the link):

```bash
pnpm db:bootstrap-admin -- --email you@yourcompany.example
```

- **Checks:** `pnpm typecheck`, `pnpm test` (the identity tests need the local PostgreSQL), `pnpm build`.
- **Reset local data:** `pnpm db:setup -- --reset`.
- **Placeholder accounts:** `*@placeholder.test` (including `platform-support@` for read-only staff), for local development only. They're labelled in the UI and the seeding script refuses to run in production.

## Layout

```
apps/web/                    Next.js 16 app (App Router, React 19, Tailwind v4)
  src/proxy.ts               locale redirect only (never access control)
  src/server/guards.ts       page gate: session, org membership, section capability
  src/server/actions/        server actions (auth, team, organizations)
  src/app/[locale]/(auth)/   sign-in, sign-up, forgot/reset password, invitations
  src/app/[locale]/o/[orgId] org-scoped workspace: overview, team, audit, organizations, section shells
packages/core/               framework-free rules: roles, permissions, membership rules, audit event types
packages/db/                 pg pools, RLS transaction helper, SQL migrations, local provisioning
packages/identity/           auth, sessions, recovery, orgs, invitations, members, audit; integration tests
packages/platform/           admin services: org directory and profiles, users, markets, integration registry
packages/developer/          developer services: projects, units, pricing, payment plans, documents, partner sharing
docs/                        architecture, identity, roadmap, permission matrix, decisions
```

## Key docs

- [Identity, tenancy and audit](docs/identity.md): how auth works and where authorization is enforced
- [Platform administration](docs/platform-admin.md): admin screens, permissions and protections
- [Developer workspace](docs/developer-workspace.md): workflows, data structures and enforcement
- [Architecture, data domains, inventory sources, AI boundaries](docs/architecture.md)
- [Permission matrix](docs/permission-matrix.md) (generated) and [Roadmap](docs/roadmap.md)
- [Decision records](docs/decisions/README.md)

## Ground rules

- No secrets in git. `.env.example` lists names only; real values come from a secret manager.
- No invented data, live integrations or verified inventory. Placeholder accounts are labelled.
- No email provider is connected yet, and the app says so rather than pretending to send.
- AI drafts, translates, summarizes and suggests. Holding units, changing prices and financial commitments go through explicit human authorization and approval.
