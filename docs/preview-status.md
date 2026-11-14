# A2ACraft 0.4.2 — Mac preview status

This is a tester preview. Live conversation and file-work acceptance remains pending.

| Check | Result |
| --- | --- |
| Automated regression tests | 374 passed, zero failures/skips. Coverage includes history imports, connection readiness, effective permission checks and rejecting model turns outside the assigned scope |
| Codex history import | Native import of 22 conversation records confirmed; visible messages only. Single-file bundles, idempotent updates and safe snapshots are covered by regression tests |
| Long imported conversations | Full transcript retained in the assigned workspace; a bounded recent excerpt and archive reference are prepared before sending |
| Packaged Apple Silicon application | Built with the frontend, Codex 0.169.0, icon and third-party notices |
| Native launch and app-specific ChatGPT sign-in | Sign-in and reconnection observed. The latest GUI launch attempt timed out, so the final rebuilt application still needs native acceptance |
| Drafts and settings | Saved drafts and selected work-folder settings persisted across restart |
| Connection readiness | A separate check prepares conversation and file-work threads without starting a model turn or sending conversation content. Native checks reached thread creation but rejected the managed host's broader effective permissions |
| Live model response and file work | Not accepted yet. The account-usage guard stopped the attempted live send before a model turn; final response and file-creation checks remain pending |
| Scoped managed permissions | The app selects dedicated chat/work profiles only when explicitly allowed, then verifies the effective scope. Chat must be read-only; work must stay inside the assigned conversation folder, with tool network access and temporary-directory writes disabled |
| Protection rules | SSH/Proton protections remain intact. A narrowing-only host-policy adjustment is prepared but has not been applied or verified; the app does not alter managed policy automatically |
| Startup/renderer failure recovery | Recovery dialog observed. A separate bootstrap entry reports when dependency loading begins; startup failures expose only fixed stages/codes. Final native acceptance remains pending |
| Developer ID signing and notarization | Not available; Apple Developer Program registration is pending |
| Intel Mac | Not supported by the pinned document-extraction runtime |

Successful sign-in and “connection ready” results confirm different preparation
steps; neither proves a completed model response or file operation. The current
native blocker is the effective permission scope, not the earlier reported
instruction-loading error. Applying the prepared narrow profiles and verifying
their actual scope, a live reply, file creation and restart recovery are still
required before declaring this build ready for general use.

The source distribution excludes internal specifications, conversations,
authentication files and local verification artifacts. Existing concept films
remain illustrative. See [first start](mac-first-start.md),
[build instructions](electron.md), and [component notices](../NOTICE.md).
