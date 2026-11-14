# A2ACraft — Electron版

ToppyMicroServicesが開発する **A2ACraft** のデスクトップ実装です。既存データを引き継ぐため、内部のアプリIDと保存先は維持します。以下の標準ビルドは開発者署名・公証前の確認用パッケージを作成します。署名済みの一般配布版の提供を示すものではありません。

アプリを受け取った方は [Mac版の初回起動](mac-first-start.md) を参照してください。

ブラウザ版と同じ Codex App Server 接続を、Electron の専用ウィンドウで使用します。APIキーや API 課金への切り替えは追加していません。

## 起動

```sh
npm ci
npm run desktop:demo
npm run desktop
```

デモは画面・レイアウト・アニメーションの確認用です。専用の静的ファイル配信だけを起動し、実接続用バックエンド・Codex CLI・ターミナルは起動しません。

Mac配布版は公式Codex CLI 0.169.0と必要な実行時ファイルを同梱します。受け取る側でNode.js・Homebrew・Codex CLIを別途インストールする必要はありません。A2ACraft専用の認証領域でログインし、既存Codexアプリの認証情報や設定を自動で共有しません。ソースからの開発起動や任意のCLIを使う場合は、Connect画面の「接続設定を開く」から実行ファイルを選び、アプリを再起動します。または `CODEX_BIN` に絶対パスを指定できます。Windows はネイティブ `codex.exe` を指定し、`.cmd` をshell経由で実行しません。

```sh
CODEX_BIN=/absolute/path/to/codex npm run desktop
```

ブラウザ版は従来どおり `npm start` で起動します。

## 保存と起動方式

- Electron がバックエンドを別プロセスで起動し、`127.0.0.1` の空きポートを使用します。
- Electron の `userData/data/` に会話と専用ワークスペースを保存します。アプリのインストール先には書き込みません。
- デスクトップ設定は `userData/desktop-settings.json` に保存します。
- 下書き・選択会話・分割レイアウト・動きの設定は `userData/ui-state.json` に保存します。起動時のポートが変わっても復元できます。
- 地図の位置・倍率・主人公の位置・目線の小窓・住民の道中位置と既読は `userData/map-state.json` に保存し、地図の初期化前に復元します。通常の街とデモは別の項目に保存します。読み込めない保存データを初期位置で上書きしません。
- 2回目の起動は既存ウィンドウを手前に表示します。
- ウィンドウを閉じると画面の最新の下書き・地図・設定の保存を確認してから、GUIサーバーとCodex App Serverを終了します。保存失敗時は戻る・再試行・保存せず終了を選べます。
- GUIサーバーが停止した場合はエラーを表示して終了します。

`userData` の標準位置は macOS が `~/Library/Application Support/`、Windows が `%APPDATA%`、Linux が `$XDG_CONFIG_HOME` または `~/.config/` 配下です。内部のnpm名 `personal-chat-ui` とアプリID `com.thinksyncs.chatui` は互換性のため維持しています。表示・配布名は `A2ACraft` ですが、`package.json` の内部名や保存先の名前を改名する変更は含めていません。既存データの自動移動は行いません。

作業場所は設定から専用フォルダを選ぶか、「専用フォルダのパス」に絶対パスを入力して変更できます。「作業場所を保存」を押し、アプリを再起動すると反映されます。管理されたMacで既定の作業場所が拒否される場合は、すでに利用を許可された専用フォルダを指定します。会話データと認証情報の保存先は移動せず、端末の保護設定も変更しません。

今回のMac配布対象はElectron版です。

## Renderer とローカル通信

`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` を設定します。rendererへNode APIや直接のファイルアクセスを公開しません。限定された preload API はウィンドウ操作、許可されたリンクを開く操作、CLI実行ファイルの選択、検証済みの下書き・地図状態の保存と終了前の保存確認を扱います。

Terminalタブは認証済みのlocalhost APIを通して、バックエンドのPTYへ手動入力を送ります。シェルは端末の通常権限で実行します。初期ディレクトリは `userData/data/workspace/` です。アプリ終了時にはシェルも終了します。`node-pty` の実行ファイルは `app.asar.unpacked` に含めます。画像・文書の添付も同じバックエンドを使い、文書抽出用のXbergネイティブライブラリを同梱します。

バックエンドは Host と Origin を検証します。Electron版では起動ごとのランダムな HttpOnly セッションクッキーが必要で、通常の別ブラウザからAPIを呼べません。この値は UI の JavaScript に公開せず、Codex の子プロセスにも渡しません。同一 OS ユーザーのプロセスや端末管理者から認証情報を隔離する機能ではありません。

ChatGPT ログインは OS のブラウザで実行します。HTTPS の `auth.openai.com`、`login.openai.com`、`chatgpt.com`、`auth.chatgpt.com` の正確なホスト名だけを許可します。renderer 内の外部サイトへの移動、webview、新規ウィンドウ、ダウンロード、一般的なデバイス権限は許可しません。

Mac配布版のCodex認証・設定はA2ACraft専用領域に分離します。既存Codexの認証や設定はコピーしません。UIはトークンを表示したり共有したりせず、公式ログイン画面で認証します。`gh`認証は不要です。

## Renderer API

`window.desktop` は Electron 起動時にだけ存在します。

