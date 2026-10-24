# Shortcut → Jira proxy for Orca

Orca has no Shortcut integration, but its Jira integration supports self-hosted Jira (Server / Data Center).
This is a local server that speaks the subset of the Jira Server REST API Orca uses and calls Shortcut live.
No sync and no database: reads and writes go straight to Shortcut.

## Run

```sh
pnpm install
pnpm start            # http://localhost:8089 (PORT=… to change)
```

## Connect Orca

Settings → Integrations → Jira → **Self-hosted** → **Personal access token**:

- Site URL: `http://localhost:8089`
- Email/username: leave blank
- Personal access token: your Shortcut API token (Shortcut → Settings → API Tokens)

The proxy stores nothing. It forwards Orca's token to Shortcut on each request and binds to `127.0.0.1` only.

## Mapping

| Jira (Orca)          | Shortcut                                            |
| -------------------- | --------------------------------------------------- |
| Issue `SC-123`       | Story 123                                           |
| Project              | Team (key = mention name, e.g. `WEB`)       |
| Status / transitions | Workflow states of the story's workflow             |
| Status category      | State type (`started` → In Progress, `done` → Done) |
| Issue type           | Story type (feature / bug / chore)                  |
| Priority             | `Priority` custom field                             |
| Sprint               | Iteration                                           |
| Story points         | Estimate                                            |
| Parent               | Epic                                                |
| Board columns        | The team's workflow states, in order                |

## JQL

Full boolean syntax: `AND` / `OR` / `NOT` (also `&&`, `||`, `!`), parentheses, and `ORDER BY` with
`ASC`/`DESC` on several fields. Field names and values are case-insensitive.

| Field(s)                                              | Operators                                    | Values                                                                 |
| ----------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| `project`                                             | `=` `!=` `in` `not in`                       | team mention name (`MOBILE`), team name or id                  |
| `key` `issuekey` `id`                                 | `=` `!=` `in` `not in` `>` `>=` `<` `<=`     | `SC-123` or `123`                                                      |
| `assignee` `reporter`                                 | `=` `!=` `in` `not in` `is [not] EMPTY`¹     | `currentUser()`, `membersOf("team")`, mention name, email, full name   |
| `status`                                              | `=` `!=` `in` `not in`                       | workflow state name                                                    |
| `statusCategory`                                      | `=` `!=` `in` `not in`                       | `"To Do"`, `"In Progress"`, `Done`                                     |
| `resolution`                                          | `=` `!=` `is [not] EMPTY`                    | `Unresolved` (= not done); anything else means done                    |
| `type` `issuetype`                                    | `=` `!=` `in` `not in`                       | `Feature`/`Story`, `Bug`, `Chore`/`Task`                               |
| `labels`                                              | `=` `!=` `in` `not in` `is [not] EMPTY`      | label name                                                             |
| `sprint`                                              | `=` `!=` `in` `not in` `is [not] EMPTY`      | `openSprints()`, `closedSprints()`, `futureSprints()`, iteration name  |
| `parent` `epic` `"Epic Link"`                         | `=` `!=` `in` `not in` `is [not] EMPTY`      | `EPIC-123` or epic id                                                  |
| `"Story Points"` `estimate` `cf[10016]`               | `=` `!=` `>` `>=` `<` `<=` `is [not] EMPTY`  | number                                                                 |
| `priority` and any Shortcut custom field, by name     | `=` `!=` `in` `not in` `>` `<` … `is EMPTY`  | option name or unique prefix (`P1`); `>` means higher in option order  |
| `flagged` `blocked`                                   | `is [not] EMPTY`                             | Shortcut "blocked" flag                                                |
| `created` `updated` `resolved` `due`                  | `=` `>` `>=` `<` `<=` (`is EMPTY` for last 2) | `2026-10-01`, `"2026-10-01 14:30"`, `-7d`, `-2w`, `now()`, `startOfDay()`, `endOfWeek(+1)`, `startOfMonth(-1)` … |
| `text` `summary` `description` `comment`              | `~` (and `!~` for `summary`)                 | words; `*` wildcards are ignored                                       |

¹ Like Jira, `!=` and `not in` never match stories where the field is empty.

`ORDER BY`: `updated` (default, `DESC`), `created`, `resolved`, `due`, `key`, `summary`, `priority`, `status`,
`rank`, `"Story Points"`, `assignee`, `project`, `type`. Empty values sort last.

Anything else (`WAS`/`CHANGED` history searches, `watcher`, unknown fields, statuses, users or values) returns
a 400 error that says what's wrong, so you never get silently wrong results.

### How queries run (and their limits)

Each query becomes one or more Shortcut searches plus an exact in-memory filter. Conditions Shortcut can search
(team, assignee, reporter, status, status category, type, label, epic, estimate, dates, text, Priority and
Technical Area) narrow the search; everything else is checked in memory. `OR` and `in (…)` become separate
searches whose results are merged, up to 8 searches per query.

Shortcut search can't sort, so the proxy reads up to 500 stories per query and sorts them itself. If a query
has nothing Shortcut can search (e.g. only `"Customer Tier" = Gold`, or only `sprint = "Sprint 41"`), it scans
the first 500 stories Shortcut returns and may miss matches; add a team, assignee or status condition to fix that.

## Not supported

Attachments/inline images, saved filters, editing descriptions, and editing custom fields other than Priority.
