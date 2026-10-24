# Shortcut for Orca

A small macOS app that lets [Orca](https://github.com/stablyai/orca)'s Jira integration work with Shortcut. It runs a local server that speaks the subset of the Jira Server REST API Orca uses and calls Shortcut live. No sync and no database: reads and writes go straight to Shortcut.

## Download

Get the latest `.dmg` from [Releases](https://github.com/findoo/shortcut-for-orca/releases): `arm64` for Apple Silicon, `x64` for Intel Macs.

## Install

Drag **Shortcut for Orca** to Applications. You may need temporary admin access to copy it into Applications and open it the first time.

## First launch

The app is unsigned, so macOS blocks it the first time. Try to open it once first (macOS only offers the override after a blocked attempt), then open System Settings → Privacy & Security and click **Open Anyway**. Or run:

```sh
xattr -dr com.apple.quarantine "/Applications/Shortcut for Orca.app"
```

Then follow the **Setup** tab in the app.

## Developer notes

### Run

```sh
pnpm install
pnpm start            # headless proxy on http://localhost:8089 (PORT=… to change)
pnpm app              # build and launch the Electron app
pnpm test
pnpm dist             # unsigned .dmgs in release/ (arm64 + x64), no publish
```

Releases: push a tag like `v0.1.0`; the GitHub Actions workflow builds and publishes the `.dmg`s.

## Connect Orca

Settings → Integrations → Jira → **Self-hosted** → **Personal access token**:

- Jira site URL: `http://localhost:8089`
- Jira personal access token: your Shortcut API token (Shortcut → Settings → API Tokens)

The proxy stores nothing. It forwards Orca's token to Shortcut on each request and binds to `127.0.0.1` only.

## Mapping

| Jira (Orca)          | Shortcut                                            |
| -------------------- | --------------------------------------------------- |
| Issue `SC-123`       | Story 123                                           |
| Project              | Team (key = mention name, e.g. `WEB`)               |
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
