# 01 — Scope

## Context

- The service is for white-label products, where one installation serves several brands.
- ~140 flags in one flat list (e.g. debit card payments, SSO).
- Flags are read by **mobile apps, web frontends and backends**, all through
  official Unleash SDKs. One shared multi-tenant platform serves all brands, so
  apps identify the brand in the evaluation context.
- Most flags have the same value for every brand. Per-brand differences are
  occasional. Per-customer targeting (explicit IDs, % rollout) is used sometimes.

## Goals

1. **Drop-in for SDKs.** Existing apps work against the new service by changing only its URL and
   token. The SDK API ([04](04-sdk-api.md)) is the **only** external contract.
2. **Simple admin model.** Brand is a first-class concept; editing a flag means
   "default + a few brand overrides", not composing strategies and constraints.
3. **Audit-ready.** Every change is attributable and reviewable (white-label tenants).
4. **Scalable, live admin.** Admin pages stay fast and up to date as data grows ([05](05-admin-ui.md) G1–G7).
   Admins may use a web or a desktop app; editors and viewers use only a web browser.
5. **Small.** Nothing that isn't listed under *In scope*.
6. **Implementation-neutral, except storage.** The spec states behaviour, not technology. Any stack
   that meets it qualifies, including low-code or declarative platforms. The one fixed choice is
   **SurrealDB** for storage, using its LIVE queries for instant change propagation
   ([11](11-storage-and-data.md)).
7. **Safe to retry.** Every change is idempotent, and concurrent edits to different fields never
   undo each other ([11](11-storage-and-data.md)).

## In scope

| Capability | Notes | Unleash reference |
|------------|-------|-------------------|
| Flat flag list, create/edit/describe | No projects | Unleash's flags overview |
| Environments: development, uat, production | Fixed list | Unleash's environments and API tokens |
| Per-environment master switch | Unleash "environment enabled" | Unleash's flag page, environments section |
| Brands (add/rename/deactivate) | New concept | — |
| Default rule + brand overrides | Compiled to Unleash strategies | [03](03-evaluation-and-compilation.md) |
| % rollout, sticky by customer ID | Unleash `flexibleRollout` | `upstream:src/lib/features/feature-toggle/default-strategy.ts:3` |
| Customer allowlists | Unleash `IN` constraint | `upstream:src/lib/openapi/spec/constraint-schema.ts` |
| Client API (backend SDKs) | Compatible | [04](04-sdk-api.md) |
| Frontend API (web/mobile SDKs) | Compatible | [04](04-sdk-api.md) |
| Edge endpoints (`/edge/validate`, bulk metrics) | Only if the deployment runs Unleash Edge — see [10](10-open-questions.md) | `upstream:src/lib/routes/edge-api/index.ts:45` |
| API tokens per environment (backend / frontend) | Created, or entered by hand with an existing secret | `upstream:src/lib/services/api-token-service.ts:448` |
| Default tokens for local development | Six fixed tokens, used by the test bench; never in production | [reference-data](reference-data/default-tokens.json) |
| Reference demo data: 6 brands, 23 flags | Loadable by any implementation | [reference-data](reference-data/README.md) |
| Audit log with before/after diff, export | | Unleash's event log (list and full event) |
| Users, local login, roles with per-environment edit rights | | [07](07-access-control-and-audit.md) |
| Usage metrics: last seen, yes/no counts | From SDK metrics | [08](08-metrics-and-housekeeping.md) |
| Archive / revive / permanent delete | | [08](08-metrics-and-housekeeping.md) |
| Stale marking | | [08](08-metrics-and-housekeeping.md) |
| Tags and descriptions | Free-form tags, no tag types | [08](08-metrics-and-housekeeping.md) |

## Out of scope (explicitly)

| Unleash feature | Why dropped | Unleash screen |
|-----------------|-------------|----------------|
| Projects | One flat list keeps the model simple | Unleash's project flag list (layout only) |
| Segments (reusable constraint sets) | Allowlists cover the same need | Unleash's segments list and segment creation steps |
| Variants / payloads / A/B experiments | Flags are on/off only | — |
| Arbitrary constraints & operators (dates, semver, regex, …) | Only brand + customer targeting needed | — |
| Custom strategy types, strategy editor | Replaced by rule model | Unleash's custom strategy types |
| Flag types & expected lifetimes | Not used | Unleash's feature flag types |
| Lifecycle stages, analytics dashboards, insights | Not used | Unleash's analytics |
| Integrations (Slack, Teams, Datadog, webhooks) | Not used | Unleash's integrations |
| Change requests / 4-eyes approval | Not required | — |
| SSO / OIDC / SAML | Local accounts suffice | — |
| Playground | Not used | — |
| Flag dependencies (parent flags), links/resources | Not used | Unleash's flag page, environments section (sidebar) |
| Unleash Admin API compatibility | Apps only use the SDK API | — |
| A specified management / admin API | How the admin application talks to its storage or server is an implementation detail | — |
| Migration tooling from Unleash (importer, parity checks, cutover plan) | Not part of this build | — |
| Command menu, onboarding, "Connect SDK" wizards | UX chrome | — |
| Delta / streaming client API | Polling is sufficient | — |
| Impression data | Always `false` | — |
| Multi-language UI, theming | — | — |
