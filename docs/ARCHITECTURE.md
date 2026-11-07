# Right Click Mention — アーキテクチャ

右クリックメニューから、公式 Claude Code 拡張の「Insert @-Mention Reference」（Alt+K）を呼び出すだけの薄いラッパー拡張。
自前でClaudeと通信はせず、**入口（メニュー）を足して、処理は公式拡張に委ねる**のが基本方針。

- バージョン: 0.0.2
- 対象モード: VS Code のClaudeパネル版のみ（`claudeCode.useTerminal` が true のときはメニューを出さない）
- 言語: TypeScript（`src/` を `tsc` で `out/` にコンパイル。テストは JavaScript のまま `out/` を読む）
- 対象: VS Code 1.94 以上、公式拡張 `anthropic.claude-code`（v2.1.317 で確認）

---

## 1. 全体構成

```mermaid
flowchart LR
  subgraph VSCode["VS Code（1ウィンドウ = 1拡張ホスト）"]
    direction LR
    subgraph Menus["右クリックメニュー（package.json で宣言）"]
      M1["エディタ: 選択あり<br/>Claudeに選択範囲を送る"]
      M2["エディタ: 選択なし<br/>Claudeにこのファイルを送る"]
      M3["エクスプローラー: ファイル・フォルダ<br/>Claudeにファイル・フォルダを送る"]
    end

    subgraph Ext["この拡張（src/extension.ts）"]
      SAE["sendActiveEditor()"]
      SF["sendFiles(clicked, selected)"]
      IM["insertMention(editor)"]
      STC["sendToClaude()"]
      PST["pasteIntoClaude()"]
      FB["copyReferences()<br/>buildReference() / buildFolderReference()"]
    end

    subgraph Claude["公式 Claude Code 拡張"]
      C1["claude-vscode.insertAtMention"]
      C2["claude-vscode.focus"]
      P["Claudeチャット入力欄"]
    end

    CB[("クリップボード")]
    PASTE["editor.action.clipboardPasteAction<br/>（VS Code 標準の貼り付け）"]
  end

  M1 --> SAE
  M2 --> SAE
  M3 --> SF
  SAE --> IM
  IM --> STC
  SF -->|ファイルを開いて| STC
  STC --> C1
  C1 --> P
  SF -->|フォルダ / 開けないファイル<br/>（コピーしてから）| PST
  PST --> C2
  C2 --> P
  PST --> PASTE
  PASTE -->|クリップボードの中身| P
  IM -.->|拡張が無い / 失敗| FB
  SF -.->|拡張が無い / 失敗 / 貼り付けを呼べない<br/>（まとめて 1 回）| FB
  FB -.-> CB
```

**ポイント**

- メニュー項目・表示条件は `package.json` の `contributes.menus` だけで決まる（コードは書いていない）。
- 実際に `@file#5-10` を作ってチャットに入れるのは公式拡張。この拡張はそのコマンドを呼ぶだけ。
- フォルダとテキストで開けないファイルは、公式コマンドでは扱えない。参照をクリップボードにコピーし、公式の「Focus input」（`claude-vscode.focus`）で入力欄にフォーカスしてから、VS Code 標準の貼り付けを呼ぶ。使うのはどちらも公開されているコマンドだけ。
- 公式拡張が使えないときや貼り付けを呼べないときは、参照をクリップボードに入れて警告を出す。複数あるときは空白でつないで 1 回だけコピーし、お知らせ・警告も 1 回にまとめる。

---

## 2. ファイル構成

