# JQL guide

Orca sends JQL to the proxy, which turns it into Shortcut searches. Full boolean syntax works: `AND` / `OR` / `NOT`
(also `&&`, `||`, `!`), parentheses, and `ORDER BY` with `ASC`/`DESC` on several fields. Field names and values are
case-insensitive.

## Basics

- **Project = Shortcut team**, keyed by the team's mention name in caps (`WEB`, `MOBILE`).
- **Issue keys are `SC-<story id>`**; epics show as parents with keys `EPIC-<id>`.
- **Issue types:** Feature (alias Story), Bug, Chore (alias Task).
- **Status category:** `To Do` = Shortcut backlog + unstarted states, `In Progress` = started, `Done` = done.
  `resolution = Unresolved` means "not done".
- **`!=` and `not in` skip empty fields**, like Jira: `assignee != currentUser()` excludes unassigned stories.
- **Custom fields by name**, with prefix matching on values: `priority = P1` matches `P1 - Critical`.
  `priority > P3` means *more important* than P3.
- **Dates:** relative values (`-7d`), `startOfWeek()` etc. use the Mac's local time; weeks start on **Monday**.
- **`ORDER BY`** defaults to `updated DESC`; empty values sort last.

## Fields

| Field(s) | Operators | Values |
| --- | --- | --- |
| `project` | `=` `!=` `in` `not in` | team mention name (`WEB`), team name or id |
| `key` `issuekey` `id` | `=` `!=` `in` `not in` `>` `>=` `<` `<=` | `SC-123` or `123` |
| `assignee` `reporter` | `=` `!=` `in` `not in` `is [not] EMPTY` (1) | `currentUser()`, `membersOf("team")`, mention name, email, full name |
| `status` | `=` `!=` `in` `not in` | workflow state name |
| `statusCategory` | `=` `!=` `in` `not in` | `"To Do"`, `"In Progress"`, `Done` |
| `resolution` | `=` `!=` `is [not] EMPTY` | `Unresolved` (= not done); anything else means done |
| `type` `issuetype` | `=` `!=` `in` `not in` | `Feature`/`Story`, `Bug`, `Chore`/`Task` |
| `labels` | `=` `!=` `in` `not in` `is [not] EMPTY` | label name |
| `sprint` | `=` `!=` `in` `not in` `is [not] EMPTY` | `openSprints()`, `closedSprints()`, `futureSprints()`, iteration name |
| `parent` `epic` `"Epic Link"` | `=` `!=` `in` `not in` `is [not] EMPTY` | `EPIC-123` or epic id |
| `"Story Points"` `estimate` `cf[10016]` | `=` `!=` `>` `>=` `<` `<=` `is [not] EMPTY` | number |
| `priority` and any Shortcut custom field, by name | `=` `!=` `in` `not in` `>` `<` ... `is EMPTY` | option name or unique prefix (`P1`); `>` means higher in option order |
| `flagged` `blocked` | `is [not] EMPTY` | Shortcut "blocked" flag |
| `created` `updated` `resolved` `due` | `=` `>` `>=` `<` `<=` (`is EMPTY` for last 2) | `2026-10-01`, `"2026-10-01 14:30"`, `-7d`, `-2w`, `now()`, `startOfDay()`, `endOfWeek(+1)`, `startOfMonth(-1)` ... |
| `text` `summary` `description` `comment` | `~` (and `!~` for `summary`) | words; `*` wildcards are ignored |

(1) Like Jira, `!=` and `not in` never match stories where the field is empty.

`ORDER BY` fields: `updated` (default, `DESC`), `created`, `resolved`, `due`, `key`, `summary`, `priority`, `status`,
`rank`, `"Story Points"`, `assignee`, `project`, `type`.

## Text search

`text ~` uses Shortcut's search; `*` wildcards are ignored; `NOT text ~ ...` isn't possible. `summary ~` checks the
title exactly and can be negated.

## How queries run (and their limits)

Each query becomes one or more Shortcut searches plus an exact in-memory filter. Conditions Shortcut can search
(team, assignee, reporter, status, status category, type, label, epic, estimate, dates, text and custom fields such as
Priority) narrow the search; everything else is checked in memory. `OR` and `in (...)` become separate searches whose
results are merged, up to 8 searches per query.

Shortcut search can't sort and can only search some fields, so the proxy reads up to 500 stories per query and sorts
them itself. If a query only uses fields Shortcut can't search (for example only `"Customer Tier" = Gold`, only a
sprint name, or a key range), it scans those 500 and **can miss matches**. Add a team, assignee or status condition to
fix that.

## Saved filters

Shortcut has no saved searches, so Orca's **Jira favourites** (on the Tasks page) come from this app: *My open
stories*, *Requested by me*, *Current sprint* (while an iteration is running), open stories for each team you're
in, then your own filters from **Settings → Saved filters**.

## Not supported

`WAS` / `CHANGED` history searches and `watcher`. Unknown fields, statuses, users or values return a clear 400 error
that says what's wrong, so you never get silently wrong results.

Orca itself has no way to edit descriptions, edit custom fields other than Priority, or upload attachments, so those
can't be done from Orca. Images in descriptions and comments do show.

## Copy these

```
assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC
```

```
project = WEB AND sprint in openSprints()
```

```
priority = P1 AND resolution = Unresolved
```

```
updated >= -7d ORDER BY updated DESC
```

```
project in (WEB, MOBILE) AND "Customer Tier" = Gold AND statusCategory != Done
```
