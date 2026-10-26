# 03 — Evaluation & compilation

The service stores flags in our simple model ([02](02-domain-model.md)). SDKs
only understand Unleash's model: a feature is on if the environment is enabled
**and any one** of its strategies matches. The server therefore **compiles**
each flag × environment into standard Unleash strategies when serving the SDK
API. No custom strategies are emitted, so no SDK needs custom code.

## Compilation algorithm

Inputs: flag `F`, environment `E`, settings `brandField`, `customerField`.

```
fe = FlagEnvironment(F, E)
if F.archived: do not serve F at all

strategies = []
overridden = sorted(keys(fe.overrides))           # deterministic order

for B in overridden:
    emit(fe.overrides[B], scope = [C(brandField, IN, [B])])
emit(fe.default_rule,
     scope = overridden.empty ? [] : [C(brandField, NOT_IN, overridden)])

served.enabled    = fe.enabled AND strategies not empty
served.strategies = served.enabled ? strategies : []

def emit(rule, scope):
    if rule.rollout > 0:
        strategies += flexibleRollout(rollout = rule.rollout,
                                      stickiness = stickinessFor(rule.rollout),
                                      groupId = F.name,
                                      constraints = scope)
    if rule.rollout < 100 and rule.allowlist not empty:
        strategies += flexibleRollout(rollout = 100,
                                      stickiness = "default",
                                      groupId = F.name,
                                      constraints = scope + [C(customerField, IN, rule.allowlist)])

def stickinessFor(rollout):
    if rollout == 100: return "default"
    return customerField          # e.g. "userId"
```

`C(field, op, values)` = `{"contextName": field, "operator": op, "values": values, "inverted": false, "caseInsensitive": false}`.

### Why these choices

- **`enabled = false` when no strategy is emitted.** E.g. default OFF with no
  overrides. We never serve "enabled with zero strategies", whose meaning varies
  across SDK versions.
- **`NOT_IN` for the default scope.** SDKs treat `NOT_IN` on a missing context
  field as a match. So an evaluation with no brand gets the default rule, as
  [02](02-domain-model.md) requires (acceptance criterion A3 in [09](09-acceptance.md)).
- **`stickiness: "default"` at 100%.** In the SDKs, `default` uses `userId`,
  falls back to `sessionId`, then to random. At 100% the bucket doesn't matter,
  so ON works even without a customer in the context, e.g. a login screen
  checking `sso-login`.
- **`stickiness: <customerField>` at 1–99%.** A context without a customer ID
  evaluates to OFF instead of a random coin-flip per call. That's the
  conservative choice for financial products. When a customer ID is present, the bucket is
  the same as with Unleash's `default` stickiness, because both hash `userId`.
- **`groupId = flag name`.** This matches Unleash's default
  (`upstream:src/lib/features/feature-toggle/default-strategy.ts:3-14`,
  `upstream:src/lib/features/feature-toggle/feature-toggle-service.ts:613-636`),
  so a customer lands in the same bucket as they would in Unleash.
- **Deterministic order** (brands sorted, default last). The same data always
  gives byte-identical output, so ETags are stable.

## Percentage bucketing (for reference)

SDKs compute, per strategy:

```
normalized = murmur3_x86_32("<groupId>:<stickinessValue>", seed = 0) % 100 + 1
on  ⇔  normalized <= rollout
```

Reference port: `upstream:frontend/src/component/onboarding/intro/rolloutHash.ts`.
The server needs this only for the Frontend API, which evaluates server-side
(see below).

## Server-side evaluation (Frontend API)

The Frontend API ([04](04-sdk-api.md)) evaluates flags on the server for a
given context. It **must give identical results to the SDKs.**

- **The implementer chooses how to evaluate.** Either:
  - use Unleash's open-source evaluation as a dependency: the `unleash-client` SDK, which upstream
    embeds in-process (`upstream:src/lib/features/frontend-api/frontend-api-service.ts:199`), or
    the Rust core "yggdrasil", which has bindings for several languages; or
  - implement the algorithm manually: constraint operators `IN` / `NOT_IN`, `flexibleRollout`
    with the bucketing above, and the context rules below.
- Either way the results must match the SDKs exactly (acceptance criterion A1 in
  [09](09-acceptance.md)).
- The evaluation context is built as in
  `upstream:src/lib/features/frontend-api/create-context.ts`:
  - `appName`, `environment`, `userId`, `sessionId` and `remoteAddress` are top-level.
  - All other keys go into `properties`.
  - The engine reads the brand field and a custom customer field from `properties`.

## Worked examples

Settings: `brandField = brand`, `customerField = userId`. Flag `debit-card-payments`, environment `production`, switch ON.

### Example 1: ON for everyone (the common case)

Default `rollout=100`, no overrides.

```json
{ "name": "debit-card-payments", "enabled": true, "strategies": [
  { "name": "flexibleRollout", "constraints": [],
    "parameters": { "rollout": "100", "stickiness": "default", "groupId": "debit-card-payments" } }
]}
```

### Example 2: ON for all, OFF for Bank B, 10% + two pilot customers for Bank C

Rules:
- Default: `rollout=100`.
- Overrides:
  - `bank-b`: `rollout=0`.
  - `bank-c`: `rollout=10`, `allowlist=[1001, 1002]`.

```json
{ "name": "debit-card-payments", "enabled": true, "strategies": [
  { "name": "flexibleRollout",
    "constraints": [ { "contextName": "brand", "operator": "IN", "values": ["bank-c"], "inverted": false, "caseInsensitive": false } ],
    "parameters": { "rollout": "10", "stickiness": "userId", "groupId": "debit-card-payments" } },
  { "name": "flexibleRollout",
    "constraints": [ { "contextName": "brand",  "operator": "IN", "values": ["bank-c"],         "inverted": false, "caseInsensitive": false },
                     { "contextName": "userId", "operator": "IN", "values": ["1001", "1002"], "inverted": false, "caseInsensitive": false } ],
    "parameters": { "rollout": "100", "stickiness": "default", "groupId": "debit-card-payments" } },
  { "name": "flexibleRollout",
    "constraints": [ { "contextName": "brand", "operator": "NOT_IN", "values": ["bank-b", "bank-c"], "inverted": false, "caseInsensitive": false } ],
    "parameters": { "rollout": "100", "stickiness": "default", "groupId": "debit-card-payments" } }
]}
```

`bank-b` (rollout 0, no allowlist) emits nothing, and the default excludes it,
so Bank B is OFF.

### Example 3: OFF by default, ON only for Bank A

Default `rollout=0`; override `bank-a`: `rollout=100`.
The output is a single strategy, `rollout 100`, with constraint `brand IN [bank-a]`.
The default emits nothing.

### Example 4: Everything OFF

Default `rollout=0`, no overrides, switch ON. The output is
`"enabled": false, "strategies": []`. The admin UI still shows the switch as ON
with the rule OFF.

### Truth table for example 2

| Context | Result |
|---------|--------|
| brand=bank-a, userId=any | ON |
| no brand, userId=any | ON (default) |
| brand=bank-b, userId=1001 | OFF |
| brand=bank-c, userId=1001 | ON (allowlist) |
| brand=bank-c, userId=X, where hash(X) ≤ 10 | ON |
| brand=bank-c, userId=X, where hash(X) > 10 | OFF |
| brand=bank-c, no userId | OFF (no stickiness value at a partial rollout) |

The last row matters. Apps evaluating partial-rollout flags must send the
customer ID. Listed in [10](10-open-questions.md).
