# Brief

## Who uses it
Staff at a white-label banking software company (developers, release managers, admins) who
switch feature flags on and off for the bank brands they serve.

## What it's for
The admin side of a flag service that replaces Unleash, as specified in `../spec`: a flat
flag list, per-environment switches, a default rule plus brand overrides (rollout % and
customer lists), brands, API tokens, settings and an audit log.
The Unleash-compatible service the apps call is not built in Vantage (Vantage cannot serve
Unleash's web API); the database is designed so that service can be added later.

## The data
Starting fresh with SQLite in the project (`data/flags.db`), with synthetic sample data:
3 environments, 6 bank brands (3 live, 3 prospects) and about 20 flags.
2026-10-17: moved to SurrealDB, run locally in Docker by Vantage (composer.yaml); all data copied
over. Rules live in tests/schema.surql and tests/events.surql; the old SQLite file stays in data/
as a backup.

## Organisation and design guide
No organisation named; none inferred (personal email domain).

## Look and feel
Professional and compact: a back-office console with many rows on screen.

## Defaults taken
- Scope: admin app in Vantage first, SDK service later (answered: option 1, 2026-10-17)
- The data: start fresh with SQLite in the project (no answer)
- Look and feel: Professional and compact (no answer)
- Theme: default theme (no answer)
