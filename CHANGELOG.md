# Changelog

Each release's notes on GitHub come from its section here.

## 0.2.0 — 2026-10-24

### New

- **Menu bar app.** Shortcut for Orca now lives in the menu bar (⇄) instead of the dock, with its own icon. The menu shows whether Orca is connected, opens the window and quits. A `!` next to the icon means the proxy isn't running.
- **Images in Orca.** Avatars and images in story descriptions and comments now load. Shortcut images need your token, so the app fetches them while handling Orca's request and serves them locally; the token never appears in an image link.
- **Jira favourites.** Orca's *Jira favourites* on the Tasks page now list *My open stories*, *Requested by me*, *Current sprint* (while an iteration is running) and open stories for each team you're in.
- **Saved filters.** Add your own named JQL filters in **Settings → Saved filters**; they appear in Orca's Jira favourites too.

### Fixed

- An assign request without a valid assignee is rejected instead of unassigning the story.
- Stories are never created without a team; an unknown project is an error.
- Whole-day date queries (`created = 2026-10-25`) are correct on days the clocks change.

## 0.1.0 — 2026-10-24

First release: a Mac app that runs the Shortcut → Jira proxy for Orca, with a setup guide, request log, JQL guide and settings (port, open at login).
