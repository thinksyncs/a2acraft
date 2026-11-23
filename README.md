# A2ACraft

**Conversations become worlds.**

**English** · [日本語](README.ja.md)

A world shaped by the conversations you have and the work your agents do together. Meet the people those conversations become, follow their work, and discover where their ideas lead next.

[![A2ACraft — watch the gameplay film in English](media/poster-en.jpg)](media/a2acraft-en-45s.mp4)

[Watch in English · 45 seconds](https://raw.githubusercontent.com/thinksyncs/a2acraft/main/media/a2acraft-en-45s.mp4) · [Watch in Japanese](https://raw.githubusercontent.com/thinksyncs/a2acraft/main/media/a2acraft-ja-45s.mp4)

[English subtitles](subtitles/en.srt) · [日本語字幕](subtitles/ja.srt)

## Try A2ACraft on Mac

[Download the Tauri 0.4.24 ZIP for Apple Silicon](https://github.com/thinksyncs/a2acraft/releases/download/v0.4.24-tauri/A2ACraft-0.4.24-Tauri-mac-arm64.zip) · [Release notes and SHA-256](https://github.com/thinksyncs/a2acraft/releases/tag/v0.4.24-tauri)

The app runs on Apple Silicon (M-series) with macOS 13.5 or later. Some bundled document and voice components require macOS 14 or later. Codex and the Node runtime are included.

1. Double-click the ZIP in Finder. From the extracted folder, drag `A2ACraft.app` to **Applications**.
2. Open **A2ACraft** from Applications. This tester build is ad-hoc signed and has no Apple notarization. If macOS says the developer cannot be verified, check the download against the SHA-256 below. If you trust the build, follow [Apple’s instructions for opening this app](https://support.apple.com/en-us/102445).
3. Choose **Connect**, sign in to ChatGPT when prompted, then return to A2ACraft. Open a chat and send a message to see the Codex reply.
4. To try file creation, start a new chat, open **＋**, and set the scope to **作業（専用フォルダ内）**. Ask Codex to create `hello.txt` containing `Hello from A2ACraft` and give you its path. Open that file in Finder and check the text.

ZIP SHA-256: `94362e5fd0894448b291d8543ee7ca88e2e10f7c464a9c7753393a44ba8ff63b`

## The idea

Agents take on different roles, share what they find, and bring their results together. Their conversations can suggest the next task. As the work grows, so does the town.

- **Skills become equipment.** Choose tools, weapons, and spells to help each character contribute.
- **Repositories become homes.** A project takes shape as a building, making the work visible in the town.
- **Themes shape the world.** Zoom out to find related towns nearby and different ideas farther away. New collaborations create new places to explore.

The film follows a party in the playable village. Walk to a resident, read a companion’s proposal and accept it from the map. Zoom out to see the settlements, then visit the king for a report on the parties’ progress. The footage uses the game’s fictional sample conversations and quests.

## Current prototype

A2ACraft is an MVP in development. The prototype lets you explore a town, talk to residents while keeping the map visible, and choose companions and equipment. We are working toward a short playable experience where your choices during a shared task change the town.

![The party meets Celia beside the river, with the leader’s view in the upper right](media/prototype-village.png)

This screenshot shows the frontend with fictional sample data. The repository also contains the A2ACraft Mac application source.

### Mac preview

The Apple Silicon preview bundles Codex 0.169.0 and provides an independent ChatGPT sign-in. You can open saved conversations without connecting, retain drafts and map position across restarts, and choose read-only conversation or work in a dedicated chat folder. External tools and inherited shell startup are disabled in the dedicated Codex configuration.

Imported Codex conversations can be opened and prepared for continuation. Connection settings include a separate readiness check that starts no model turn and verifies the effective conversation and file-work permissions.

This preview is for testers. Developer ID signing and Apple notarization are pending. On Apple Silicon, a tester launched the packaged Tauri 0.4.23 app, sent a message, and saw a live Codex reply in the chat window. File work was outside that test. For the Electron edition, native history import and ChatGPT reconnection were verified. See the [Electron verification status](docs/preview-status.md).

In Tauri 0.4.24, ⌘R saves drafts before reloading. The Window menu can recover or diagnose a window, and the app offers to restart when its backend stops unexpectedly.

The Rust/Tauri edition uses the macOS system webview. Each edition has its own saved data.

## Develop A2ACraft

Both editions are developed and released from [thinksyncs/a2acraft](https://github.com/thinksyncs/a2acraft). Use the `main` branch for development and the release tag to reproduce a published version. The map and chat UI live in `public/`, the shared Codex backend is at the repository root, and the desktop hosts are in `src-tauri/` and `electron/`.

```sh
git clone https://github.com/thinksyncs/a2acraft.git
cd a2acraft
npm ci
npm test
```

On an Apple Silicon Mac with Node.js 22 or later, run `npm run tauri:build` for Tauri or `npm run dist:mac:arm64` for Electron. The Tauri build also requires Rust, Cargo and Xcode Command Line Tools.

- [Build the Rust/Tauri app](docs/tauri.md)
- [Build the Electron app](docs/electron.md)
- [First start and verification](docs/mac-first-start.md)
- [Third-party notices](NOTICE.md)

## Help shape the first quest

What everyday task would you like to turn into a small adventure? [Share an idea or feedback](https://github.com/thinksyncs/a2acraft/issues/new). Please use fictional examples and keep private conversations and credentials out of public issues.

This repository contains the application source, build instructions, tests, and gameplay films. Internal specifications, private conversations, authentication data and local verification records are not included. No blanket open-source license is granted; see the component notices and media credits.

[Credits and media sources](CREDITS.md)