| ファイル | 役割 |
|---|---|
| `package.json` | 拡張のマニフェスト。コマンド3つと右クリックメニューを宣言 |
| `src/extension.ts` | 本体。コマンドの登録と処理。テスト用に `_internal` で内部関数も公開 |
| `out/` | `src/` のコンパイル結果。`package.json` の `main` はここを指す。git には入れない |
| `tsconfig.json` | TypeScript の設定（`strict` で型を厳しくチェック） |
| `.vscode/launch.json` / `tasks.json` | `F5` でコンパイルしてから拡張開発ホストを起動する設定 |
| `README.md` | 使い方（GitHub のトップに表示される） |
| `docs/ARCHITECTURE.md` | このファイル |
| `LICENSE` | MIT ライセンス |
| `.vscodeignore` | vsix に入れないファイルの指定（`src/`・`docs/`・`test/` など。vsix に入るのは `out/extension.js`・`package.json`・README・LICENSE） |
| `.gitignore` | git に入れないファイルの指定（`node_modules/`・`out/`・`*.vsix` など） |
| `.github/workflows/release.yml` | タグを push すると、テスト → vsix 作成 → Releases に添付（→ 9章） |
| `.github/dependabot.yml` | Action と devDependencies の更新を PR で知らせる |
| `.gitattributes` | 改行を LF にそろえる |
| `test/` | テスト一式（→ 10章）。vsix には含めない |

vsix はリポジトリに入れない。配るときは `npm run package` で作り、GitHub の Releases に添付する。

---

## 3. package.json（宣言部分）

```mermaid
flowchart TB
  subgraph commands["contributes.commands"]
    A["rightClickMention.sendSelection"]
    B["rightClickMention.sendCurrentFile"]
    C["rightClickMention.sendFile"]
  end
  subgraph menus["contributes.menus"]
    E1["editor/context<br/>when: editorHasSelection"] --> A
    E2["editor/context<br/>when: !editorHasSelection"] --> B
    E3["explorer/context<br/>（ファイルにもフォルダにも出す）"] --> C
    NOTE["※ すべての when に<br/>&& !config.claudeCode.useTerminal を付与"]
    E4["commandPalette<br/>when: false（パレットに出さない）"] --> C
  end
```

- `when` 条件で、選択の有無により**どちらか片方だけ**がメニューに出る。
- すべての `when` に `!config.claudeCode.useTerminal` を付けているので、ターミナル版の設定ではメニュー・パレットに出ない（公式拡張のコマンドパレット設定と同じ条件）。
- `sendFile` はエクスプローラーで選んだURIを引数に受け取る前提なので、コマンドパレットからは隠している。
- `activationEvents` は書いていない。VS Code 1.74 以降はコマンド実行時に自動で有効化される。
- `capabilities.untrustedWorkspaces.supported: false` で、制限モード（信頼していないワークスペース）では動かさない。

---

## 4. src/extension.ts の関数

| 関数 | 役割 |
|---|---|
| `activate(context)` | 3つのコマンドを登録（`sendSelection` と `sendCurrentFile` は同じ処理） |
| `sendActiveEditor()` | エディタからの右クリック。アクティブなエディタを `insertMention` に渡す |
| `sendFiles(clicked, selected)` | エクスプローラーからの右クリック。複数選択に対応。ファイルは開いて選択を空にしてから `sendToClaude`。フォルダ・開けないファイルは最後にまとめて `pasteIntoClaude` で貼り付ける。送れなかったものは `copyReferences` でまとめてコピー |
| `pasteIntoClaude()` | `claude-vscode.focus` で入力欄にフォーカス → 少し待つ → `editor.action.clipboardPasteAction`。呼べたら `true`（本当に入ったかは確かめられない） |
| `hasClaude()` | 公式拡張がインストールされているか |
| `insertMention(editor)` | `sendToClaude` で送り、送れなかったら `copyReferences` でコピー |
| `sendToClaude()` | 公式拡張の有無を確認 → 公式コマンドを実行。送れなかった理由を返す（送れたら `undefined`） |
| `copyReferences(refs, reasons)` | 参照を空白でつないで 1 回だけクリップボードにコピーし、理由をまとめた警告を 1 回出す |
| `isFolder(uri)` | `workspace.fs.stat` でフォルダかどうかを調べる |
| `buildReference(editor)` | `@path`, `@path#8`, `@path#5-10` を作る |
| `buildFolderReference(uri)` | フォルダの参照 `@path/` を作る（末尾の `/` でファイルと区別） |
| `relPath(uri)` | `asRelativePath` で公式と同じ形式のパスにする |

