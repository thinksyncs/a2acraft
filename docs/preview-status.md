# A2ACraft 0.4.10 — Mac preview status

This is a tester preview. Live conversation and file-work acceptance remains pending.

Version 0.4.8 keeps the camera on the party when selecting a distant resident.
The island overview now changes only the camera; it no longer cancels the walk
while leaving the encounter waiting for arrival. A follow control returns to the
party. Travel displays the destination conversation and estimated remaining time.
Low-frame-rate updates no longer slow a visible walk by a factor of 12.5, and
pausing freezes travel instead of completing it immediately. Hidden intervals
reset the animation clock rather than jumping ahead when the window returns.

Residents now take short, deterministic walks around their homes, avoiding
water, buildings and mountains, and stop for an encounter. Nearby-conversation
cards show the actual latest request (or latest response if no request exists)
and provide a direct way to walk to that resident. No new model request is used
to generate these cards.

On 2026-11-16, a browser check with explicit fictional sample data completed a
long walk after switching to the island overview, restoring follow, pausing and
resuming. The remaining time decreased and the party reached face-to-face
dialogue. Native 0.4.8 launched and displayed the new context cards and a distant
resident walk with a following view and remaining-time label. The control tool
initially returned stale frames, `noWindowsAvailable`, and an unavailable
screenshot. A subsequent native-only check normally quit/reopened 0.4.8, then
used its View > Reload command after a blank capture. Fresh native captures
then showed a distant walk progressing from 31 to 13 seconds, arrival and
face-to-face display in both projections, opening the resident conversation,
sending a fictional sample message and receiving the local demo reply, and
returning to the village. Two captures about 18 seconds apart, with the camera
and buildings fixed, showed multiple residents changing position around their
homes. No model turn was sent. The successful run establishes this flow on the
Mac, but the earlier failure's root cause remains unconfirmed: renderer
occlusion, rendering state and the native capture tool were not independently
instrumented during the failure. It is not evidence of missing macOS permission.

Version 0.4.9 adds a native Window > Restore Display action without reloading,
and a Display Diagnostics dialog containing only window/renderer state and a
bounded recent event list. It saves that structural report only when requested;
it does not collect conversations, URLs, credentials or screen images. View >
Reload Display first waits for drafts and map state to save. A save failure
keeps the current page instead of discarding unsaved text. These are recovery
and diagnostic improvements, not a claim that the capture failure is cured.
The 0.4.9 package passed strict signature and source comparisons. Native control
timed out while switching from 0.4.8 to 0.4.9, so the new diagnostic dialog and
unsent-draft reload have automated coverage but have not yet been observed in
the packaged 0.4.9 UI. Do not treat the successful 0.4.8 village run as that check.

On 2026-11-17, the native control tool explicitly reported that the Mac was
locked. That blocks the current native acceptance attempt; it does not establish
the cause of the earlier switching timeouts. A code review found that an old
instance waiting for a save decision continues to own the single-instance lock,
so opening a newer build can reveal the old instance instead. No such pending
save dialog has yet been observed during this investigation.

Version 0.4.10 reveals the app-owned window before presenting a save or reload
failure dialog, so a hidden/minimized window does not conceal the decision.
It preserves the existing retry, cancel and unsaved-data behavior. The village
legend, whole-project map button and nearby-conversation cards also use a
coordinated layout to avoid overlapping controls. Browser screenshots and DOM
geometry at 1280×720, 600×620 and 900×500 confirmed separate rows and
scrollable context on short windows. Native diagnostic and unsent-
draft reload checks remain pending until the Mac is unlocked.

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
the running application exposed no window to the native control tool. In a
later session its Connect screen, saved four-pane conversation structure and
normal quit were observed. An isolated empty-data check of its packaged backend
reached ready in 441 ms. The original module-loading delay remains unexplained.

