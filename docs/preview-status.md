# A2ACraft 0.4.5 — Mac preview status

This is a tester preview. Live conversation and file-work acceptance remains pending.

The next preview renders common Markdown in conversation messages, exposes
the existing 1×1 / 1×2 / 2×2 layout controls, and preserves the selected layout
when opening a resident's conversation. Map reports show actual message text,
with the latest request and response available in the detail view. These changes
do not change saved conversations or execution permissions. Native visual
verification will resume when the owner finishes playing the previous build.

| Check | Result |
| --- | --- |
| Automated regression tests | 390 passed, zero failures/skips. Coverage includes history imports, effective permission checks, keyboard-addressable transcripts, Markdown safety/streaming, multi-pane draft preservation, and detailed map content including attachment-only requests |
| Codex history import | Native import of 22 conversation records confirmed; visible messages only. Single-file bundles, idempotent updates and safe snapshots are covered by regression tests |
| Long imported conversations | Full transcript retained in the assigned workspace; a bounded recent excerpt and archive reference are prepared before sending |
| Packaged Apple Silicon application | Built with the frontend, Codex 0.169.0, icon and third-party notices |
| Native launch and app-specific ChatGPT sign-in | Packaged 0.4.3 launch, saved-account connection and restart observed |
| Drafts and settings | Saved drafts and selected work-folder settings persisted across restart |
| Imported-chat navigation | Resident arrival, opening the imported development chat and returning to the village were confirmed in the native UI. After the allowance recovered, a bounded read-only request completed and the displayed count increased from 523 to 525 messages. Moving-frame visual acceptance remains pending because screen capture returned stale images |
| Connection readiness | Native checks report ready for both conversation and file work using the bundled Codex. The check starts no model turn and sends no conversation content |
| Live model response and file work | A live request reached completed status after the quota reset. The response text is not yet independently confirmed; file creation and persistence of the new results remain pending. Native testing paused while the owner plays the app |
| Scoped managed permissions | The app selects dedicated chat/work profiles only when explicitly allowed, then verifies the effective scope. Chat must be read-only; work must stay inside the assigned conversation folder, with tool network access and temporary-directory writes disabled |
| Protection rules | SSH/Proton protections remain intact. Narrower host profiles were applied by the administrator, matched the reviewed configuration and passed the app's effective-scope checks. The app does not alter managed policy automatically |
| Screen-reading support | An optional native View menu setting persists across restart. Renderer controls became accessible after enabling it and reopening the app. Version 0.4.4 also gives each transcript a keyboard-focusable, named region without announcing the whole imported history; native validation of that change is pending |
| Startup/renderer failure recovery | Recovery dialog observed. A separate bootstrap entry reports when dependency loading begins; startup failures expose only fixed stages/codes. Final native acceptance remains pending |
| Developer ID signing and notarization | Not available; Apple Developer Program registration is pending |
| Intel Mac | Not supported by the pinned document-extraction runtime |

Successful sign-in and “connection ready” results confirm different preparation
steps; neither proves a completed model response or file operation. The current
permission preflight now passes, and allowance recovery was confirmed before
the live request. Response-content verification, bounded file creation,
persistence of those results across restart, and final visual acceptance remain
required before declaring this build ready for general use.

The source distribution excludes internal specifications, conversations,
authentication files and local verification artifacts. Existing concept films
remain illustrative. See [first start](mac-first-start.md),
[build instructions](electron.md), and [component notices](../NOTICE.md).
