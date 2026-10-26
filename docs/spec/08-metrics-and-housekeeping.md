# 08 — Usage metrics & housekeeping

## Usage metrics

Usage metrics answer "is this flag still evaluated, and where?" so that dead
flags can be cleaned up. This is not product analytics.

They come from SDK metric posts (`/api/client/metrics`,
`/api/frontend/client/metrics`, and `/api/client/metrics/bulk` if Edge is used).
See [04](04-sdk-api.md).

**Stored data**

| Store | Key | Values | Shown for |
|-------|-----|--------|-----------|
| Hourly buckets | (flag, environment, appName, hour) | yes, no | the last `settings.metrics_retention_days` (default 30) |
| Last seen | (flag, environment) | last_seen_at | always (overwritten) |
| Unknown flags | (name, environment, appName) | last_seen_at, count | the last 7 days |
| Connected apps | (appName, environment, instanceId) | sdkVersion, last_seen_at | 7 days after last seen |

There are no scheduled jobs. Older rows are kept and filtered out of the views by date, not deleted on a
timer. Pruning them is an on-demand operational task that an admin starts, and is not part of
this build.

**Rules**
- A flag counts as "seen" when `yes + no > 0` in a posted bucket.
  Ref: `upstream:src/lib/features/metrics/last-seen/last-seen-service.ts:56-74`.
- `last_seen_at` is the time the service received the metrics, not `bucket.stop`.
  Client clocks are unreliable.
- Variant counts are ignored.
- Posted metrics show up in "last seen" and the counts shortly after they arrive. Batching is
  allowed (upstream flushes every 30 s, `upstream:src/lib/features/scheduler/schedule-services.ts:44-53`).
  Losing the most recent, not yet stored counts in a crash is acceptable.
- The admin UI shows the new values without a reload ([05](05-admin-ui.md) G4).
- Metrics carry no brand or customer, so usage is **per environment and app
  only**. That's an SDK limitation; we don't work around it.

**Shown in the UI**
- Flags list: last seen.
- Flag detail: per-environment last seen, plus yes/no for the last 24 h and 7 d.
- Connected apps screen.

## Stale flags

- `stale` is a manual flag, set and cleared in the UI ([05](05-admin-ui.md)) and audited.
- It is served to SDKs as `"stale": true`, which is informational only.
- The flags list can filter "not seen in N days" (`settings.unused_flag_days`) to help find
  stale candidates. This is only a hint; nothing is marked stale automatically.

## Archive

- Archiving hides the flag from SDKs immediately (it's removed from client
  responses, and the ETag revision bumps).
- Its rules are kept.
- The name stays reserved until permanent deletion.
- Revive restores the rules with every environment switch OFF.
- Permanent delete (admin) removes the flag, its environment configs and its
  metric buckets. Audit events are kept.

## Tags and descriptions

- Tags are free-form lowercase strings (e.g. `payments`, `auth`, `team:cards`).
  There are no tag types.
- They are used for filtering in the UI and in the client API `tag` query
  parameter ([04](04-sdk-api.md)).
- Descriptions are plain text, up to 2,000 characters.