Version 0.4.7 keeps an isolated startup window visible while settings and the
backend load, then explicitly shows the main window when navigation completes.
It no longer depends on a first-frame notification to become visible. Dock
activation and repeated opens restore/show/focus the app; stalled page loading
reaches the existing recovery dialog within 30 seconds. Quit still uses the
existing draft/settings save coordinator, and late load completion cannot
reopen a window after quitting. These behaviors have regression coverage.
The packaged code and ad-hoc signature were verified. On 2026-11-15, the
user confirmed that native 0.4.7 opened to Connect or the conversation/map
screen. This confirms startup-window visibility on the user's Mac. Native
Dock/reopen and failure-recovery scenarios have automated coverage but were
not independently observed after the native control tool became unavailable.

In the live browser with explicit fictional sample data, the new island overview,
neighborhood navigation, a walk to a distant resident, face-to-face dialogue,
request/response details, opening the conversation and returning to the village
were observed. No model turn was sent during these display checks.

| Check | Result |
| --- | --- |
| Automated regression tests | 448 passed in the full suite. Zero failures/skips. Coverage includes saved reload failure/retry/close races, narrow display diagnostics, distant travel through overview/follow changes, low-frame-rate and pause/visibility timing, terrain-safe resident patrols, nearby conversation content, window reveal/timeout/quit races, history imports, effective permission checks, keyboard-addressable transcripts, Markdown safety/streaming, multi-pane draft preservation, detailed map content, local vector distances, dry reachable settlements and shared winding road geometry |
| Conversation geography | 26/168 fictional-chat fixtures: all homes reachable. In the 168-chat fixture, same-topic median distance 480 versus 3,735 between topics; visible roads meet the 0.45 affinity threshold and full-width terrain checks. Layout takes approximately 1.4 seconds on the development Mac. This is a projection, not an exact preservation of every pairwise distance |
| Codex history import | Native import of 22 conversation records confirmed; visible messages only. Single-file bundles, idempotent updates and safe snapshots are covered by regression tests |
| Long imported conversations | Full transcript retained in the assigned workspace; a bounded recent excerpt and archive reference are prepared before sending |
| Packaged Apple Silicon application | 0.4.10 built with the frontend, Codex 0.169.0, icon and third-party notices; strict ad-hoc signature verification passed. All 129 frontend files, the static serving allowlist and ASAR main/lifecycle/diagnostic/saved-reload modules matched the reviewed source |
| Native launch and app-specific ChatGPT sign-in | Packaged 0.4.3 launch, saved-account connection and restart observed; packaged 0.4.5 launch and existing four-chat display also observed |
| Drafts and settings | Saved drafts and selected work-folder settings persisted across restart |
| Imported-chat navigation | Resident arrival, opening the imported development chat and returning to the village were confirmed in the native UI. After the allowance recovered, a bounded read-only request completed and the displayed count increased from 523 to 525 messages. Moving-frame visual acceptance remains pending because screen capture returned stale images |
| Connection readiness | Native checks report ready for both conversation and file work using the bundled Codex. The check starts no model turn and sends no conversation content |
| Live model response and file work | A live request reached completed status after the quota reset. The response text is not yet independently confirmed; file creation and persistence of the new results remain pending. |
| Scoped managed permissions | The app selects dedicated chat/work profiles only when explicitly allowed, then verifies the effective scope. Chat must be read-only; work must stay inside the assigned conversation folder, with tool network access and temporary-directory writes disabled |
| Protection rules | SSH/Proton protections remain intact. Narrower host profiles were applied by the administrator, matched the reviewed configuration and passed the app's effective-scope checks. The app does not alter managed policy automatically |
| Screen-reading support | An optional native View menu setting persists across restart. Renderer controls became accessible after enabling it and reopening the app. Version 0.4.4 also gives each transcript a keyboard-focusable, named region without announcing the whole imported history; named transcript regions were observed in the native 0.4.5 four-pane UI |
| Startup/renderer failure recovery | Recovery dialog observed in 0.4.6. Version 0.4.7 adds a visible startup window, explicit reveal on completed navigation, Dock/repeated-open recovery and a bounded renderer load deadline. Startup failures expose only fixed stages/codes. The user confirmed successful 0.4.7 window display; native Dock/reopen and forced-failure checks remain unobserved |
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
