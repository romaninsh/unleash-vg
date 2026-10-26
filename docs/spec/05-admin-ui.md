# 05 — Admin UI

The admin application staff use to manage flags. **Its technology is the implementer's choice**:
a web app, a desktop app, or an app built on a low-code or declarative framework all qualify, as
long as the behaviour below is met. Screen layouts and sketches are illustrative; the stated
behaviour is the requirement. The SDK API ([04](04-sdk-api.md)) is the only external contract.
How the admin application talks to its storage or server is an implementation detail.

Permission rules referenced as **[P]** are in [07](07-access-control-and-audit.md).

## Web and desktop access

- Users with the **admin** role may use either a web app or a desktop app.
- **All other team members (editors and viewers) use only a web browser.** Everything their role
  allows ([07](07-access-control-and-audit.md)) is available there.
- The general requirements G1–G7 below apply to whichever form is used.

## General requirements (all admin pages)

These apply to every list in the admin application: flags, archive, audit log, connected apps,
brands, API tokens and users.

**Scalability comes first.** The admin application must stay fast as data grows, to thousands of
flags and a long audit history. Pages load only the records and fields they show, never a whole
table at once, including tokens, users and events.

| # | Requirement |
|---|-------------|
| G1 | **Load only what is needed.** A page fetches only the records and fields it shows. For example, the flags list does not load every flag's full rules or history, and a flag's details load when it is opened. |
| G2 | **Sortable.** Every list can be sorted by each column where ordering makes sense (name, dates, last seen, status). Sorting applies to the **whole** list, not only the part already on screen. |
| G3 | **Quick search, as you type.** Each list has a search box that filters the whole list as the user types, without pressing Enter. Search and sort combine. |
| G4 | **Live values.** Values on screen update by themselves, without a reload, when they change elsewhere: "last seen", switch states and rule summaries changed by another user, connected apps. Driven by SurrealDB LIVE queries, not by reloading ([11](11-storage-and-data.md)). |
| G5 | **Scrolling, no pagination.** Lists are one continuous, scrollable list with no page buttons, and stay responsive as they grow. |
| G6 | **Live audit log.** New audit events appear at the top of the open audit log (and the flag's History tab) as changes happen, without a reload, and respecting the active filters. If the user has scrolled down, the view does not jump; a "n new events" indicator appears instead. |
| G7 | **Safe saving.** Every save is idempotent and safe to retry, and writes only the fields the user changed. Two people editing different fields of the same record (e.g. on the Settings page) both keep their changes ([11](11-storage-and-data.md)). |

## Navigation

```
Flags            (default landing page)
Archive
Audit log
Connected apps
── Admin ──      (admins only)
Brands
API tokens
Users
Settings
```

## 1. Sign-in

- Users sign in before they see anything. The rules for accounts, passwords, lockout and sessions
  are in [07](07-access-control-and-audit.md).
- A failed sign-in shows "Invalid credentials" and doesn't reveal which part was wrong.
- Users can change their own password.

## 2. Flags list

Reference: Unleash's flags overview and project flag list.

| Column | Content |
|--------|---------|
| Name | Opens the flag detail. Description shown as a second line. |
| Tags | Tag labels |
| development / uat / production | One cell per environment: switch state + rule summary (see below). |
| Last seen | Most recent SDK evaluation in any environment, as relative time ("3 min ago"); per-environment values on demand. Updates live (G4). |
| Created | Date |

**Environment cell summary**
- Switch OFF: **Disabled**.
- Switch ON: the default rule label (**ON** / **OFF** / **25%** / **Only k customers**), plus
  **+n brands** when overrides exist. Each override can be seen without opening the flag.

**Controls**
- **Quick search** by name or description: substring, case-insensitive, as you type (G3).
- **Filter by tag.** Several tags can be selected; a flag matches if it has any of them.
- **Quick filters**
  - All active
  - Stale
  - Has brand overrides
  - Not seen in N days (N = `settings.unused_flag_days`)
- Sort by any column (G2). Default: name.
- **New flag [P: create flag]**: name, description and tags.
  - The name is validated as it is typed: format, and uniqueness including archived flags.
  - Creates all three environments with the switch OFF and the default rule ON (100%).
- **Export** of the currently filtered list as CSV.

## 3. Flag detail

Reference: Unleash's flag page, environments section, and Unleash's flag page with no strategies.

**Flag information**
- Flag name, easy to copy.
- Stale marker.
- Actions: **Mark stale / Unmark stale** and **Archive** **[P: edit flag metadata]**.
- Description and tags, editable. Adding a tag suggests existing tags.
- Created by and created at.
- Last seen per environment (live, G4).

**Per environment** (development, uat, production), for example:

```
┌ production ─────────────────────────────── [● ON ] ── last seen 2 min ago ┐
│ Default (all other brands)   [ OFF | ON | % ]  [100]%   Customers: (none)  │
│ ─────────────────────────────────────────────────────────────────────────  │
│ Brand overrides                                                            │
│   Bank B        [ OFF | ON | % ]   —                         [remove]      │
│   Bank C        [ OFF | ON | % ]  [ 10]%   Customers: 1001, 1002 (edit)    │
│   [+ Add brand override]                                                   │
│                                                    [Discard] [Save changes]│
└────────────────────────────────────────────────────────────────────────────┘
```

Behaviour:
- **The switch** takes effect immediately, after a confirmation in `production` only
  **[P: edit environment E]**.
- **Rule edits for one environment are saved together.** The default rule and all overrides of
  that environment are committed as one change: all of it applies, or none of it. The audit log
  records one event per changed rule ([07](07-access-control-and-audit.md)).
- **Rule input:** OFF, ON or a percentage (1–99). A customer allowlist can be entered for OFF and
  for a percentage; it's not offered for ON (see [02](02-domain-model.md)).
- **Customer allowlist**
  - Accepts a pasted list of IDs separated by commas, whitespace or newlines.
  - Removes duplicates and shows the count. Rejects IDs longer than 100 characters.
  - At most 1,000 per rule.
- **Add brand override** offers active brands that don't have an override yet. The new override
  starts as a copy of the default rule.
- **Remove override** → the brand falls back to the default rule.
- **Copy rules from another environment** (development or uat). Replaces the default rule and the
  overrides being edited; the user still saves. The switch is not copied.
- Without edit permission for an environment, its rules are read-only, and the UI says why.
- **Concurrent edits.** Saving writes only the parts the user changed. If someone else changed
  other parts of the same environment meanwhile (another brand's override, the switch), both
  changes stay. Only when both changed the **same** part does the save stop, show who changed it
  and when, and let the user decide ([11](11-storage-and-data.md)). Values on screen update live
  in the meantime (G4).

**Preview** (read-only helper per environment)
- Inputs: brand (or "no brand") and customer ID.
- Shows ON or OFF for the **saved** configuration, and which rule decided it.
- Must give the same answer as the Frontend API for that context ([03](03-evaluation-and-compilation.md)).

**History**
- The audit log for this flag (see screen 5). Live (G6).

## 4. Archive

- Lists archived flags: name, archived at, archived by.
- **Revive [P: edit flag metadata].** Restores the flag with its previous rules, with the switch
  OFF in every environment, so a revived flag can't silently go live.
- **Delete permanently [P: admin].**
  - Requires typing the flag name to confirm.
  - Frees the name.
  - Audit events about the flag are kept.

## 5. Audit log

Reference: Unleash's event log (list and full event).

- Newest first, continuously scrollable (G5), live (G6).
- Each row shows time, user, event type, flag, environment, brand and a one-line summary.
  Example: "production · Bank C: OFF → 10% + 2 customers".
- Opening a row shows the before and after values.
- Filters:
  - Date range
  - User
  - Flag
  - Environment
  - Brand
  - Event type
- Quick search over the summary (G3).
- **Export** of the current filter as CSV or JSON **[P: viewer+]**.

## 6. Connected apps

Data comes from SDK register and metrics calls ([08](08-metrics-and-housekeeping.md)).

- Columns: app name, environment, SDK version, number of instances, last seen. Live (G4).
- Answers "which services still use an old SDK" and "is production actually calling us".
- Also shows "unknown flag names": names that apps evaluate but that don't exist. This catches
  typos.

## 7. Brands [admin]

- Columns: key, display name, active, number of flags with overrides.
- Add a brand: key and display name. The key cannot change after creation.
- Rename the display name.
- Activate or deactivate.
- A brand can only be deleted when it has no overrides.

## 8. API tokens [admin]

Reference: Unleash's environments and API tokens (token counts per environment).

- Columns: name, type, environment, created, last used. Secrets are never shown in the list.
- **Create** (name, type, environment). The secret is shown **once**, easy to copy.
- **Add a token with an existing secret** (name, type, environment, secret): typed or pasted in
  by an admin, one at a time, so apps already using that secret keep working ([04](04-sdk-api.md)).
  No bulk import is needed.
- **Revoke**, with confirmation.

## 9. Users [admin]

- Columns: name, email, role, editable environments, last sign-in, active.
- Create a user: name, email, role, environments, and a password the admin types. The user must
  change it at first sign-in.
- Edit role and environments. Deactivate. Set a new password: the admin types it, and the user must
  change it at their next sign-in.
- No emails are sent: no invitations, address verification or reset links. The admin tells the
  user their password.

## 10. Settings [admin]

- Brand context field name and customer context field name.
  - Show a warning: "changes what every SDK receives".
  - Ask for confirmation.
- Frontend CORS origins (list).
- Unused-flag threshold (days). Metrics retention (days).
