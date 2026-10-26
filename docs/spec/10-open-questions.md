# 10 — Open questions & assumptions

Each item has an owner action. Items marked **blocking** must be closed before the named part goes
live. Numbers are kept stable; Q3 and Q8 were about Unleash migration tooling, which is now out of
scope ([01](01-scope.md)).

| # | Question / assumption | Current assumption | Blocking for | How to close |
|---|------------------------|--------------------|--------------|--------------|
| Q1 | The context field name apps use for the brand | `brand` in `properties` (configurable) | Go-live | Search the mobile, web and backend code for the context passed to `isEnabled` / `useFlag` / `UnleashContext` |
| Q2 | The context field for the customer ID | `userId` (configurable) | Go-live | Same as Q1 |
| Q4 | Do apps check partial-rollout flags **without** a customer ID (e.g. before login)? If so, they get OFF in the new service. Unleash may have returned random results. | Rare. Acceptable. | Go-live | Code search |
| Q5 | Does the deployment run Unleash **Edge** or **Proxy** between apps and Unleash? | Unknown. `/edge/validate` and bulk metrics are specified as conditional. | Bulk metrics + `/edge/validate` | Deployer |
| Q6 | Which SDKs and versions are in use (and is any older than client-spec 4.2, e.g. very old Go)? | Modern SDKs. The compiled output avoids segments and strategy ids, so old ones are safe too. | — | Current Unleash "Applications" page |
| Q7 | Environment names the apps' tokens use (`uat` vs `staging` vs `test`) | `development`, `uat`, `production` | Go-live | Current token list |
| Q9 | Audit log retention and export requirements from tenants' contracts | Keep forever. Export on demand. | — | Deployer |
| Q10 | Where does the service run (which cloud, per region)? Do tenants' contracts require data residency for the flag service? | One shared deployment | Deployment | Deployer |
| Q11 | Customer allowlist size: is 1,000 per rule enough? | Yes | — | Deployer |
