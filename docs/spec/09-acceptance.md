# 09 — Acceptance criteria

An implementation is accepted when all of the criteria below hold. They describe what must be
true, not how to check it; testing approach, tools and coverage are up to each implementation.

| # | Criterion |
|---|-----------|
| A1 | **Unleash conformance.** Evaluation behaves as Unleash's client specification defines (`@unleash/client-specification`, used upstream at `package.json:169`), for every case our model can express. Cases that need segments, variants, dependencies or other operators are out of scope. |
| A2 | **Compilation.** The four worked examples in [03](03-evaluation-and-compilation.md) produce exactly the Client API JSON shown there. |
| A3 | **No brand, no customer.** A context without a brand gets the default rule. A context without a customer ID gets OFF for partial rollouts and ON at 100 %. |
| A4 | **ETag.** An unchanged configuration returns `304`. Any change to a rule, a switch, an archive state or the context-field settings changes the ETag. A change in another environment does not. |
| A5 | **Tokens.** A token of the wrong type gives `403`, an unknown token `401`. A token never sees another environment's configuration. A token registered with a given secret works with that secret verbatim. |
| A6 | **Permissions.** Every row of the permission table in [07](07-access-control-and-audit.md) is enforced by the system itself, by any route a user can reach (UI, API, scripts). For example, an editor without `production` cannot change production. Hiding controls in the UI is not enough. |
| A7 | **Audit.** Every change writes the specified event(s) atomically with the change. A change that fails writes no event. |
| A8 | **SDK API scalability.** The Client and Frontend APIs stay responsive as the number of flags, brands and connected SDKs grows. Work per request doesn't grow with unrelated data, e.g. other environments. |
| A9 | **Admin scalability.** The admin pages meet G1–G7 of [05](05-admin-ui.md): load only what's shown, sort, quick search, live values, scrolling without pagination, a live audit log, and safe saving. They stay that way as data grows into thousands of flags. |
| A10 | **Reference data.** The implementation can load [`reference-data/brands-and-flags.json`](reference-data/README.md). With it loaded, the Frontend API and an official SDK using the Client API give the same answer for every flag, brand and customer. |
| A11 | **Default tokens.** Run for local development, the implementation provides the six tokens in [`reference-data/default-tokens.json`](reference-data/default-tokens.json); a production deployment has none of them ([04](04-sdk-api.md)). |
| A12 | **Browser access.** Viewers and editors can do everything their role allows in a web browser. Admins may use a web or a desktop app ([05](05-admin-ui.md)). |
| A13 | **Storage and instant changes.** Data is in SurrealDB. The SDK API answers from its cache without a database query per request, and a committed change (e.g. a flag switched off, a token revoked) is reflected in the next SDK response, via LIVE queries ([11](11-storage-and-data.md)). |
| A14 | **Idempotency.** Repeating any change, including after a lost response, ends in the same state as doing it once, reports success, and creates no duplicate records or audit events. No record relies on a database-generated id ([11](11-storage-and-data.md)). |
| A15 | **Concurrent edits.** Two users who change different fields of the same record both keep their changes. A change to a field someone else changed meanwhile is never silently overwritten ([11](11-storage-and-data.md)). |

## Availability

- SDKs cache the last configuration they downloaded and keep evaluating while the service is down.
  An outage freezes flags; it does not flip them.
- The service should be able to run as more than one instance. Each instance follows changes
  through its own LIVE queries, so all of them serve a change as soon as it is committed.
