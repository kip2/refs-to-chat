# Right Click Mention — アーキテクチャ

右クリックメニューから、公式 Claude Code 拡張の「Insert @-Mention Reference」（Alt+K）を呼び出すだけの薄いラッパー拡張。
自前でClaudeと通信はせず、**入口（メニュー）を足して、処理は公式拡張に委ねる**のが基本方針。

- バージョン: 0.0.5
- 対象モード: VS Code のClaudeパネル版のみ（`claudeCode.useTerminal` が true のときはメニューを出さない）
- 言語: TypeScript（本体もテストも `src/` に置き、`tsc` で `out/` にコンパイル）
- 対象: VS Code 1.94 以上、公式拡張 `anthropic.claude-code`（v2.1.317 で確認）

---

## 1. 全体構成

```mermaid
flowchart LR
  subgraph VSCode["VS Code（1ウィンドウ = 1拡張ホスト）"]
    direction LR
    subgraph Menus["右クリックメニュー（package.json で宣言）"]
      M1["エディタ: 選択あり<br/>選択範囲をClaudeのチャットに追加"]
      M2["エディタ: 選択なし<br/>このファイルをClaudeのチャットに追加"]
      M3["エクスプローラー: ファイル・フォルダ<br/>Claudeのチャットに追加"]
    end

    subgraph Ext["この拡張（src/）"]
      SAE["commands.ts<br/>addActiveEditorToChat()"]
      SF["commands.ts<br/>addExplorerItemsToChat()"]
      STC["claudeChat.ts<br/>insertActiveEditorMention()"]
      PST["fallback.ts → claudeChat.ts<br/>deliverDeferredReferences()<br/>（貼り付け）"]
      FB["fallback.ts<br/>deliverDeferredReferences()<br/>（コピー + 警告）"]
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
  SAE --> STC
  SF -->|ファイルを開いて| STC
  STC --> C1
  C1 --> P
  SF -->|フォルダ / 開けないファイル<br/>（コピーしてから）| PST
  PST --> C2
  C2 --> P
  PST --> PASTE
  PASTE -->|クリップボードの中身| P
  SAE -.->|拡張が無い / 失敗| FB
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
| `src/` | 本体（→ 4章）。役目ごとにファイルを分けている |
| `out/` | `src/` のコンパイル結果。`package.json` の `main` はここを指す。git には入れない |
| `tsconfig.json` | TypeScript（7）の設定（`strict` で型を厳しくチェック）。TypeScript 6 から `@types/*` が自動で読み込まれないので、`types` に node / mocha / vscode を書いている |
| `.oxlintrc.json` | Oxlint（リンター）の設定（→ 9章） |
| `.node-version` | 使う Node のバージョン（26）。CI の `setup-node` もここを読む |
| `.vscode/launch.json` / `tasks.json` | `F5` でコンパイルしてから拡張開発ホストを起動する設定 |
| `.vscode/extensions.json` | このフォルダを開くと、Oxlint 拡張（`oxc.oxc-vscode`）を入れるよう案内する |
| `README.md` | 使い方（GitHub のトップに表示される） |
| `docs/ARCHITECTURE.md` | このファイル |
| `LICENSE` | MIT ライセンス |
| `.vscodeignore` | vsix に入れないファイルの指定（`src/`・`docs/`・`out/test/` など。vsix に入るのは `out/*.js`・`package.json`・README・LICENSE） |
| `.gitignore` | git に入れないファイルの指定（`node_modules/`・`out/`・`*.vsix` など） |
| `.github/workflows/release.yml` | タグを push すると、テスト → vsix 作成 → Releases に添付（→ 9章） |
| `.github/workflows/ci.yml` | PR と main への push で、`npm ci`・リンター（Oxlint）・ユニットテスト・vsix 作成を確かめる |
| `CHANGELOG.md` | 変更履歴。リリースの説明文はここから作る |
| `.github/dependabot.yml` | Action と devDependencies の更新を PR で知らせる |
| `.gitattributes` | 改行を LF にそろえる |
| `src/test/` | テスト一式（→ 10章）。`out/test/` にコンパイルされるが、vsix には含めない |

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

## 4. src/ の構成

役目ごとにファイルを分けている。状態を持たない処理を順に呼ぶだけなので、クラスは使わず関数で書いている（状態を持つ必要が出たら、その部分だけクラスにする）。

```mermaid
flowchart TD
  EXT["extension.ts<br/>コマンドの登録"] --> CMD["commands.ts<br/>2 つのコマンドの処理"]
  EXT --> CONST["constants.ts<br/>定数"]
  CMD --> CHAT["claudeChat.ts<br/>公式拡張とのやり取り"]
  CMD --> FB["fallback.ts<br/>貼り付け・コピー"]
  CMD --> WS["workspace.ts<br/>パス・フォルダ判定・ファイルを開く"]
  CMD --> REF["reference.ts<br/>参照の文字列"]
  FB --> CHAT
  FB --> REF
  CHAT --> CONST
  WS --> CONST
```

`constants.ts` と `reference.ts` は vscode に依存しないので、テストからモックなしで直接読み込める。`extension.ts` が外に出すのは `activate` と `deactivate` だけ。

| ファイル | 中身 |
|---|---|
| `extension.ts` | `activate(context)`: 3 つのコマンドを登録（`sendSelection` と `sendCurrentFile` は同じ処理）。`deactivate()` |
| `commands.ts` | `addActiveEditorToChat()`: エディタの右クリック。公式コマンドで入れ、入れられなければ `deliverDeferredReferences` に渡す<br/>`addExplorerItemsToChat(clicked, selected)`: エクスプローラーの右クリック。ファイルは開いて公式コマンドで入れる。入れられなかったもの（フォルダ・開けないファイル・失敗）は `{ ref, reason }` として後回しにし、最後にまとめて `deliverDeferredReferences` に渡す |
| `claudeChat.ts` | `isClaudeInstalled()`<br/>`insertActiveEditorMention()`: 公式コマンドを呼ぶ。入れられなかった理由（`notInstalled` / `failed`）を返す<br/>`pasteClipboardIntoChat()`: `claude-vscode.focus` → 少し待つ → 標準の貼り付け |
| `fallback.ts` | `FallbackReason`（理由の種類）と表示文、`DeferredReference`（`{ ref, reason }`）<br/>`deliverDeferredReferences(deferred)`: 貼り付けるかコピーするかをここだけで決める。公式拡張があり、理由がフォルダ・開けないファイルだけなら貼り付け（お知らせ 1 回）。それ以外はコピー（警告 1 回）。公式拡張が無ければ、その理由も警告に足す |
| `workspace.ts` | `workspacePath(uri)`: 公式と同じ形式のパス<br/>`isFolder(uri)`: `workspace.fs.stat` で判定（シンボリックリンクのフォルダも含む。調べられなければファイル扱い）<br/>`openAsActiveEditor(uri)`: 選択なしで開いてアクティブにする（プレビューにしない）。開けない・表示できなければ `undefined`<br/>`isOpenInTab(uri)` / `closeTabs(uri)`: タブが開いているか調べる / 閉じる（`tabGroups` を使う） |
| `reference.ts` | `fileReference(path, selection?)`: `@path` / `@path#8` / `@path#5-10`<br/>`folderReference(path)`: `@path/`<br/>`joinReferences(refs)`: 空白でつなぐ |
| `constants.ts` | `COMMANDS`（この拡張のコマンド ID）、`CLAUDE`（公式拡張の ID とコマンド）、`PASTE_COMMAND`、`FOCUS_WAIT_MS`、`LOG_PREFIX` |

名前に使う動詞の使い分け:

| 動詞 | 意味 | 例 |
| --- | --- | --- |
| add | この拡張のコマンド（ユーザーから見た「チャットに追加」） | `addExplorerItemsToChat` |
| insert | 公式コマンドでチャットに入れる | `insertActiveEditorMention` |
| paste | クリップボードからチャットに貼り付ける | `pasteClipboardIntoChat` |
| deliver | 後回しにした参照を、貼り付けかコピーで届ける | `deliverDeferredReferences` |

`COMMANDS` のキーが `sendXxx` なのは、公開済みのコマンド ID（`rightClickMention.sendSelection` など）に合わせているため。

機能を足すときの置き場所の目安:

- 新しい右クリックメニュー → `package.json` に宣言、`constants.ts` に ID、`commands.ts` に処理、`extension.ts` で登録
- 公式拡張の別のコマンドを使う → `constants.ts` の `CLAUDE` と `claudeChat.ts`
- 参照の形式を変える・増やす → `reference.ts`（テストはモックなしで書ける）
- 貼り付けるかコピーするかの条件を変える（自動の貼り付けを切る設定など） → `fallback.ts` の `deliverDeferredReferences` だけ
- 設定を足す → `package.json` の `contributes.configuration` に宣言し、読む処理を使う側のファイルに置く

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

  U->>VS: 選択して右クリック →「選択範囲をClaudeのチャットに追加」
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
        E->>C: insertActiveEditorMention → 公式コマンド
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

開いたタブの扱い:

- 開く前にタブが開いているかを調べ、この拡張が開いたものだけ、公式コマンドで入れたあと（入れられずコピーに回ったときも）すぐ閉じる。もともと開いていたタブは残す。
- プレビュー（斜体のタブ）では開かない。プレビューで開くと、ユーザーがプレビューで開いていた別のファイルのタブを置き換えて消してしまうため。どうせ閉じるので、タブは残らない。
- もともと開いていたファイルは、選択を先頭に戻してから送る（公式コマンドが選択範囲を参照に含めてしまうため）。

### 5-3. フォールバックの判断

```mermaid
flowchart TD
  S([insertActiveEditorMention]) --> Q1{公式拡張<br/>anthropic.claude-code<br/>がある？}
  Q1 -- いいえ --> F[理由を返す → deliverDeferredReferences<br/>参照をクリップボードへ]
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
- **公式拡張のコマンドに依存する**: 公式拡張の更新でコマンド名が変わると動かなくなる。その場合は `src/constants.ts` の `CLAUDE` を書き換える（キーボードショートカット画面で「Insert @-Mention」を検索 → 右クリック →「コマンドIDをコピー」）。
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

# リンター（Oxlint）
npm run lint      # await 忘れなどを調べる（CI でも実行する）

# パッケージ化
npm run package   # = vsce package。直前に vscode:prepublish でコンパイルされる

# 更新時は package.json の version を上げてから再パッケージ → VSIX から再インストール
```

配布用の VSIX は GitHub Actions（`.github/workflows/release.yml`）が作る。`v*` のタグを push すると、`package` ジョブ（読み取り権限のみ）がテストと VSIX 作成を行い、`release` ジョブ（書き込み権限あり・依存は入れない）が Releases に添付する。リリースの説明文は `CHANGELOG.md` の該当バージョンの項目から作る（項目がなければ失敗する）。手順は README の「リリースの手順」を参照。

PR と main への push では `.github/workflows/ci.yml` が `npm ci`・リンター（Oxlint）・ユニットテスト・vsix 作成を確かめる。Dependabot の PR もここで確かめられるので、壊れる更新は取り込む前に気づける（TypeScript 7 への更新で `npm ci` が失敗したことがきっかけ）。

リンター（Oxlint、`.oxlintrc.json`）:

- TypeScript 7 に対応したリンターとして Oxlint を使う。型情報を使うルールは `oxlint-tsgolint`（TypeScript 7 の Go 版の上で動く）が担当する。
  - 以前は ESLint ＋ typescript-eslint を使っていたが、typescript-eslint が TypeScript 7 に対応していない（7 には JS から使う API がまだない）ため入れ替えた。
  - `oxlint-tsgolint` は決まった TypeScript のバージョンに合わせて作られているので、TypeScript を上げるときは一緒に上げる（Dependabot は devDependencies を 1 つの PR にまとめるので、同時に上がる）。
- ルールは、まず間違いを見つける `correctness` の一式と、`await` 忘れを見つける `typescript/no-floating-promises` だけにして、増やしすぎない。
- `no-floating-promises` には `checkThenables: true` を付けている。VS Code の API は `Promise` ではなく `Thenable` を返すので、付けないと見逃す（付けない状態で見逃すことを確かめた）。わざと待たない通知には `void` を付ける。
- `node:test` の `describe` / `it` は Promise を返すが待たなくてよいので、このルールの対象から外している。
- CI の `package` ジョブと `ci.yml` で、テストの前に `npm run lint` を実行する。

安全のための設定:

- Node は最新の LTS（26）を使う。バージョンは `.node-version` の 1 か所に書き、CI もそこを読む。

- `package` ジョブは `npm ci --ignore-scripts` で、依存パッケージのインストールスクリプトを動かさない。checkout の認証情報も残さない（`persist-credentials: false`）。
- 外部の Action はコミットの SHA で固定している。
- `release` ジョブは、vsix に出どころの証明（`actions/attest-build-provenance`）を付ける。`gh attestation verify <vsix> -R kip2/right-click-mention` で確かめられる。
- `.github/dependabot.yml` で、Action と npm の devDependencies の更新を月 1 回 PR にする（`@types/vscode` は `engines.vscode` に合わせて手で上げる）。

---

## 10. テスト

```mermaid
flowchart LR
  subgraph Unit["ユニットテスト（npm test・数百ms）"]
    M["helpers/vscodeMock.ts<br/>VS Code APIのモック<br/>呼び出しを記録"]
    U0["reference.test.ts<br/>参照の文字列（モックなし）"]
    U1["workspacePath.test.ts<br/>パス形式"]
    U2["commands.test.ts<br/>登録・送信・貼り付け・コピー"]
    U3["manifest.test.ts<br/>package.json の整合性<br/>公式拡張との互換性"]
    M --> U1 & U2 & U3
  end
  U0 --> REF["out/reference.js"]
  subgraph Int["統合テスト（npm run test:integration）"]
    R["runTest.ts<br/>テスト用VS Codeを起動"]
    W["fixtures/multi-root<br/>alpha / beta"]
    I["suite/extension.itest.ts<br/>実APIで確認"]
    R --> W --> I
  end
  EXT["out/extension.js<br/>（src/ をコンパイル）"]
  U1 & U2 --> EXT
  I --> EXT
  U3 -.->|~/.vscode/extensions の<br/>公式 package.json| CL["公式Claude拡張"]
```

### 構成

| ファイル | 内容 | 件数 |
|---|---|---|
| `src/test/helpers/vscodeMock.ts` | VS Code API のモック。`asRelativePath` のマルチルート挙動、`Selection` の正規化、バイナリで開けないファイルなどを再現。`setup()` でモック＋拡張＋activate を一度に用意（`out/` のファイルは毎回読み込み直す） | — |
| `src/test/unit/reference.test.ts` | 行番号（1行・複数行・次行先頭で終わる・逆方向選択）、フォルダの `/`、空白でつなぐ。`reference.ts` をモックなしで直接 import する | 12 |
| `src/test/unit/workspacePath.test.ts` | パス形式（単一・マルチルート・別の場所・入れ子・ワークスペース外）。コマンドを実行し、コピーされた参照で確かめる | 6 |
| `src/test/unit/commands.test.ts` | コマンド登録と dispose、`extension.ts` が activate / deactivate だけを出すこと、送信の分岐（成功・拡張なし・例外・reject）、エクスプローラー（単一・複数・空・引数なし・バイナリ混在・フォルダの貼り付け・貼り付け失敗・拡張なし・ファイルとフォルダの混在・コピーと警告を 1 回にまとめる・同じ理由を 1 回だけ書く）、失敗の経路（フォーカス後の貼り付け失敗・フォルダか調べられない・エディタで表示できない・シンボリックリンクのフォルダ）、開いたタブを閉じる（入れたあとで閉じる・もともと開いていたものは残す・コピーに回っても閉じる・閉じられなくても続ける・フォルダなどは触らない・エディタの右クリックでは閉じない） | 39 |
| `src/test/unit/manifest.test.ts` | package.json の基本項目と category、宣言とコード（`COMMANDS`）の一致、メニューの `when` 条件、制限モードの宣言、公式拡張にコマンドが存在するか | 17 |
| `src/test/integration/runTest.ts` | `@vscode/test-electron` でテスト用VS Codeを起動（他の拡張は無効） | — |
| `src/test/integration/suite/extension.itest.ts` | 実VS Code上でマルチルートのパス、選択の扱い、エクスプローラー送信、開いたタブを閉じる・もともと開いていたタブを残す・プレビューのタブを消さない、バイナリファイル、フォルダの判定、ファイルとフォルダの混在 | 18 |
| `src/test/fixtures/multi-root/` | 統合テスト用ワークスペース（同名の `app.js` を持つ alpha / beta、バイナリファイル） | — |

### 実行方法

```bash
npm install                 # 初回のみ（TypeScript とテスト用の依存を入れる）
npm test                    # コンパイル → ユニットテスト
npm run test:spec           # コンパイル → ユニットテスト（結果を一覧表示）
npm run test:integration    # コンパイル → 統合テスト（初回はテスト用VS Codeをダウンロード）
```

### ポイント

- **テストも TypeScript**: `src/test/` に置き、本体と一緒に `out/test/` にコンパイルする（公式の雛形と同じ形）。`reference.ts`・`constants.ts` は直接 import し、`extension.ts` はモックを差し込んでから読み込む（型だけは `typeof import('../../extension')` で使う）。テストのためだけの公開（以前の `_internal`）はない。
- **`npm test` の流れ**: `out/` を消してからコンパイルし（`npm run build`。消したファイルが `out/` に残って動き続けるのを防ぐ）、`node --test "out/test/unit/**/*.test.js"` で実行する。ファイルの探し方を Node に任せる（Node 21 以上の機能）。ユニットテストは Node 標準の `node:test`、統合テストは VS Code の中で `mocha` を使う。
- **公式拡張の更新を検知**: `manifest.test.ts` は `~/.vscode/extensions/anthropic.claude-code-*` の package.json を読み、呼んでいる `claude-vscode.insertAtMention` と `claude-vscode.focus` がまだ存在するかを確認する。公式拡張を更新した後に `npm test` を流せば、コマンド名の変更に気づける。見つからない環境ではスキップ（`CLAUDE_EXT_DIR` で場所を指定可能）。
- **統合テストは公式拡張なし**: テスト用VS Codeでは他の拡張を無効にするため、送信結果はクリップボードで確認する（フォールバック経路）。公式拡張のチャット欄に入るところは自動テストできないので、手動で確認する。
- **テストの効き目を確認済み**: わざとバグを入れて（行番号の0始まり、コマンドID誤り、例外の握りつぶし、選択リセット削除、複数選択の無視、フォルダ名の欠落、メニュー条件の欠落 など9種類）すべて検出できることを確認した。ファイルを分けたあとにも、8 種類（行番号の0始まり、行末まで選んだときの行、フォルダの判定、フォルダの貼り付け、参照のつなぎ方、公式コマンドの失敗の握りつぶし、エクスプローラーでの失敗の無視、選択のリセット）で同じことを確かめた。

