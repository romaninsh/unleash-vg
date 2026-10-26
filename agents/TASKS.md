# Open tasks

Work we've deliberately left for later. Each section says what's open, what we know, and where to
look. Nothing here is decided yet.

## CI/CD

Pull requests should get checks; a push to `main` should build the images and deploy them to
Cloud Run. The chtags repository (`romaninsh/chtags`) is the reference for deploying to Cloud Run:
one workflow per service, Workload Identity Federation through the existing `golf` pool, a smoke
check after each deploy. The vantage repository's CI is the reference for caching and checks
(rust-cache or WarpBuild with weekly keys, buildx caches per image, actions pinned by SHA, one
required summary job).

## Images

`service/Dockerfile` exists. The admin needs one: build `web/flags` in `romaninsh/vantage-web-dev`
and serve it from `romaninsh/vantage-server` (pinned to a published version, 1.8.0 today), as the
Vantage deploy skill describes. The hosted demo builds the web with `VITE_DEMO_SIGN_IN=1`. The
bench needs an image too.

## Pipeline identity

Which service account the pipeline deploys as, where it and its pool binding are declared
(chtags keeps a `terraform/` folder in its own repository), and how narrow its roles are. chtags
has `run.admin`; deploying new revisions needs less.

## Configuration for the cloud

`datasource/flags.yaml` has `cbor://root:root@surrealdb:8000` written in. The deployed admin needs
the SurrealDB Cloud address from the environment: profiles (`local` with `.env`, `prod` with
`.env.prod`) or a `${secret.*}` URL. The flag service already reads `SURREAL_URL`,
`SURREAL_USER` and `SURREAL_PASS`.

## Outbound address

SurrealDB Cloud only lets in addresses it knows. The services should leave through the existing
Cloud NAT on 34.142.11.29, which today carries names from an earlier test (`pizza-1-router`,
`pizza-1-egress`) and isn't in terraform.

## Real sign-in

Sign-in is simulated: the API takes `<email>:<password>` tokens from `private/web-tokens.yaml`,
which `tests/sync_web_users.sh` writes. Vantage 1.7 and later can sign people in properly
(`session:` in `application.yaml`, `auth: session` in `api/flags.yaml`, a password `sign_in`
action). The seeded users already have argon2 hashes of `demo`. On the desktop, a "view as" menu
over `app_user` (Vantage's `kind: identity` title-bar item with `session.assume`; Vantage may
already support this) would let a developer act as any user without a hardcoded list. The web
app's one-click list stays for the hosted demo only (`VITE_DEMO_SIGN_IN=1`). A working example is
`vantage-ui-examples/apps/identity-b-flags`; the Vantage skills explain it in
`vantage-application-settings/references/sessions-and-audit.md` and
`vantage-actions/references/sign-in.md`.

## Nightly reset

The hosted demo is open to anyone through the six seeded accounts (password `demo`). A nightly job
should put the seed data back, including any passwords people changed.

## The bench against any Unleash

The bench should test a visitor's current Unleash, their own unleash-vg, or ours, chosen in the
page. It shouldn't need the backend's database for the brand list. The hosted copy should test
only our deployment, so visitors' tokens never pass through our server. Add our deployed target to
`testbench.config.example.json` once it exists.

## Catching up with Vantage

The app was built on Vantage 1.5.2. Newer Vantage can replace hand-made parts:
`read_only: true` instead of query tables used as read-only views, Vantage's hashing functions
instead of SurrealQL ones, `log_changes:` for the audit log instead of database events, and
`invariants:` rules instead of the `*_scope` fields. The flag service could compile flags itself
and cache them per environment revision, instead of calling `fn::compile` in the database.

## Running on MongoDB

About 730 lines of SurrealQL run inside the database (9 events, 24 functions in
`tests/schema.surql` and `tests/events.surql`), so moving to MongoDB means moving that logic into
the app and the flag service first. Choosing a backend per profile also needs Vantage support: a
profile can change a datasource's URL today, not its type.

## Production hardening

Account lockout, password reset, more than one instance per service (two server processes can't
share one row cache yet), backups.

## Docs

Screenshots for the README, and longer guides for running and deploying it.

## SDK routes in vantage-server

If vantage-server could serve plain HTTP routes, the admin service could answer the Unleash SDKs
itself and the separate flag service could go.
