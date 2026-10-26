# 04 — SDK API (Unleash-compatible)

**Hard requirement.** An unmodified official Unleash SDK, pointed at this
service with a valid token, behaves exactly as it does against Unleash for every
flag configuration our model can express.

Only the endpoints below are implemented. Any other path under `/api/client`,
`/api/frontend` or `/edge` returns `404`.

## Common rules

- **Base path.** The service is reachable at a configurable base URL. All paths
  below are relative to it. SDKs are configured with `<base>/api`.
- **Authentication.**
  - The token is read from the `Authorization` header.
  - A `Bearer ` prefix is accepted and stripped.
    Ref: `upstream:src/lib/middleware/bearer-token-middleware.ts`.
- **Errors.**
  - Missing or unknown token → `401`.
  - Valid token of the wrong type → `403`.
    Ref: `upstream:src/lib/middleware/backend-token-middleware.ts`, `upstream:src/lib/middleware/frontend-token-middleware.ts:70-74`.
- **Environment.** Always taken from the token record, never from the request.
- **Projects.** We have none. The SDK-visible project name is always `default`.
  A `project` query parameter of `default` (or none) is accepted. Any other
  value gives an empty feature list.
- **Content type.** `application/json` in both directions.
- **Response header.** Include `X-Unleash-Version: <our version>` (some SDKs log it).

## API tokens

| Field | Notes |
|-------|-------|
| secret | Stored so that it cannot be read back (e.g. hashed). Shown in full only once, at creation. |
| type | `backend` or `frontend`. Unleash's legacy `client` type is accepted and treated as `backend`. |
| environment | `development`, `uat` or `production`. Never `*`. |
| name | Human label, e.g. "payments-service prod". |
| created_at, created_by, last_used_at | `last_used_at` is accurate to about a minute. |

**Secret format** (new tokens). Unleash v1 style, so SDK logs and tooling look familiar:
`default:<environment>.<56 lowercase hex chars>` (28 random bytes).
Ref: `upstream:src/lib/services/api-token-service.ts:448-455`.

**Entering an existing secret.**
- In the admin UI, an admin can add a token by typing in a secret they already have, plus its type
  and environment ([05](05-admin-ui.md) screen 8). Apps already configured with that secret then
  work without changes. No bulk import is required.
- Any well-formed secret is accepted, including the Unleash `*:env.` and `[]:env.` prefixes and
  the v2 `….v2_…` format (`upstream:src/lib/authentication/authorization-token.ts:7-13`).
- Lookup is by exact secret.

**Default tokens for local development.**
- When run for local development, the service provides the six tokens listed in
  [`reference-data/default-tokens.json`](reference-data/default-tokens.json): a backend and a
  frontend token for each environment, with fixed secrets. The test bench in `testbench/` uses
  them, so it works against a local install without setup.
- How they are created (seed data, startup, a local profile) is not specified.
- They **must never exist in a production deployment**.

Only `backend` and `frontend` tokens exist. These SDK tokens grant no access to the admin
application; how admin users sign in is covered in [07](07-access-control-and-audit.md).

---

## Client API (backend SDKs, Unleash Edge, Unleash Proxy)

Requires a `backend` token.

### `GET /api/client/features`

Ref: `upstream:src/lib/features/client-feature-toggles/client-feature-toggle.controller.ts:132,300-338`, schema `upstream:src/lib/openapi/spec/client-features-schema.ts`.

**Query parameters**

| Param | Behaviour |
|-------|-----------|
| `namePrefix` | Return only flags whose name starts with it (case-sensitive). |
| `tag` | Repeatable, format `type:value`. Matches flags tagged `value`. The `type` part is ignored, because we have no tag types. |
| `project` | See *Projects* above. |

**Response `200`**

```json
{
  "version": 2,
  "features": [ /* ClientFeature, sorted by name */ ],
  "query": { "environment": "production", "project": ["default"] },
  "meta": { "revisionId": 1234, "etag": "\"<hash>:1234:v1\"", "queryHash": "<hash>" }
}
```