---

## 5. 処理の流れ

### 5-1. エディタで選択して右クリック

```mermaid
sequenceDiagram
  actor U as ユーザー
  participant VS as VS Code
  participant E as この拡張
  participant C as 公式Claude拡張
  participant W as Claudeチャット

  U->>VS: 選択して右クリック →「Claudeに選択範囲を送る」
  VS->>E: rightClickMention.sendSelection
  E->>E: activeTextEditor を取得
  E->>E: 公式拡張がインストール済みか確認
  E->>C: executeCommand('claude-vscode.insertAtMention')
  C->>C: activeTextEditor の選択から @path#5-10 を作る
  C->>W: 表示中のチャット全部に挿入（無ければ開いて挿入）
```

### 5-2. エクスプローラーでファイル・フォルダを右クリック

```mermaid
sequenceDiagram
  actor U as ユーザー
  participant VS as VS Code
  participant E as この拡張
  participant C as 公式Claude拡張

  U->>VS: ファイル・フォルダを右クリック（複数選択可）
  VS->>E: rightClickMention.sendFile(clicked, selected[])
  loop 選択されたものごと
    E->>VS: workspace.fs.stat
    alt フォルダ
      E->>E: @path/ を後回しリストに追加
    else ファイル
      E->>VS: openTextDocument + showTextDocument（選択は 0,0 で空）
      alt テキストとして開けた
        E->>C: sendToClaude → 公式コマンド
        C-->>U: @path がチャットに入る
        Note over E,C: 公式拡張が無い・失敗したら @path を後回しリストに追加
      else 画像などで開けない
        E->>E: @path を後回しリストに追加
      end
    end
  end
  alt 後回しがフォルダ・開けないファイルだけ（公式拡張あり）
    E->>VS: 空白でつないでクリップボードにコピー
    E->>C: claude-vscode.focus（入力欄にフォーカス）
    E->>VS: 150ms 待って editor.action.clipboardPasteAction
    VS-->>U: 参照がチャットに入る + お知らせ 1 回
  else それ以外（拡張が無い・失敗が混ざる・貼り付けを呼べない）
    E-->>U: 空白でつないで 1 回だけコピー + 警告 1 回
  end
```

ファイルを一度エディタで開くのは、公式コマンドが「アクティブなエディタ」からしか参照を作れないため（URIを引数で渡す口がない）。

### 5-3. フォールバックの判断

```mermaid
flowchart TD
  S([sendToClaude]) --> Q1{公式拡張<br/>anthropic.claude-code<br/>がある？}
  Q1 -- いいえ --> F[理由を返す → copyReferences<br/>参照をクリップボードへ]
  Q1 -- はい --> P[claude-vscode.insertAtMention]
  P --> Q3{例外が出た？}
  Q3 -- はい --> F
  Q3 -- いいえ --> OK([完了])
```

---

## 6. 参照文字列の形式

公式拡張のコマンド（`Alt+K`）を実際に動かしてチャットに入った文字列と比べ、同じ形式になるようにしている（フォールバックでクリップボードに入れるとき用）。

| 状況 | 例 |
|---|---|
| 選択なし | `@src/app.ts` |
| 1行 | `@src/app.ts#8` |
| 複数行 | `@src/app.ts#5-10` |
| マルチルート | `@beta/src/app.ts`（先頭にフォルダ名） |
| ワークスペース外 | 絶対パス |
| フォルダ | `@src/components/`（末尾に `/`。貼り付けでチャットに入れる。Claude Code はフォルダの中身の一覧として受け取る） |
| 複数（コピー・貼り付けするとき） | `@src/ @docs/ @logo.png`（空白でつなぐ） |

公式との違い（フォールバック時のみ）: 次の行の先頭で選択が終わっている場合、この拡張は最終行を1行減らす（公式は減らさない）。

