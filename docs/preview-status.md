# A2ACraft 0.4.6 — Mac preview status

This is a tester preview. Live conversation and file-work acceptance remains pending.

This preview renders common Markdown in conversation messages, exposes
the existing 1×1 / 1×2 / 2×2 layout controls, and preserves the selected layout
when opening a resident's conversation. Map reports show actual message text,
with the latest request and response available in the detail view. These changes
do not change saved conversations or execution permissions. Native 0.4.5 was launched; the existing four-chat group, formatted text and a
Markdown table were visible, and an unsent draft survived the switch. The map
detail exposed the actual latest request, response and table in the native
accessibility tree; its screenshot remained stale.

Conversation geography now uses a local, bounded TF-IDF vector of saved user
and assistant text, with titles used only as a supplement. Nearby text vectors
place residents and their buildings nearby; different topics spread across the
continent. This is lexical similarity, not a remote embedding service. No
conversation text is sent elsewhere for this calculation. Weak relationships
are omitted from the village road network; stronger relationships have wider
roads, with deterministic gentle bends validated against their full width.
Both projections use the same positions, clearings and road geometry.
The existing project map retains its separate topic-based relationship model.

Native 0.4.6 initially timed out during backend module loading; after retry,
the running application exposed no window to the native control tool. Switching
to this build is not yet accepted. Its signature and packaged frontend were
verified separately. An isolated empty-data check using the packaged executable
and backend reached ready in 441 ms, served the UI and all three new geography
modules, and shut down cleanly without Codex sign-in or a model turn. This does
not prove native window recovery. In the live browser with explicit fictional sample data, the new island overview,
neighborhood navigation, a walk to a distant resident, face-to-face dialogue,
request/response details, opening the conversation and returning to the village
were observed. No model turn was sent during these display checks.

| Check | Result |
| --- | --- |
| Automated regression tests | 410 passed in the full suite, plus two new spatial acceptance cases; 24 focused checks passed after the final UI fixes. Zero failures/skips. Coverage includes history imports, effective permission checks, keyboard-addressable transcripts, Markdown safety/streaming, multi-pane draft preservation, detailed map content including attachment-only requests, local vector distances, dry reachable settlements and shared winding road geometry |
| Conversation geography | 26/168 fictional-chat fixtures: all homes reachable. In the 168-chat fixture, same-topic median distance 480 versus 3,735 between topics; visible roads meet the 0.45 affinity threshold and full-width terrain checks. Layout takes approximately 1.4 seconds on the development Mac. This is a projection, not an exact preservation of every pairwise distance |
| Codex history import | Native import of 22 conversation records confirmed; visible messages only. Single-file bundles, idempotent updates and safe snapshots are covered by regression tests |
| Long imported conversations | Full transcript retained in the assigned workspace; a bounded recent excerpt and archive reference are prepared before sending |
| Packaged Apple Silicon application | 0.4.6 built with the frontend, Codex 0.169.0, icon and third-party notices; ad-hoc signature verified and all 127 frontend files matched the reviewed source |
| Native launch and app-specific ChatGPT sign-in | Packaged 0.4.3 launch, saved-account connection and restart observed; packaged 0.4.5 launch and existing four-chat display also observed |
| Drafts and settings | Saved drafts and selected work-folder settings persisted across restart |
| Imported-chat navigation | Resident arrival, opening the imported development chat and returning to the village were confirmed in the native UI. After the allowance recovered, a bounded read-only request completed and the displayed count increased from 523 to 525 messages. Moving-frame visual acceptance remains pending because screen capture returned stale images |
| Connection readiness | Native checks report ready for both conversation and file work using the bundled Codex. The check starts no model turn and sends no conversation content |
| Live model response and file work | A live request reached completed status after the quota reset. The response text is not yet independently confirmed; file creation and persistence of the new results remain pending. |
| Scoped managed permissions | The app selects dedicated chat/work profiles only when explicitly allowed, then verifies the effective scope. Chat must be read-only; work must stay inside the assigned conversation folder, with tool network access and temporary-directory writes disabled |
| Protection rules | SSH/Proton protections remain intact. Narrower host profiles were applied by the administrator, matched the reviewed configuration and passed the app's effective-scope checks. The app does not alter managed policy automatically |
| Screen-reading support | An optional native View menu setting persists across restart. Renderer controls became accessible after enabling it and reopening the app. Version 0.4.4 also gives each transcript a keyboard-focusable, named region without announcing the whole imported history; named transcript regions were observed in the native 0.4.5 four-pane UI |
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