- `meta` is optional (upstream sends it; SDKs don't need it). When present, its `etag` equals the
  `ETag` header.
- `segments` is omitted. We never emit segment references, so SDKs of every
  spec version are satisfied (`upstream:src/lib/services/client-spec-service.ts:10-14`).
- `query` echoes the effective filters.

**ClientFeature** (`upstream:src/lib/features/client-feature-toggles/client-feature-toggle-store.ts:189-262`):

```json
{
  "name": "debit-card-payments",
  "type": "release",
  "description": "…",
  "project": "default",
  "enabled": true,
  "stale": false,
  "impressionData": false,
  "strategies": [ /* compiled, see 03 */ ],
  "variants": []
}
```

- Every strategy has exactly `name`, `constraints`, `parameters`, `variants: []`.
  - All parameter values are **strings**.
  - Never include strategy `id`, `title`, `sortOrder` or `segments`. Upstream
    strips the strategy `id` because it breaks old Go SDKs.
- `type` is always `"release"`.
- Archived flags are never included.

**ETag** (upstream behaviour: `…controller.ts:306-319,358-366`)
- Every `200` response carries a quoted `ETag`. SDKs treat it as opaque, so its format is free.
  Upstream uses `"<queryHash>:<revisionId>:v1"`.
- The ETag **must change** whenever the response for that environment and query would change:
  flag, rule, switch, archive, or a change to the context-field settings. It **must not change**
  otherwise, including when another environment changes.
- If `If-None-Match` equals the current ETag → `304`, empty body.
- Served from the in-memory cache, never with a database query per request. The cache is kept
  current by LIVE queries, so a change shows in the next response
  ([11](11-storage-and-data.md)).

### `GET /api/client/features/:name`

- Returns a single ClientFeature.
- `404` if the flag doesn't exist or is archived.
- Ref: `…controller.ts:112`.

### `POST /api/client/register`

- Body per `upstream:src/lib/openapi/spec/client-application-schema.ts`.
  Loose validation: requires `appName`. Accepts and ignores unknown fields.
- Response: `202`, empty body.
- Records `(appName, instanceId, sdkVersion, environment, last_seen)` for the
  "Connected apps" view ([08](08-metrics-and-housekeeping.md)).
- Ref: `upstream:src/lib/features/metrics/instance/register.ts:44-93`.

### `POST /api/client/metrics`

- Body per `upstream:src/lib/openapi/spec/client-metrics-schema.ts`:

  ```json
  { "appName": "payments", "instanceId": "pod-1", "sdkVersion": "unleash-client-java:9.2.0",
    "bucket": { "start": "…", "stop": "…",
                "toggles": { "debit-card-payments": { "yes": 120, "no": 3, "variants": {} } } } }
  ```

- The environment comes from the token.
- Counts unknown flag names separately. They are not attached to flags; see [08](08-metrics-and-housekeeping.md).
- Response `202`. Malformed body → `400`.
- Answers without waiting for the metrics to be processed. The results
  ([08](08-metrics-and-housekeeping.md)) may follow shortly after.
- Ref: `upstream:src/lib/features/metrics/instance/metrics.ts:70`.

### `POST /api/client/metrics/bulk`: only if Unleash Edge is deployed

- Body: `{applications[], metrics[]}`, per `upstream:src/lib/openapi/spec/bulk-metrics-schema.ts`.
- Keep only `metrics[]` rows whose `environment` equals the token's environment
  (`…/metrics.ts:250-259`).
- Response `202`.

### `POST /edge/validate`: only if Unleash Edge is deployed

- Body: `{ "tokens": ["…", "…"] }`.
- Response `200`: `{ "tokens": [ { "token": "…", "type": "backend|frontend", "projects": ["*"], "environment": "production" } ] }`.
- Only valid tokens are returned.
- Ref: `upstream:src/lib/routes/edge-api/index.ts:45`, `upstream:src/lib/openapi/spec/validated-edge-tokens-schema.ts`.

---

## Frontend API (browser and mobile SDKs)

Requires a `frontend` token.
Ref: `upstream:src/lib/features/frontend-api/frontend-api-controller.ts`.

### `GET /api/frontend` and `POST /api/frontend`

**Input.** The evaluation context comes from:
- **GET:** query parameters, e.g. `?userId=1001&properties[brand]=bank-c&appName=ios`.
  Top-level unknown keys are also moved into `properties`.
- **POST:** body `{ "context": { … } }`.

The context is built as described in [03 § Server-side evaluation](03-evaluation-and-compilation.md#server-side-evaluation-frontend-api).
- `environment` comes from the token.
- `remoteAddress` defaults to the client IP.
- `sessionId` defaults to random.

**Response `200`.** Only flags that evaluate to **enabled** are listed
(`upstream:src/lib/features/frontend-api/frontend-api-service.ts:89-116`):

```json
{ "toggles": [
  { "name": "debit-card-payments", "enabled": true, "impressionData": false,
    "variant": { "name": "disabled", "enabled": false, "feature_enabled": true, "featureEnabled": true } }
]}
```

- Header: `Cache-Control: no-cache`.
- An `ETag` is optional. If one is sent, honour `If-None-Match` → `304`.

### `POST /api/frontend/client/metrics`

- Same body as the client metrics endpoint.
- Response `200`.
- Ref: `…frontend-api-controller.ts:120`.

### `POST /api/frontend/client/register`

- Response `200`. Recorded like the backend register endpoint.
- Ref: `…frontend-api-controller.ts:142`.

### CORS (Frontend API only)

Ref: `upstream:src/lib/middleware/cors-origin-middleware.ts`, `upstream:src/lib/app.ts:129-136`.

- Allowed origins = `settings.frontend_cors_origins`. An empty list, or one
  containing `*`, means `*`.
- Send `Access-Control-Allow-Credentials: true`, `Access-Control-Expose-Headers: ETag`
  and `Vary: Origin`.
- Answer preflight `OPTIONS` requests.
- Allow the `Authorization`, `Content-Type`, `If-None-Match` and
  `unleash-*` request headers. SDKs send `unleash-appname`, `unleash-sdk` and
  `unleash-connection-id`.

### Mobile SDKs

The iOS and Android SDKs use the same Frontend API endpoints. Native apps send
no CORS preflight.

---

## Health

- `GET /health` → `200 {"health":"GOOD"}`. Unauthenticated.
- Used by load balancers and by Edge.

## Rate limits and payload limits

- Request body max is 1 MB.
- No per-token rate limiting in v1. Volume is small.
