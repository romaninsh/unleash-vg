# 07 — Access control & audit log

## Users

| Field | Notes |
|-------|-------|
| id, name, email | Email is unique and is the sign-in name. |
| password | Stored only as a slow, salted password hash, never readable. Minimum length 12. |
| role | `viewer`, `editor` or `admin`. |
| editable_environments | Subset of {development, uat, production}. Only meaningful for `editor`. |
| active | Inactive users can't sign in, and lose access immediately, including any open session. |
| must_change_password, last_sign_in_at, created_at | |

- Signed-in access expires after 8 hours, or after 30 minutes of inactivity.
- 10 failed sign-ins within 15 minutes lock the account for 15 minutes.
- Installing the system includes a way to create the first admin account.
- There is no self-registration.
- Passwords are set by an admin when a user is created and when one is reset. Nothing is emailed:
  there is no address verification and no reset link ([05](05-admin-ui.md) §9).

## Roles and permissions

Permissions are **per environment only**, not per flag or per brand.

| Permission | viewer | editor | admin |
|------------|:------:|:------:|:-----:|
| View everything (flags, rules, audit log, apps, metrics) | ✓ | ✓ | ✓ |
| Export audit log / flag list | ✓ | ✓ | ✓ |
| Create flag | | ✓ | ✓ |
| Edit flag metadata (description, tags, stale), archive, revive | | ✓ | ✓ |
| **Edit environment E** (switch + rules) | | if E ∈ editable_environments | ✓ (all) |
| Delete archived flag permanently | | | ✓ |
| Brands, API tokens, users, settings | | | ✓ |

Typical setup: developers are `editor` with {development, uat}, and release
managers are `editor` with all three environments.

Viewers and editors use only a web browser and can do all of the above there. Admins may use a web
or a desktop app ([05](05-admin-ui.md), "Web and desktop access"). The same accounts and
permissions apply in both.

Permissions are enforced by the system itself, on every route a user can reach (UI, any API,
scripts). Hiding or disabling controls in the UI is not enough on its own.

## Audit log

Every state change writes an **immutable** event **atomically** with the change: both happen, or
neither does. Events are keyed by the change's operation id, so a retried change never records a
second event ([11](11-storage-and-data.md)). No user, role or API can edit or delete events, and the
log cannot be written to directly, so entries can't be forged. Events stay after a flag is
permanently deleted.

The shape follows Unleash (`upstream:src/lib/openapi/spec/event-schema.ts`,
`upstream:src/lib/features/events/event-store.ts:48-62`).

| Field | Notes |
|-------|-------|
| id | Unique; orders events in the sequence they happened |
| type | See the table below |
| created_at | Time of the change (UTC), from the system, not from the user's device |
| created_by | The user who made the change (email), or `system` |
| created_by_user_id | |
| ip | Where the change came from, when the platform knows it |
| flag | Optional |
| environment | Optional |
| brand | Optional. Set for brand-override changes. |
| group_id | Shared by all events written by one save |
| summary | Human-readable one-liner |
| pre_data | Values before the change (optional) |
| data | Values after the change (optional) |

The user recorded in `created_by` must be the one actually signed in. It cannot be supplied by the
client.

### Event types

Names reuse Unleash's where the meaning is the same (`upstream:src/lib/events/index.ts`).

| Type | When | Per-event scope |
|------|------|-----------------|
| `feature-created` | Flag created | flag |
| `feature-metadata-updated` | Description changed | flag |
| `feature-tagged` / `feature-untagged` | Tag added or removed (one event per tag) | flag |
| `feature-stale-on` / `feature-stale-off` | | flag |
| `feature-archived` / `feature-revived` / `feature-deleted` | | flag |
| `feature-environment-enabled` / `feature-environment-disabled` | Switch | flag, env |
| `feature-default-rule-updated` | Default rule changed | flag, env |
| `feature-brand-override-added` / `-updated` / `-removed` | Per brand | flag, env, brand |
| `brand-created` / `brand-updated` / `brand-deleted` | | brand |
| `api-token-created` / `api-token-registered` / `api-token-deleted` | `data` holds name, type and env, **never the secret** | env |
| `user-created` / `user-updated` / `user-deactivated` / `user-password-reset` | | — |
| `user-login` / `user-login-failed` | | — |
| `settings-updated` | | — |

One save of an environment's rules that changes the default and two overrides writes 3 events,
all with the same `group_id`. The UI can show them together, as Unleash's event log screen shows a
"Group id".

### Retention

Kept indefinitely. Exported regularly by operations (see [10](10-open-questions.md)).
