# unleash-vg

A feature-flag service your Unleash SDKs can talk to without code changes. It keeps Unleash's SDK
API (`/api/client` and `/api/frontend`, with the same tokens, ETags and CORS), and replaces the admin
side with a simpler model built for white-label products: flags × environments × brands, each flag
on, off or a percentage, with customer allowlists and per-brand overrides.

It was built by Claude Opus 5.5 with [Vantage](https://vantage-ui.com) and is shared under the MIT
licence, for anyone who needs a free alternative to Unleash or a similar service.

[![Demo admin](https://img.shields.io/badge/DEMO-ADMIN-0b7a5c?style=for-the-badge)](https://unleash-vg-admin-129027965449.europe-west2.run.app/)
[![Demo SDK API](https://img.shields.io/badge/DEMO-SDK_API-1f5fa8?style=for-the-badge)](https://unleash-vg-sdk-129027965449.europe-west2.run.app/health)
[![Demo bench](https://img.shields.io/badge/DEMO-BENCH-8a4fbf?style=for-the-badge)](https://unleash-vg-bench-129027965449.europe-west2.run.app/)

The demo runs on sample data: sign in to the admin as any listed user (password `demo`), change a
flag, and watch the bench's mock bank follow it. Everyone shares the same demo, so expect other
people's changes. Each service sleeps when idle, so the first request after a quiet spell takes a
few seconds.

## The admin app

Every flag with its state in each environment, brand overrides and when apps last asked for it:

![Flags](docs/screenshots/flags.png)

One flag: the rule per environment, brand overrides, the share of evaluations served ON, and its
history:

![A flag](docs/screenshots/flag.png)

API tokens per environment, created here or imported from an existing Unleash:

![API tokens](docs/screenshots/api-tokens.png)

## How it fits together

```mermaid
---
config:
  look: handDrawn
  theme: neutral
---
flowchart LR
  ui["Vantage UI<br/>desktop app"]
  admin["unleash-admin<br/>Vantage project on vantage-server"]
  sdk["unleash-sdk<br/>Rust, built on Vantage crates"]
  bench["unleash-bench<br/>plain Node app"]

  ui -- "builds and pushes" --> admin
  admin -- "flags" --> sdk
  bench -- "Unleash SDK" --> sdk
```

- **unleash-admin** is a Vantage project. In Vantage UI its tables, pages and rules are YAML that
  the agent edits with you. `deploy-admin` packs the project and the built `web/flags` onto
  `vantage-server`, the server Vantage runs locally, and pushes that image.
- **unleash-sdk** is a Rust service that reads SurrealDB through Vantage's crates and answers
  Unleash SDKs on `/api/client` and `/api/frontend`.
- **unleash-bench** is a plain Node app using the official Unleash Node SDK: a mock bank whose
  screens follow the flags, and a stress test. It talks only to the SDK API, like your apps would.

## How big it is

Non-blank lines in each repository's tracked files on 2026-10-27, generated code left out
(Unleash's `frontend/src/openapi`, our `vantage.gen.ts`):

| | [Unleash](https://github.com/Unleash/unleash) | unleash-vg |
|---|---:|---:|
| Admin web app | 192,872 | 2,324 |
| Admin backend: API, data model, rules | 103,676 | 2,481 |
| SDK API | (in the backend) | 1,247 |
| **Total** | **296,548** | **6,052** |
| Tests | 122,798 | 1,691 |

That's 49 times less code to read, review and keep running. Most of the difference is Vantage:
tables, pages, access rules and the audit log are YAML it runs, so there's no API layer, ORM or
form code to write. Unleash also does more (projects, segments, change requests, SSO), and
unleash-vg covers the flags × environments × brands model described in `docs/spec/`. The bench
(3,124 lines) has no counterpart in Unleash and isn't counted.

## What's in the repository

| Folder | What it is |
|---|---|
| root (`table/`, `page/`, `api/`, …) | The admin app, a Vantage project. `api/flags.yaml` is the API the web app uses. |
| `web/flags/` | The admin web app (React and Vite). |
| `service/` | The SDK API, in Rust: what Unleash SDKs connect to. |
| `testbench/` | A mock bank app that runs on the flags, and a stress test. Point it at unleash-vg and at Unleash, side by side. |
| `tests/` | The SurrealDB schema, rules and demo data, plus test scripts. |
| `docs/spec/` | The specification the service is built to. |

Data lives in SurrealDB.

## Make it your own

unleash-vg is meant to be forked and changed. Rename the brands, add a field to flags, or swap the
rollout rules for your own:

1. Clone this repository.
2. Download [Vantage](https://vantage-ui.com) 1.9 or later. It's free.
3. Open the folder in Vantage and start it locally (below). The admin runs against your own
   SurrealDB and SDK API, with the demo data.
4. Ask Vantage's built-in agent for the change. It edits the tables, pages and rules (all YAML)
   while the app reloads in front of you, and the web app's pages are plain React in `web/flags/`.
5. Deploy the admin and the SDK API: the Vantage deploy skill packages the admin for any container
   host, and our own pipeline below does it for Google Cloud Run on every merge.

## Running it locally

You need Docker, Node 22 or later, and [Vantage](https://vantage-ui.com) 1.9 or later.

1. Create `.env` from `.env.example`, with a token of your own:

   ```
   sed "s/^SECRET_INTERNAL_TOKEN=.*/SECRET_INTERNAL_TOKEN=$(openssl rand -hex 32)/" .env.example > .env
   ```

2. Open this folder in Vantage. It starts SurrealDB and the SDK API from `composer.yaml`.
3. Load the schema and the demo data, in this order:

   ```
   for f in schema seed events; do tests/surql.sh tests/$f.surql; done
   tests/sync_web_users.sh
   ```

4. In Vantage, open Services and start the `flags` web app. It opens in your browser.
5. Sign in as any demo user with the password `demo`, for example `admin@example.com`.

The SDK API listens on `http://127.0.0.1:4380`. In local development it accepts six fixed tokens,
listed in `docs/spec/reference-data/default-tokens.json`.

To try it from the SDK side, start the bench:

```
cd testbench
npm install
cp testbench.config.example.json testbench.config.json   # set the SurrealDB port, add your Unleash
npm start                                                 # http://localhost:4300
```

Change a flag in the admin app and watch the mock bank follow it within a few seconds.

## Deploying your own

Three images, each its own Dockerfile: the admin (`Dockerfile`), the SDK API
(`service/Dockerfile`) and the bench (`testbench/Dockerfile`). The SDK API finds its SurrealDB
through `SURREAL_URL`, `SURREAL_USER`, `SURREAL_PASS` and `SURREAL_AUTH`. The admin reads the
`prod` profile (`application.yaml`) from the environment, and its sign-in tokens file is mounted at
`/app/project/private/web-tokens.yaml`. Neither image holds a secret.

Our own pipeline is a worked example for Google Cloud Run:

- `.github/workflows/checks.yaml` runs on every pull request. It starts the whole stack (SurrealDB,
  the SDK API and the admin under the `ci` profile) and runs the database rules and the web probes
  against it. Its `summary` job must pass before anything merges to `main`.
- `deploy-admin.yaml`, `deploy-sdk.yaml` and `deploy-bench.yaml` deploy on a merge to `main` that
  changes their files. Each service scales to zero and runs one instance at most.
- `terraform/` is the cloud side: a deployer that only a protected `main` can use, which can push
  images and deploy new revisions of these three services and nothing else; a runtime account that
  can read only unleash-vg's secrets; the secrets themselves; and the three public services.

Opening the folder in Vantage is also how you change the app: tables, pages and rules are YAML
files, and Vantage's agent can edit them with you.

## Licence

MIT. See [LICENSE](LICENSE).