| API | 用途 |
| --- | --- |
| `isElectron`, `platform`, `version` | デスクトップ表示の判定 |
| `minimize()` | 最小化 |
| `toggleMaximize()` | 最大化／復元 |
| `close()` | ウィンドウを閉じてプロセスを終了 |
| `openExternal(url)` | 許可された HTTPS ログイン先を OS ブラウザで開く |
| `getSettings()` | `{codexPath, restartRequired}` を取得 |
| `getUiState()` | `{drafts, sendRequests, selected, layout, motion}` を復元 |
| `saveUiState(state)` | 下書きとUI設定を保存。保存は順番に処理して終了前に完了を待つ |
| `getMapState({demo})` / `saveMapState({demo, items})` | 許可した地図項目だけを読み書き。通常とデモを分離し、任意のキーやファイルパスは受け付けない |
| `onBeforeClose(callback)` | 終了前の画面保存を要求。終了を取り消した場合も通知し、入力を再開する |
| `selectCodexPath()` | ネイティブファイル選択。次のアプリ起動から使用 |
| `resetCodexPath()` | CLIパス設定を削除。次の起動から同梱CLIを使用（開発環境では既定の解決方法を使用） |
| `onWindowState(callback)` | `{maximized}` 通知。戻り値は購読解除関数 |

タイトルバーのドラッグ領域には `app-region: drag`、ボタンには `app-region: no-drag` を設定します。

## 配布用パッケージ

Mac上で、ロックファイルに固定した依存関係をインストールしてビルドします。利用者のMacにNode.js・Homebrew・Codex CLIを別途インストールする必要はありません。公式Codex CLIと、その配布元が含めるコード実行・検索・音声ライブラリ資源を同梱し、元のライセンス通知も保持します。

```sh
npm ci
npm run check:modules
node scripts/prepare-distribution-notices.mjs
node --test test/distribution.test.mjs test/module-size.test.mjs
npm run dist:mac
```

`dist:mac` はApple Silicon（arm64）用のDMG・ZIPを作ります。CPUを明示する場合も、対応する対象は次のarm64です。

```sh
npm run dist:mac:arm64
```

インストーラーを作らず `.app` を確認する場合は `npm run pack:mac` を使います。出力先は `dist/`、配布ファイル名は `A2ACraft-0.4.0-mac-arm64.dmg` のようにバージョンとCPU種別を含みます。バージョンは `package.json` に従います。

今回の対象はApple Silicon（arm64）です。固定版のXberg 1.3.7にmacOS x64用バイナリがないため、Intel向けのパッケージ作成は事前検査で停止します。

macOSの標準設定は `identity: null`・`notarize: false` です。Mac用コマンドは署名用IDの自動探索を無効にし、`--publish never` で外部公開を行いません。証明書・Keychain・公証用認証情報を探索するビルド手順は含めません。開発者署名・公証済みの正式配布物を作る場合は、配布者が承認した別のリリース設定が必要です。

`afterPack` は変更後のアプリをad-hoc署名し、整合性を検査します。Apple Siliconで不正になった既存署名のまま起動しようとする問題を避けるためで、配布者の証明書は使用せず、Developer ID署名や公証を代替しません。

配布前に `scripts/prepare-distribution-notices.mjs` が固定版のライセンスを照合し、`artifacts/distribution-notices/` を生成します。これを `Contents/Resources/licenses/` へ同梱します。20MB超のElectron同梱Chromium通知は依存パッケージからコピーし、ソースrepoには重複保存しません。版や通知の内容が変わると事前処理は停止します。依存更新時は通知と由来を確認して `licenses/manifest.json` を更新してください。[第三者通知](../NOTICE.md)には確認済みの範囲を記録しています。

Electronの実行時モジュールは `electron/*.mjs` とpreload、バックエンドは明示したサービスモジュールと `public/**/*` を同梱します。テストはアプリに含めません。新しい相対import先の同梱漏れは `test/distribution.test.mjs` が検出します。復元作業用の `public` シンボリックリンクを利用している環境では、配布内容に実体のファイルが入っていることを生成物で確認してください。

Windows・Linux向けの既存コマンドも保持していますが、今回の配布対象と検証対象はmacOSです。

```sh
npm run dist:win
npm run dist:linux
```

Windows は NSIS、Linux は AppImage/DEB です。各OSでの実機確認と配布要件の確認は別途必要です。

## 検証

ソースの単体テスト、同梱ファイルの静的検査、配布物の起動確認、実アカウントでの動作確認は別々に記録します。ビルド設定が揃っていることだけで、一般配布可能とは判断しません。

```sh
npm test
```

`npm test` はローカルfixtureを使う検証です。配布物のGUI確認は、生成された `A2ACraft.app` を起動して次の操作を実際に確認します。自分のアカウントでの接続確認は、アプリ内の公式ログイン画面から行います。

macOS配布前には、少なくとも対応CPU向け生成物で次を確認します。

- クリーンな保存先から起動し、同梱ファイルの欠落なく接続画面・デモを開ける。
- 2Dと3Dで歩行・村人との会話・街へ戻る操作が一致する。
- 会話の切り替え・アプリ終了・再起動で下書きが保たれ、保存失敗時に内容を失わない。
- Codex未導入・未ログイン・接続失敗から、設定や再接続で復帰できる。
- アプリを終了すると専用バックエンドだけが終了し、他のアプリやサービスを妨げない。

ビルド・実機・署名・公証の確認結果は、静的検査の成功から推定しません。検証対象のバージョンと配布物を記録し、過去の端末での成功記録を今回の配布物の確認結果として扱いません。

実アカウントのOAuth、実モデルの推論、各 OS の署名・公証は本人の認証と配布環境で検証します。

## 一次資料

- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)
- [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)
