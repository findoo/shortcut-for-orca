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

See [docs/jql.md](docs/jql.md) for supported fields, operators, quirks and search limits (it is also shown in the app's *JQL guide* tab).

## Not supported

Attachments/inline images, saved filters, editing descriptions, and editing custom fields other than Priority.
