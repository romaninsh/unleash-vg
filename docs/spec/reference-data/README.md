# Reference data: brands and flags

The brand and flag list used by this repository's seed data and tests, including the test bench
([`../../../testbench`](../../../testbench)).

**An implementation should be able to load this dataset as its demo / test data.** How it is
loaded (seed script, import, fixture) is up to the implementation.

| File | Content |
|------|---------|
| `brands-and-flags.json` | The brands and flags, below |
| `default-tokens.json` | Six fixed SDK tokens (backend + frontend per environment) an implementation provides **for local development only** ([04](../04-sdk-api.md)). The test bench is configured with them. |

**Naming generated test data.** When you generate many flags or other records, for example to try
the admin at scale, zero-pad the numbers (`test-00002`, not `test-2`) so plain alphabetical sorting
keeps them in order. The spec does not require natural sorting.

`brands-and-flags.json` holds the full data:
- per brand: key, display name, active
- per flag: name, **group**, description, tags, stale, archived
- per flag and environment: switch, default rule (rollout + allowlist), brand overrides

The rules use the model in [02](../02-domain-model.md).

## Brands

| Key | Display name | Active |
|-----|--------------|--------|
| bank-a | Northwind Air | yes |
| bank-b | Harbour Bank | yes |
| bank-c | Greenfield Stores | yes |
| bank-d | Contoso Air (prospect) | yes |
| bank-e | Parcelpoint (prospect) | yes |
| bank-f | Roadside Club (prospect) | no |

## Flags by group

The group is the section of the customer-facing app that a flag affects. The test bench lays out
its mock app and flag table by group; its copy of the list is [`testbench/web/flag-groups.ts`](../../../testbench/web/flag-groups.ts).
Implementations may store the group as a tag, `group:<name>`.

| Group | Flags |
|-------|-------|
| App (whole app: theme, banners, chat) | chat-support, dark-mode |
| Sign in | biometric-login, sso-login |
| Onboarding | new-onboarding-flow |
| Accounts | open-banking-aggregation |
| Cards | card-freeze, debit-card-payments, virtual-cards |
| Payments | direct-debit-manager, instant-transfers, legacy-transfer-screen *(stale)*, payee-confirmation |
| Savings | round-up-savings, savings-pots |
| Insights | beta-budget-planner *(archived)*, spending-insights |
| Products | crypto-wallet, loan-calculator |
| Documents | statement-pdf-v2 *(stale)* |
| Notifications | overdraft-alerts, push-notifications-v2 |
| Other | test |

`debit-card-payments` in production is worked example 2 of [03](../03-evaluation-and-compilation.md):
ON for all brands, OFF for bank-b, 10 % plus customers 1001 and 1002 for bank-c.
