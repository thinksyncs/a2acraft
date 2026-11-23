# A2ACraft の Tauri 版を Mac で使う

Tauri 版は、Mac 標準の WebKit に A2ACraft の地図と会話を表示します。Rust 側がウィンドウ、保存と終了の処理を担当します。地図、チャット、Codex への接続には Electron 版と共通のコードを使います。

## 開発環境から開く

Apple Silicon Mac、macOS 13.5 以降、Xcode Command Line Tools、Rust と Cargo、公式配布の Node.js 22 以降を用意します。アプリにはビルドに使った Node 実行ファイルとライセンスを同梱するため、Mac と同じアーキテクチャの Node と Rust を使います。参照する npm と Rust の依存関係はリポジトリのロックファイルで固定しています。

0.4.24 のビルド確認環境は Rust/Cargo 1.100.0 と Node.js 24.22.3 です。

```sh
npm ci
npm run tauri:dev
```

画面から Codex に接続して会話を始めます。サンプルの街を見たい場合は `npm run tauri:demo` で起動できます。

## アプリを作る

```sh
npm run tauri:test
npm run tauri:build
npm run tauri:verify:mac
open src-tauri/target/release/bundle/macos/A2ACraft.app
```

ビルド済みアプリには Node と Apple Silicon 用 Codex CLI が入っています。終了後は Finder から同じアプリを開けます。手元で作ったアプリの公開配布には、Developer ID 署名と Apple の公証を別途用意してください。

## 保存先

通常起動時の設定とアプリデータは `~/Library/Application Support/com.thinksyncs.chatui.tauri/` に保存します。これは従来の Tauri 版と同じ識別子です。Electron 版は独立した保存先を使います。保存した会話を持ち込むには、アプリの履歴取り込みを利用できます。
