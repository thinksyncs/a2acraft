# A2ACraft 0.4.1 — Mac preview status

Checked on 2026-11-14. This is a tester preview, not a completed general release.

| Check | Result |
| --- | --- |
| Automated regression tests | 341 passed, zero failures/skips |
| Codex history import | Visible messages only; single-file bundles, idempotent updates and safe snapshots covered by regression tests |
| Long imported conversations | Full transcript retained in the assigned workspace; a bounded recent excerpt and archive reference are prepared before sending |
| Packaged Apple Silicon application | Built with the frontend, Codex 0.169.0, icon and third-party notices |
| Native launch and app-specific ChatGPT sign-in | Observed in the native application; sign-in persisted across restart |
| Drafts and settings | Saved drafts and selected work-folder settings persisted across restart |
| Live model response and file work | Not accepted yet: thread creation was blocked by an OS sandbox initialization error on the managed test host |
| Protection rules | No SSH/Proton protection was relaxed; the app checks effective thread permissions before sending a turn |
| Startup/renderer failure recovery | Recovery dialog added and unit-tested; final native acceptance remains pending |
| Developer ID signing and notarization | Not available; Apple Developer Program registration is pending |
| Intel Mac | Not supported by the pinned document-extraction runtime |

The sandbox error occurs before the model turn. Do not interpret successful
sign-in, sample conversations or mocked protocol tests as live execution proof.
The application does not remove managed restrictions to work around the error.

The source distribution excludes internal specifications, conversations,
authentication files and local verification artifacts. Existing concept films
remain illustrative. See [first start](mac-first-start.md),
[build instructions](electron.md), and [component notices](../NOTICE.md).
