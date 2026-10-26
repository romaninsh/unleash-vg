# 02 — Domain model

Field types are logical. Data is stored in SurrealDB, with record ids derived from natural keys
(no auto-generated ids); see [11](11-storage-and-data.md).

## Environment

Fixed set seeded at install: `development`, `uat`, `production`.

| Field | Type | Notes |
|-------|------|-------|
| key | string | Immutable. Must match the environment names the apps' SDK tokens are issued for. |
| display_name | string | |
| sort_order | int | UI order: development, uat, production. |

There is no UI to add/remove environments in v1.

## Brand

| Field | Type | Notes |
|-------|------|-------|
| key | string | Immutable, `^[a-z0-9][a-z0-9-]{0,62}$`. **This is the exact value apps send in the brand context field.** Matching is case-sensitive. |
| display_name | string | e.g. "Bank A". |
| active | bool | Inactive brands are hidden from override pickers; existing overrides still apply. |
| created_at, created_by | | |

A brand with overrides cannot be deleted; deactivate it instead.

## Flag

| Field | Type | Notes |
|-------|------|-------|
| name | string | Identifies the flag; immutable. `^[A-Za-z0-9._-]{1,100}$` (Unleash-compatible). Unique **including archived flags**. |
| description | text, nullable | |
| tags | set of string | Free-form, lowercase, `^[a-z0-9:_-]{1,50}$`. A flag's app group can be kept as a tag `group:<name>` (see [reference-data](reference-data/README.md)). |
| stale | bool | Manual marker. |
| archived_at | timestamp, nullable | Archived flags are invisible to SDKs. |
| created_at, created_by | | |

## FlagEnvironment (one per flag × environment, created with the flag)

| Field | Type | Notes |
|-------|------|-------|
| flag, environment | key | |
| enabled | bool | Master switch. `false` ⇒ flag is off for everyone in this environment. New flags: `false` everywhere. |
| default_rule | Rule | New flags: `rollout=100`, empty allowlist (i.e. "ON" once the switch is turned on, the same as Unleash's default strategy). |
| overrides | map brand → Rule | Zero or more. |

Concurrent edits are merged per field; only edits to the same field are flagged to the user
([11](11-storage-and-data.md)).

## Rule (value object)

| Field | Type | Notes |
|-------|------|-------|
| rollout | int 0–100 | Percentage of customers (sticky by customer ID) for whom the flag is on. |
| allowlist | ordered set of customer ID strings | Customers for whom the flag is on regardless of `rollout`. Max 1,000 entries per rule. |

Presentation (derived, not stored):

| rollout | allowlist | UI label |
|---------|-----------|----------|
| 0 | empty | **OFF** |
| 100 | (ignored) | **ON** |
| 1–99 | any | **N%** (+ "k customers") |
| 0 | non-empty | **Only k customers** |

When `rollout = 100` the allowlist is redundant; the UI hides it and the server
may keep it (so lowering the rollout later restores the list).

### Scope semantics

- An override for brand B applies to evaluations whose brand context equals `B`.
- The default rule applies to every evaluation whose brand is **not** one of the
  overridden brands, including evaluations with **no brand** in the context.
- Customer IDs are globally unique, so an allowlist entry never needs a brand
  qualifier. An allowlisted customer still only gets ON through the rule whose
  scope they fall into (a customer of brand B, where B is overridden, is
  governed by B's override, not by the default allowlist).

## Settings (singleton)

| Field | Default | Notes |
|-------|---------|-------|
| brand_context_field | `brand` | Context property name apps use for the brand. **Must be confirmed**; see [10](10-open-questions.md). |
| customer_context_field | `userId` | Context field for customer ID; also used as rollout stickiness. **Must be confirmed.** |
| frontend_cors_origins | `[]` | Allowed origins for the Frontend API. |
| metrics_retention_days | 30 | Hourly metric buckets older than this are deleted. |
| unused_flag_days | 30 | Threshold for the "not seen" hint ([08](08-metrics-and-housekeeping.md)). |

Changing either context field name is an admin-only, audited action and changes
the compiled output of every flag.

## ApiToken, User, Event, MetricBucket

Defined in [04](04-sdk-api.md), [07](07-access-control-and-audit.md) and [08](08-metrics-and-housekeeping.md).
