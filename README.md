# Shortcut for Orca

A small macOS app that lets [Orca](https://github.com/stablyai/orca)'s Jira integration work with Shortcut. It runs a local server that speaks the subset of the Jira Server REST API Orca uses and calls Shortcut live. No sync and no database: reads and writes go straight to Shortcut.

## Why?

Orca can show your issue tracker's tasks next to your worktrees, but it supports Jira, Linear and GitHub, not
Shortcut. Of those, only Jira can be pointed at your own server: Orca connects to self-hosted Jira by URL, while Linear
and GitHub are hard-wired to their own services. So this app pretends to be a small self-hosted Jira that answers from
Shortcut, and Orca's Jira integration (task list, details, comments, assigning, status changes, creating stories) works
with your Shortcut stories.

It runs on your Mac rather than as a shared service, so your Shortcut token goes from Orca straight to Shortcut: the
app never stores it, and nothing is synced or kept anywhere else.

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

The app lives in the menu bar (the ⇄ icon), not the dock. Closing the window keeps it running; use the menu bar icon to reopen the window or quit.

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

## Saved filters and images

Shortcut has no saved searches, so Orca's *Jira favourites* are presets plus your own filters from the app's Settings.
Shortcut images (avatars, images in descriptions and comments) need your token, so the proxy fetches them while handling
Orca's request and serves them from `localhost`; the token never appears in an image URL.

## Not supported

Orca has no UI to edit descriptions, edit custom fields other than Priority, or upload attachments.
