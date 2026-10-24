# Shortcut for Orca: desktop app design

**Status:** draft for review · **Date:** 2026-10-24 · **Owner:** Fin (GitHub `findoo`)

## Intent

Orca has no Shortcut integration, but its Jira integration can talk to a self-hosted Jira server. This repo
already contains a working local proxy that speaks the Jira Server REST API Orca uses and calls Shortcut live
(`src/server.ts`, `src/jira.ts`, `src/jql.ts`, `src/shortcut.ts`), including a fairly complete JQL → Shortcut
translation.

Today it only runs on Fin's machine: a LaunchAgent starts `node src/server.ts`, Orca sends the Shortcut token
on every request, and the setup lives in Fin's head and a README. **Fin wants to share it with other
engineers.** They should be able to download a `.dmg` from a GitHub release, install it like any Mac app, and
get Orca showing their Shortcut stories without Fin's help. The app also needs to explain the quirks of the
JQL mapping, because that's where people will get confused.

## Who and how

- **Users:** teammates who use Orca and Shortcut, on Macs.
- **Distribution:** a **public** repo on Fin's GitHub (`findoo`; repo name *my call*: `shortcut-for-orca`), with
  Releases; each release has a `.dmg`. Public repos get free macOS Actions minutes.
- **Unsigned** (Fin's decision). No Apple Developer ID signing or notarisation.
- **Assumption (Fin's):** users can install unsigned apps, possibly with temporary admin access (assumed to be
  enough). The install instructions should mention it ("you may need temporary admin access to copy it into Applications and open it
  the first time"). If this turns out wrong, it's a new decision (IT allowlist or signing), not a builder fix.

## Goals

1. A Mac app ("Shortcut for Orca", *name is my call*) that runs the proxy and shows in the dock while running.
2. A first-run setup a teammate can follow alone:
   1. **Get a Shortcut token:** how to create one in Shortcut (Settings → API Tokens), stressing that it needs
      **write** access or Orca can only read.
   2. **Connect Orca:** step-by-step instructions matching Orca's Jira dialog (Settings → Integrations → Jira
      → **Self-hosted** → **Personal access token**; labels verified in Orca's bundle), with a copy button for the URL. The token goes into Orca.
   3. **Confirm:** once Orca makes its first request, the app shows who it's connected as, taken from the
      requests passing through (e.g. "Orca connected as Ada Lovelace · my-workspace · read-write token · last
      request 2s ago"). Read-only tokens get a clear warning here.
3. **Status at a glance:** running / error (e.g. port in use, Shortcut rejecting the token), plus a
   recent-request log (time, method, path, HTTP status, duration) for debugging.
4. **Settings:** port (default 8089) and launch at login.
5. **In-app JQL guide:** everything supported (the field/operator table currently in the README), the quirks
   below, and copyable examples.
6. **GitHub release pipeline** that produces the `.dmg` from a tag.

## Decided (by Fin)

- **The Shortcut token stays in Orca; the app never stores it.** The proxy keeps today's pass-through: Orca
  sends the token as its "Personal access token", and the proxy forwards it to Shortcut. This is already safe
  from web pages: browsers can't attach an `Authorization` header to a cross-origin request to localhost without
  a CORS preflight, which the proxy never approves.
- **Unsigned build.** The README and release notes explain how to open it the first time.

## Behaviour of the proxy

Unchanged from today: token pass-through, bind to `127.0.0.1` only, the Host-header check, all routes and
mappings, and the JQL compiler. The only additions are hooks for the app: report each request (for the log and
the "connected" status) and the identity behind the token (for the confirm step), without the token itself ever
leaving the proxy's request handling. The identity can come from the cached `/api/v3/member` lookup the proxy
already does.

## JQL quirks the guide must explain

These are real behaviours of the current implementation:

- **Project = Shortcut team**, keyed by the team's mention name in caps (`MOBILE`).
- **Issue keys are `SC-<story id>`**; epics show as parents with keys `EPIC-<id>`.
- **Issue types:** Feature (alias Story), Bug, Chore (alias Task).
- **Status category:** `To Do` = Shortcut backlog + unstarted states, `In Progress` = started, `Done` = done.
  `resolution = Unresolved` means "not done".
- **`!=` and `not in` skip empty fields**, like Jira (`assignee != me` excludes unassigned stories).
- **Custom fields by name**, with prefix matching on values (`priority = P1` matches `P1 - Critical`).
  `priority > P3` means *more important* than P3.
- **Search limits:** Shortcut search can't sort and can only search some fields. The proxy reads up to 500
  stories per query and sorts locally. Queries that only use fields Shortcut can't search (e.g. `Customer Tier`, sprint
  names, key ranges) scan those 500 and can miss matches; adding a team, assignee or status condition fixes it.
  `OR` / `in (…)` run as separate searches, up to 8 per query.
- **Text search:** `text ~` uses Shortcut's search; `*` wildcards are ignored; `NOT text ~ …` isn't possible.
  `summary ~` checks the title exactly and can be negated.
- **Dates:** relative values (`-7d`), `startOfWeek()` etc. use the Mac's local time; weeks start on **Monday**.
- **Not supported:** `WAS` / `CHANGED` history, `watcher`, saved filters, attachments/images, editing
  descriptions or custom fields other than Priority. These return a clear error.
- **`ORDER BY`** default is `updated DESC`; empty values sort last.

## Non-goals

- Windows / Linux builds.
- Code signing, notarisation, or auto-update (users download new releases manually).
- Supporting several Shortcut workspaces or tokens at once.
- A menu-bar-only app; the dock icon is the point.
- Any change to what the proxy can do in Shortcut, or to the JQL feature set.

## Anti-goals (failure even if it "works")

- The Shortcut token ending up anywhere readable: files, logs, the request log, crash output, or the UI.
- A teammate needing the terminal for normal setup, apart from the one-time unsigned-app workaround.
- Silently wrong search results (keep the current "error rather than guess" behaviour).
- The app quietly not running: if the proxy can't start (port taken, etc.) it must say so in the window and
  dock (badge or similar).

## Constraints

- Reuse the existing proxy modules; the Electron main process should import and run `handle()` from
  `src/server.ts` (refactored as needed to add the request/identity hooks).
- TypeScript, pnpm, Jest; `typecheck`, `lint` and `test` must pass. Follow the existing code style.
- macOS conventions: closing the window keeps the app (and proxy) running; Cmd+Q quits and stops the proxy.
- Builds for both Apple Silicon and Intel (*my call*: some engineers may still have Intel Macs). Two `.dmg`s or
  one universal build, builder's choice.

## Making the repo public

The repo becomes public, so nothing employer-internal ships in it:
- Replace real team names, people, custom-field names/values and workspace slugs in the README, docs,
  fixtures and tests with neutral examples (e.g. teams `WEB` / `MOBILE`, a made-up custom field). The JQL guide in
  the app uses the same neutral examples.
- No tokens, internal URLs or emails anywhere, including git history (start the repo fresh).
- The code itself has nothing workspace-specific (the workspace slug comes from Shortcut at runtime); keep it
  that way.
- Add a licence (*my call*: MIT) and a short README "what this is / install / first launch" section aimed at
  someone who's never seen it.

## Fin's machine (migration)

After the app works on Fin's machine, remove the old setup: LaunchAgent
`~/Library/LaunchAgents/local.shortcut-jira-proxy.plist` and `~/start-jira.sh`. Both use port 8089, so the
LaunchAgent must be stopped before the app can take the port. Ask Fin before deleting. Fin's Orca connection
needs no change: same URL, same token.

## Left to the builder

- Electron tooling (e.g. electron-builder vs Forge), renderer stack (keep it light; plain HTML/TS is fine), app
  icon, and window layout.
- How write access is detected. Newer Shortcut tokens have a `sct_rw_` / `sct_ro_` prefix; older UUID tokens
  don't. If there's no cheap way to tell for those, say "couldn't verify write access" rather than guessing.
  A Shortcut 403 on a write request is also a reliable signal to surface.
- How "Orca connected" is detected (e.g. any authenticated request in the last N minutes).
- How the request log is kept (in memory, last ~200 entries is plenty).
- CI details for the release workflow (GitHub Actions macOS runner, triggered by a `v*` tag).
- Unit tests for the new hooks and the settings store; the existing JQL and mapping tests stay.
