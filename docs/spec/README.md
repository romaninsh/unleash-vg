# Flag service: specification

An Unleash-compatible feature-flag service. It keeps Unleash's
**SDK-facing API** so existing mobile, frontend and backend apps keep working
without code changes, while the admin side is rebuilt around a much simpler
model: **flags × environments × brands**, on/off with percentage rollout and
customer allowlists.

Status: **draft for implementers**.

The **SDK API ([04](04-sdk-api.md)) is the only external contract.** Everything else (admin UI,
access control, audit, metrics) is specified as behaviour. The technology is the implementer's
choice, with one exception: data is stored in **SurrealDB**, and changes propagate through its
LIVE queries ([11](11-storage-and-data.md)).

## Reading order

| # | Document | What it answers |
|---|----------|-----------------|
| 01 | [Scope](01-scope.md) | What's in, what's deliberately left out, and why |
| 02 | [Domain model](02-domain-model.md) | Entities, fields, invariants |
| 03 | [Evaluation & compilation](03-evaluation-and-compilation.md) | How a flag's rules become Unleash strategies; hashing; worked examples |
| 04 | [SDK API (Unleash-compatible)](04-sdk-api.md) | Client API, Frontend API, metrics, tokens, CORS, ETags |
| 05 | [Admin UI](05-admin-ui.md) | General requirements for every admin page (G1–G7), then screens and behaviour |
| 07 | [Access control & audit log](07-access-control-and-audit.md) | Users, roles, per-environment permissions, events |
| 08 | [Usage metrics & housekeeping](08-metrics-and-housekeeping.md) | Last seen, counts, stale, archive, tags |
| 09 | [Acceptance criteria](09-acceptance.md) | What must hold for an implementation to be accepted (how to test it is up to the implementers) |
| 10 | [Open questions & assumptions](10-open-questions.md) | Things to verify before/while building |
| 11 | [Storage, caching & safe changes](11-storage-and-data.md) | SurrealDB and LIVE queries, SDK cache with instant updates, natural-key ids, idempotent changes, per-field merging of concurrent edits |

Document numbers are kept stable so links to them stay valid. 06 (management API) was removed
as an implementation detail. 09 no longer covers migration from Unleash, which is out of scope.

`reference-data/` — the demo data set: brands and flags, with app groups and rules. Any
implementation of this spec can load it.
The Unleash screens used during design aren't included here.

## Glossary

| Term | Meaning here |
|------|--------------|
| **Flag** | A named on/off switch, e.g. `debit-card-payments`. |
| **Environment** | `development`, `uat`, `production`. |
| **Brand** | A white-label tenant served by the installation, e.g. `bank-a`. Not to be confused with Unleash "clients" (SDKs). |
| **Customer** | An end user of a brand, identified by a **globally unique** customer ID. |
| **Rule** | What a flag does for a scope: a rollout percentage (0–100) plus an optional customer allowlist. |
| **Default rule** | The rule for all brands that have no override. |
| **Brand override** | A rule that replaces the default for one brand. |
| **SDK** | Any official Unleash client library an app embeds (server-side or frontend/mobile). |
| **Upstream** | The open-source Unleash repository, used as a behavioural reference only. |

## Referencing upstream source

All upstream references point at
[`Unleash/unleash`](https://github.com/Unleash/unleash) commit
`bd4120613a7bcc99ff40babcff1d2f0a674ed531` (2026-10-16) and are written as
`upstream:<path>:<line>`, e.g.
`upstream:src/lib/features/client-feature-toggles/client-feature-toggle.controller.ts:132`.

> **Licensing — read before opening upstream code.** Upstream is licensed
> **AGPL-3.0**. Use it to learn *behaviour* (routes, JSON shapes, status codes,
> algorithms). **Do not copy or adapt its source code** into this project. The
> SDKs that apps use are separately licensed and are not affected.