---

## 7. 設計上の判断

- **公式コマンドに委ねる**: 参照の形式やチャットへの挿入方法を公式と完全に一致させられ、コードも短い。
- **公式拡張のコマンドに依存する**: 公式拡張の更新でコマンド名が変わると動かなくなる。その場合は `src/extension.ts` 冒頭の `CLAUDE_CMD` を書き換える（キーボードショートカット画面で「Insert @-Mention」を検索 → 右クリック →「コマンドIDをコピー」）。
- **失敗しても無駄にしない**: 送れない時はクリップボードにコピーし、手で貼れるようにしている。
- **フォルダは貼り付けで入れる**: 公式コマンドはファイルしか扱えないため、公開されている `claude-vscode.focus` と VS Code 標準の貼り付けを組み合わせる。公式拡張の中身は使わない。欠点は、クリップボードの中身を上書きすることと、本当に入ったかを確かめられないこと（お知らせに「入っていなければ Ctrl+V」と書いている）。フォーカスが移るまでの待ち時間は `FOCUS_WAIT_MS`（150ms）。手動で動くことを確認した。

---

## 8. 既知の制約（実験で分かったこと）

| 項目 | 内容 | この拡張で対処できるか |
|---|---|---|
| 送り先 | 表示中のClaudeチャットが複数あると全部に入る | できない（公式の動作） |
| 複数ウィンドウ | ウィンドウごとに独立して動く | 対処不要 |
| ターミナル版 | 対象外。`useTerminal` が true の時はメニューを出さない | 対象外（意図的） |
| 同じ名前のフォルダ | マルチルートで同名フォルダがあると参照が区別できない → `.code-workspace` の `"name"` で回避 | ワークスペース側で対処 |
| 設定のスコープ | `claudeCode.*` は全て window / application / machine スコープ。マルチルートではフォルダの settings.json に書いても効かない | できない（VS Code の仕様） |
| リモート（WSL/SSH） | リモート側にも拡張のインストールが必要な場合がある | インストールで対処 |

---

## 9. 開発・ビルド

```bash
# 動作確認（このフォルダを VS Code で開いて）
F5   # npm run compile をしてから拡張開発ホストが起動する（.vscode/launch.json）

# コンパイル
npm run compile   # src/ → out/
npm run watch     # 保存のたびにコンパイル

# パッケージ化
npm run package   # = vsce package。直前に vscode:prepublish でコンパイルされる

# 更新時は package.json の version を上げてから再パッケージ → VSIX から再インストール
```

配布用の VSIX は GitHub Actions（`.github/workflows/release.yml`）が作る。`v*` のタグを push すると、`package` ジョブ（読み取り権限のみ）がテストと VSIX 作成を行い、`release` ジョブ（書き込み権限あり・依存は入れない）が Releases に添付する。手順は README の「リリースの手順」を参照。

安全のための設定:

- `package` ジョブは `npm ci --ignore-scripts` で、依存パッケージのインストールスクリプトを動かさない。checkout の認証情報も残さない（`persist-credentials: false`）。
- 外部の Action はコミットの SHA で固定している。
- `release` ジョブは、vsix に出どころの証明（`actions/attest-build-provenance`）を付ける。`gh attestation verify <vsix> -R kip2/right-click-mention` で確かめられる。
- `.github/dependabot.yml` で、Action と npm の devDependencies の更新を月 1 回 PR にする（`@types/vscode` は `engines.vscode` に合わせて手で上げる）。

---

## 10. テスト

