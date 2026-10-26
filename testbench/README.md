# Flag test bench

An interactive client for testing an Unleash-compatible flag service: unleash-vg (spec in
[`../docs/spec`](../docs/spec)) or Unleash itself, side by side. It talks to a backend only
through the SDK API (spec 04), plus a read-only peek into the backend's database for the brand
list, or a static brand list for backends it can't read.

```
npm install
cp testbench.config.example.json testbench.config.json   # then edit
npm start                                                 # → http://localhost:4300
```

## What it shows

| Area | Content |
|------|---------|
| Toolbar | Target backend, environment, brand (from the backend's DB, plus "(no brand)"), customer ID (🎲 random, ∅ none) |
| Mock bank app | A white-label banking UI for the chosen brand. Known flag names drive widgets, and every widget carries a badge with the flag name and value. Unknown flags appear as generic tiles. "Realistic view" hides OFF features. |
| Flag table | Every flag evaluated **two ways**: by the target's **Frontend API** (`GET /api/frontend`, server-side evaluation), and by the official **Node SDK** (`unleash-client`) evaluating the target's **Client API** payload locally. Rows where the two disagree turn red. Click a row to see the compiled strategies the backend served for that flag. |
| HTTP inspector | Every request to the target: Frontend API calls and the SDK's own traffic (feature polling with ETag/304, register, metrics). Shows status, timing, headers (tokens partly redacted) and the pretty-printed body. |

Evaluation re-runs on every input change and every 5 s (the SDK polling interval), so a change
made in a backend's admin UI shows up without reloading.

## Stress test

The **Stress test** tab floods the selected target and environment with requests until the
duration is up. Each of N workers sends its next request as soon as the previous one completes,
so N is roughly the number of requests in flight.

| Setting | Options |
|---------|---------|
| Endpoint | Frontend API with a random context, the Client API (full payload, or conditional with `If-None-Match` the way polling SDKs do it, which mostly returns 304), or a mix (80/20) |
| Brand | Random among the active brands, the brand selected in the toolbar, or no brand |
| Customer | Random number 1…N, or a random UUID |
| Check vs SDK | This share of Frontend API answers is re-evaluated by the official SDK on the same context. Any difference counts as a **wrong answer**: speed means nothing if the answers are wrong. |

Results update live:
- throughput, p50/p95/p99/max latency (measured until the full body is read), errors
- per-second throughput and p95 charts, a latency histogram
- status codes and per-endpoint tables
- samples of errors and wrong answers

**Watch a flag while the run goes on.** Pick a flag under "Watch flag (live)". The chart plots
the share of Frontend API answers with that flag ON, per second, with one line per brand. Change
the flag in a backend's admin UI (switch, default rollout, brand override, allowlist) and the
matching line moves within a second or two. That shows how quickly a change propagates and what
the result is per brand. You can switch the watched flag during a run; the chart continues from
that second. A percentage rollout settles at its percentage, because customers are random.

**Coloured boxes.** Each box turns gradually from green to yellow, orange and red as performance
moves past the limits below. Each box also carries a word (OK / Watch / Slow / Too slow), so
colour is never the only signal, and its tooltip shows the limits. The limits come from the
first benchmark on 2026-10-17 (32 workers, Frontend API): 16–22k req/s, p50 1.3–1.8 ms,
p95 2.4–4.2 ms, p99 5.3–6.1 ms. They live in `web/thresholds.ts`.

| Box | OK | Critical |
|-----|----|----------|
| Throughput (per 32 workers, scaled for fewer) | ≥ 12,000 req/s | ≤ 3,000 req/s |
| p50 / p95 / p99 | ≤ 2.5 / 6 / 10 ms | ≥ 10 / 25 / 50 ms |
| Errors | 0 | ≥ 1% of requests (any error is at least "Watch") |
| Wrong answers | 0 | ≥ 0.1% of checked answers (any wrong answer is at least orange) |

Boxes stay neutral until 200 requests have completed.

Finished runs are kept in a table, so backends can be compared side by side. The explorer pauses
while you're on this tab, so it doesn't add load.

Headless (CI or terminal), with the same engine:

```
npm run stress -- --target=unleash-vg --env=production --mode=frontend \
                  --concurrency=32 --duration=30 --brand=random --customers=1-1000000 --check=0.02
```

Use `--json` for machine-readable output. The exit code is 1 if any request failed or any
sampled answer was wrong.

The bench and the target compete for CPU on the same machine, so absolute numbers are
indicative only. Comparisons between backends run with the same settings are fair.

## How it works

```
browser ──► bench server (node, :4300)
              ├─ /bench/evaluate ──► target GET /api/frontend            (Frontend API path)
              │                  └─► SDK instance (target × env) .isEnabled  (SDK path)
              ├─ /proxy/<target>/<env>/… ──► target /api/client/…        (the SDK's real traffic)
              ├─ /bench/brands ──► sqlite file / SurrealDB /sql / static list
              └─ /bench/stream (SSE) ── every recorded HTTP exchange
```

- The SDK path uses one long-lived `unleash-client` instance per target × environment, behaving
  like a real backend service. "Reset SDK" recreates it, for example after the backend restarts
  or a token changes.
- Context mapping follows the target's `contextFields`. `userId`, `sessionId` and `remoteAddress`
  go at the top level; everything else (e.g. `brand`) goes into `properties`, sent as
  `properties[brand]=…` on the Frontend API.
- A "match" only means the two paths agree. It does not check the answer against the spec. To
  verify against the spec, use the worked examples in `docs/spec/03` (the unit tests do this with a
  fake target).

## Configuration (`testbench.config.json`)

| Field | Meaning |
|-------|---------|
| `port` | Bench port (default 4300; the `PORT` env var overrides it) |
| `targets[].name` | Label in the UI |
| `targets[].baseUrl` | Where the target serves `/api/client` and `/api/frontend` |
| `targets[].tokens.<env>.backend / .frontend` | Token secrets. Backends store tokens hashed, so they must be configured here. |
| `targets[].brands` | `{type:"sqlite", path}` (a `brands` table in a SQLite file), `{type:"surreal", url, ns, db, user, pass}` (unleash-vg's `brand` table), or `{type:"static", brands:[{key, displayName}]}` |
| `targets[].contextFields` | `{brand, customer}` context field names (default `brand` / `userId`, as in spec 02) |

### Tokens

unleash-vg provides six **default tokens** when run for local development (spec 04,
`docs/spec/reference-data/default-tokens.json`). The example config already contains them, so a
locally running backend works with no token setup. For Unleash itself, put your own tokens in the
`unleash` target.

If a backend is missing them, an admin can add each one by hand in its admin UI (API tokens → add a
token with an existing secret). `scripts/import-tokens.ts` does the same through a backend's admin
API; it was written for another implementation of the spec, so adapt it before use.

## Development

```
npm test           # unit tests and an end-to-end run against a fake Unleash target
npm run typecheck
```

The fake target (`tests/fake-target.ts`) serves spec 03 worked example 2 and has a deliberately
wrong Frontend API answer for `dark-mode`, which proves that mismatches are detected.