```mermaid
flowchart LR
  subgraph Unit["ユニットテスト（npm test・数百ms）"]
    M["test/helpers/vscode-mock.js<br/>VS Code APIのモック<br/>呼び出しを記録"]
    U1["buildReference.test.js<br/>行番号・パス形式"]
    U2["commands.test.js<br/>登録・送信・フォールバック"]
    U3["manifest.test.js<br/>package.json の整合性<br/>公式拡張との互換性"]
    M --> U1 & U2 & U3
  end
  subgraph Int["統合テスト（npm run test:integration）"]
    R["runTest.js<br/>テスト用VS Codeを起動"]
    W["fixtures/multi-root<br/>alpha / beta"]
    I["suite/extension.itest.js<br/>実APIで確認"]
    R --> W --> I
  end
  EXT["out/extension.js<br/>（src/extension.ts をコンパイル）"]
  U1 & U2 --> EXT
  I --> EXT
  U3 -.->|~/.vscode/extensions の<br/>公式 package.json| CL["公式Claude拡張"]
```

### 構成

| ファイル | 内容 | 件数 |
|---|---|---|
| `test/helpers/vscode-mock.js` | VS Code API のモック。`asRelativePath` のマルチルート挙動、`Selection` の正規化、バイナリで開けないファイルなどを再現。`setup()` でモック＋拡張＋activate を一度に用意 | — |
| `test/unit/buildReference.test.js` | 行番号（1行・複数行・次行先頭で終わる・逆方向選択）、パス形式（単一・マルチルート・別の場所・入れ子・ワークスペース外） | 15 |
| `test/unit/commands.test.js` | コマンド登録と dispose、送信の分岐（成功・拡張なし・例外・reject）、エクスプローラー（単一・複数・空・引数なし・バイナリ混在・フォルダの貼り付け・貼り付け失敗・拡張なし・ファイルとフォルダの混在・コピーと警告を 1 回にまとめる） | 27 |
| `test/unit/manifest.test.js` | package.json の基本項目、宣言とコードの一致、メニューの `when` 条件、制限モードの宣言、公式拡張にコマンドが存在するか | 15 |
| `test/run-unit.js` | ユニットテストの実行スクリプト（Windows / 古いNodeでも動くようにファイルを列挙） | — |
| `test/integration/runTest.js` | `@vscode/test-electron` でテスト用VS Codeを起動（他の拡張は無効） | — |
| `test/integration/suite/extension.itest.js` | 実VS Code上でマルチルートのパス、選択の扱い、エクスプローラー送信、バイナリファイル、フォルダの判定、ファイルとフォルダの混在 | 16 |
| `test/fixtures/multi-root/` | 統合テスト用ワークスペース（同名の `app.js` を持つ alpha / beta、バイナリファイル） | — |

### 実行方法

```bash
npm install                 # 初回のみ（TypeScript とテスト用の依存を入れる）
npm test                    # コンパイル → ユニットテスト
npm run test:spec           # コンパイル → ユニットテスト（結果を一覧表示）
npm run test:integration    # コンパイル → 統合テスト（初回はテスト用VS Codeをダウンロード）
```

### ポイント

- **テストは JavaScript のまま**: テストはコンパイル後の `out/extension.js` を読む。そのため `npm test` などは、先に `npm run compile` を自動で実行する（`pretest`）。ユニットテスト自体は Node 標準の `node:test` を使い、テスト用のライブラリは要らない。
- **公式拡張の更新を検知**: `manifest.test.js` は `~/.vscode/extensions/anthropic.claude-code-*` の package.json を読み、呼んでいる `claude-vscode.insertAtMention` がまだ存在するかを確認する。公式拡張を更新した後に `npm test` を流せば、コマンド名の変更に気づける。見つからない環境ではスキップ（`CLAUDE_EXT_DIR` で場所を指定可能）。
- **統合テストは公式拡張なし**: テスト用VS Codeでは他の拡張を無効にするため、送信結果はクリップボードで確認する（フォールバック経路）。公式拡張のチャット欄に入るところは自動テストできないので、手動で確認する。
- **テストの効き目を確認済み**: わざとバグを入れて（行番号の0始まり、コマンドID誤り、例外の握りつぶし、選択リセット削除、複数選択の無視、フォルダ名の欠落、メニュー条件の欠落 など9種類）すべて検出できることを確認した。

