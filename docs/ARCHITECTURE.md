# Refs to Chat のアーキテクチャ

右クリックメニューから、公式の Claude Code 拡張（以下「公式拡張」）のコマンドを呼び、参照をチャットに入れる小さな拡張。
公式のコマンドで扱えないもの（フォルダなど）は、参照をチャットの入力欄に貼り付けて入れる。
自前で Claude と通信はしない。右クリックのメニューを足し、参照を作ってチャットに入れる処理は、できるだけ公式拡張に任せる。

- 対象: VS Code 1.94 以上、公式拡張 `anthropic.claude-code` の Claude パネル版（`claudeCode.useTerminal` が true のときはメニューを出さない）
- 言語: TypeScript（本体もテストも `src/` に置き、`tsc` で `out/` にコンパイル）

開発のコマンドとリリースの手順は [DEVELOPMENT.md](DEVELOPMENT.md)、テストの考え方は [TEST_POLICY.md](TEST_POLICY.md) にある。

---

## 1. 全体構成

```mermaid
flowchart LR
  subgraph Menus["右クリックメニュー（package.json で宣言）"]
    M1["エディタ: 選択あり / なし"]
    M3["エクスプローラー: ファイル・フォルダ"]
  end
  subgraph Ext["この拡張（src/）"]
    SAE["commands.ts<br/>addActiveEditorToChat()"]
    SF["commands.ts<br/>addExplorerItemsToChat()"]
    STC["claudeChat.ts<br/>insertMentionFor()"]
    DL["delivery.ts<br/>deliverPendingReferences()"]
  end
  subgraph Claude["公式拡張"]
    C1["claude-vscode.insertAtMention"]
    C2["claude-vscode.focus"]
    P["チャットの入力欄"]
  end
  CB[("クリップボード")]

  M1 --> SAE --> STC
  M3 --> SF
  SF -->|設定 keep のファイル| STC
  STC --> C2
  STC --> C1 --> P
  SF -->|フォルダ・開けないファイル<br/>設定 use のファイル| DL
  SAE -.->|入れられなかった| DL
  DL -->|コピーしてから貼り付け| C2
  DL -->|貼り付け| P
  DL -.->|入れられないときはコピー + 警告| CB
```

参照をチャットに入れる方法は 2 つある。

- 公式コマンドで入れる。エディタからの追加と、設定 `keep` のときのエクスプローラーのファイル。参照を作るのは公式拡張で、この拡張はコマンドを呼ぶだけ（→ 5-3）
- 貼り付けで入れる。フォルダ、テキストとして開けないファイル、設定 `use`（初期設定）のときのエクスプローラーのファイル。参照をクリップボードにコピーし、チャットの入力欄にフォーカスしてから、VS Code 標準の貼り付けを呼ぶ（→ 5-4）

どちらでも入れられないときは、参照をクリップボードにコピーして警告を出す（→ 5-5）。
なぜこの作りにしたかは 7 章にある。

---

## 2. ファイル構成

| ファイル | 役割 |
|---|---|
| `package.json` | 拡張のマニフェスト。コマンド、右クリックメニュー、設定を宣言する（→ 3 章） |
| `src/` | 本体（→ 4 章）。`src/test/` はテスト（→ 10 章） |
| `out/` | `src/` のコンパイル結果。git には入れない |
| `README.md`・`CHANGELOG.md` | 使い方と変更履歴。リリースの説明文は CHANGELOG から作る |
| `docs/` | このファイル、開発の手順（DEVELOPMENT）、テスト方針（TEST_POLICY）、手動テストの手順（MANUAL_TEST） |
| `.github/workflows/` | `ci.yml`（PR と main への push で確かめる）、`release.yml`（タグの push でリリースする）（→ 9 章） |
| `.vscodeignore` | VSIX に入れないもの。VSIX に入るのは `out/*.js`・`package.json`・README・CHANGELOG・LICENSE だけ |

ほかに、`tsconfig.json`（TypeScript 7、`strict`）、`.oxlintrc.json`（リンター）、`.node-version`（Node 26）、`.vscode/`（`F5` の設定）、`.github/dependabot.yml` がある。

---

## 3. package.json（宣言）

- メニュー項目と表示条件は、`contributes.menus` だけで決まる（コードは書いていない）
- エディタの右クリックは、選択の有無で「選択範囲を…」と「このファイルを…」のどちらか片方だけを出す（`editorHasSelection`）
- すべての `when` に `!config.claudeCode.useTerminal` を付けている。ターミナル版の設定では出さない（公式拡張と同じ条件）
- エディタの 2 つのコマンドは、テキストのファイルが前面にあるときだけコマンドパレットに出す（`editorLangId`）。`editorIsOpen` だと、チャットをエディタのタブで開いているだけで出てしまうため
- `sendFile` はエクスプローラーで選んだ URI を受け取る前提なので、コマンドパレットには出さない
- `capabilities.untrustedWorkspaces.supported: false` で、制限モードでは動かさない
- `extensionKind: ["workspace", "ui"]` で、Remote ではリモート側でも手元の PC 側でも動けると宣言している（→ 8 章）
- `activationEvents` は書いていない（VS Code 1.74 以降は、コマンドを実行したときに自動で有効になる）

---

## 4. src/ の構成

状態を持たない処理を順に呼ぶだけなので、クラスは使わず関数で書いている。

```mermaid
flowchart TD
  EXT["extension.ts<br/>コマンドの登録"] --> CMD["commands.ts<br/>2 つのコマンドの処理"]
  CMD --> CFG["config.ts<br/>設定を読む"]
  CMD --> CHAT["claudeChat.ts<br/>公式拡張とのやり取り"]
  CMD --> DL["delivery.ts<br/>貼り付け・コピー"]
  CMD --> WS["workspace.ts<br/>パス・フォルダ判定<br/>ファイルを開く・タブを閉じる"]
  CMD --> REF["reference.ts<br/>参照の文字列"]
  DL --> CHAT
  DL --> REF
  DL --> MSG["messages.ts<br/>画面に出す文"]
```

| ファイル | 役目 |
|---|---|
| `extension.ts` | 3 つのコマンドを登録する（`sendSelection` と `sendCurrentFile` は同じ処理） |
| `commands.ts` | 右クリックされたときの処理。何をどの方法で入れるかを振り分ける（→ 5-1・5-2） |
| `claudeChat.ts` | 公式拡張とのやり取り。公式コマンドで入れる（→ 5-3）、チャットに貼り付ける（→ 5-4） |
| `delivery.ts` | 後回しにした参照を、貼り付けかコピーで届ける（→ 5-5）。貼り付けるかコピーするかは、ここだけで決める |
| `workspace.ts` | 公式と同じ形式のパス、フォルダの判定、ファイルを開く・タブを閉じる |
| `reference.ts` | 参照の文字列を作る（→ 6 章） |
| `config.ts` | 設定 `refsToChat.explorerClipboard` を読む。知らない値は `use` として扱う |
| `constants.ts` | コマンド ID、公式拡張の ID とコマンド、待ち時間（`FOCUS_WAIT_MS` 800ms、`PASTE_CHECK_MS` 150ms）、設定の名前 |
| `messages.ts` | 画面に出す文。テストも同じ定数と比べるので、文を変えてもテストを直さなくてよい |

`constants.ts`・`messages.ts`・`reference.ts` は vscode に依存しないので、テストからモックなしで読み込める。
関数ごとのくわしい決まりは、コードのコメントに書いている。

### 名前の付け方と、機能を足すときの置き場所

| 動詞 | 意味 | 例 |
| --- | --- | --- |
| add | この拡張のコマンド（ユーザーから見た「チャットに追加」） | `addExplorerItemsToChat` |
| insert | 公式コマンドでチャットに入れる | `insertMentionFor` |
| paste | クリップボードからチャットに貼り付ける | `pasteClipboardIntoChat` |
| deliver | 後回しにした参照を、まとめて貼り付けかコピーで届ける | `deliverPendingReferences` |

`COMMANDS` のキーが `sendXxx` なのは、公開済みのコマンド ID（`refsToChat.sendSelection` など）に合わせているため。

- 新しい右クリックメニュー → `package.json` に宣言、`constants.ts` に ID、`commands.ts` に処理、`extension.ts` で登録
- 公式拡張の別のコマンドを使う → `constants.ts` の `CLAUDE` と `claudeChat.ts`
- 参照の形式 → `reference.ts`
- 画面に出す文 → `messages.ts`
- 貼り付けるかコピーするかの条件 → `delivery.ts` の `deliverPendingReferences`
- 設定を足す → `package.json` の `contributes.configuration`、`constants.ts` の `SETTINGS`、`config.ts`
- ファイルを開いて入れる流れ → `commands.ts` の `addFileByOpening` と `workspace.ts` の `openForMention`

---

## 5. 処理の流れ

### 5-1. エディタの右クリック（`addActiveEditorToChat`）

```text
前面にエディタがない → 通知「開いているファイルがありません」で終わり
それ以外 → 5-3 で公式コマンドで入れる
  └─ 入れられなかった → 参照を自分で作り、5-5 の届ける処理へ
```

### 5-2. エクスプローラーの右クリック（`addExplorerItemsToChat`）

```text
何も選ばれていない → 通知「追加するファイルやフォルダがありません」で終わり
それ以外 → 設定（use / keep）を 1 回だけ読み、今のエディタグループを覚えてから、1 つずつ振り分ける
  ├─ フォルダ                → 後回し（folder）
  ├─ ファイル・設定 use（初期） → 後回し（pasteFile）
  └─ ファイル・設定 keep        → ファイルを一瞬開く
         ├─ 開けない（画像など）→ 後回し（notText）
         └─ 開けた → 5-3 で入れる → 開いたタブを閉じる／選択範囲を戻す
                ├─ 入れられた → 済み
                └─ 入れられなかった → 後回し（notInstalled / failed）
最後に、後回しの分をまとめて 5-5 の届ける処理へ
```

設定 `keep` でファイルを一度開くのは、公式コマンドが「アクティブなエディタ」からしか参照を作れないため。開いたタブは次のように扱う。

- 開くのは、最初に覚えておいたエディタグループ。チャットを開くとチャットのグループがアクティブになることがあり、2 つ目以降のファイルがそちらに開いてしまうため
- そのグループにもともとタブがなければ、入れたあとで閉じる。あれば残し、カーソルの位置や選択範囲も元に戻す
- タブがあるかは、ドキュメント自身の URI で調べる（Windows でパスの大文字・小文字が違っても正しく判定できる）
- プレビュー（斜体のタブ）では開かない。ユーザーがプレビューで開いていた別のファイルのタブを、置き換えて消してしまうため
- 公式コマンドを呼ぶ直前に、選択を今のカーソル位置の空の選択にする（選択範囲が参照に入らないように）

### 5-3. 公式コマンドで入れる（`insertMentionFor`）

```text
公式拡張がある見込みは？（手元にある、またはリモートにつないでいる。mayHaveClaude）
  ├─ ない → 理由「notInstalled」
  └─ ある
       ① チャットを開く（claude-vscode.focus。失敗しても続ける）
       ② 元のエディタを前面に戻す（選択範囲はそのまま。前面ならしない）
       ③ 公式コマンド（claude-vscode.insertAtMention）を呼ぶ
            ├─ 成功 → 完了（通知なし、クリップボードは変えない）
            └─ 失敗 → 公式コマンドがどこかに登録されている？（isClaudeMissing）
                     ├─ いない → 理由「notInstalled」
                     └─ いる   → 理由「failed」
```

### 5-4. 貼り付け処理（`pasteClipboardIntoChat`）

```text
0. ファイルの変更を見張り始める
1. クリップボードに「参照 + 空白」を書く（delivery.ts の pasteIntoChat）
2. チャットにフォーカスを移す（claude-vscode.focus）── 失敗 →「貼り付けられなかった」
3. 800ms 待つ（FOCUS_WAIT_MS）
4. 標準の貼り付け（フォーカスがある場所に入る）── 失敗 →「貼り付けられなかった」
5. 150ms 待つ（PASTE_CHECK_MS）
6. そのあいだに、どこかのファイルに同じ文字が入った？
     ├─ いいえ →「貼り付けた」とみなす（本当にチャットに入ったかは分からない）
     └─ はい → 次の 3 つをすべて満たす？
              ・文字が入ったのは 1 つのファイルだけ
              ・そのファイルが、前面のエディタのもの
              ・入ったあと、そのファイルがほかに変わっていない（版が入った直後のまま）
                ├─ 満たす → undo で取り消し、150ms 待つ
                │            ├─ 版が進んだ（取り消せた）→「貼り付けられなかった」
                │            └─ 進まない              →「ファイルに残った」
                └─ 満たさない → 取り消さない →「ファイルに残った」
```

4 の貼り付けは、その瞬間にキーボードのフォーカスがある場所に入る。
2 でフォーカスがチャットに移りきらないと、前に使っていたエディタに参照の文字が書き込まれる。6 はそれを取り消すためのもの。
`undo` は場所を指定できず、条件を満たさないときに使うとユーザーの操作を取り消してしまうので、使わずに警告で知らせる。

### 5-5. 届ける処理（`deliverPendingReferences`）

```text
① 名前に改行などの特別な文字があるもの → 取り除き、警告「…N 件あったので、追加もコピーもしませんでした」
   （残りがなければ、ここで終わり）
② 公式拡張がある見込みがない → まとめてコピー + 警告「見つからないか、動いていません」
③ notInstalled / failed が 1 つでもある → まとめてコピー + 警告（その理由）
④ 残りが貼り付けで入れるもの（folder / notText / pasteFile）だけ → 5-4 の貼り付け処理
     ├─ 貼り付けた → 完了（通知なし。クリップボードには「参照 + 空白」が残る）
     ├─ 貼り付けられなかった → まとめてコピー + 警告
     │    （公式拡張がどこにもなければ「見つからないか…」、あれば「貼り付けられませんでした」）
     └─ ファイルに残った → まとめてコピー + 警告「…開いているファイルに入ったかもしれません（Ctrl+Z で戻してください）」
```

「まとめてコピー」は、参照を空白でつないで 1 回だけコピーし、警告も 1 回だけ出す（末尾に空白は付けない）。

### 5-6. ケースごとの結果

| # | ケース | チャット | クリップボード | 表示 |
| --- | --- | --- | --- | --- |
| 1 | エディタから（正常） | 入る | 変えない | なし |
| 2 | エクスプローラーのファイル・設定 use（正常） | 入る | 参照 + 空白 | なし |
| 3 | エクスプローラーのファイル・設定 keep（正常） | 入る | 変えない | なし |
| 4 | フォルダ・画像など（正常） | 入る | 参照 + 空白 | なし |
| 5 | 公式拡張がない（手元） | 入らない | 参照 | 警告「見つからないか、動いていません」 |
| 6 | 公式拡張がない（リモート） | 入らない（呼んでみて失敗） | 参照 | 警告「見つからないか、動いていません」 |
| 7 | 公式コマンドが失敗 | 入らない | 参照 | 警告「追加できませんでした」 |
| 8 | チャットにフォーカスを移せない | 入らない | 参照 | 警告「貼り付けられませんでした」 |
| 9 | フォーカスが移らず、前面のエディタに入った | 入らない（取り消す） | 参照 | 警告「貼り付けられませんでした」 |
| 9-2 | 9 で、取り消しの条件を満たさない（ほかのファイルに入った、入ったあとに変わった、など） | 入らない（ファイルに文字が残る） | 参照 | 警告「…ファイルに入ったかもしれません（Ctrl+Z で戻してください）」 |
| 10 | ログインの画面が出ているなど | 入らない（見分けられない） | 参照 + 空白 | なし |
| 11 | フォーカスが移らず、ターミナルに入った | 入らない（見分けられない。改行は入らない） | 参照 + 空白 | なし |
| 12 | 名前に改行などの特別な文字 | 入らない | 変えない | 警告「…N 件…追加もコピーもしませんでした」 |
| 13 | 一部だけ失敗（keep でファイルは失敗、フォルダもある） | 成功した分だけ入る | 残りをまとめて | 警告 1 回 |
| 14 | チャットの起動に 15 秒以上かかる | 入らないことがある（公式拡張があきらめる） | 変えない | なし |

10・11・14 は見分ける方法がないので、README に書いている。

---

## 6. 参照文字列の形式

この拡張が自分で参照を作るのは、貼り付けやコピーをするときだけ。公式拡張のコマンドで入れた文字列と比べ、同じ形式にしている。

| 状況 | 例 |
|---|---|
| 選択なし | `@src/app.ts` |
| 1 行 | `@src/app.ts#8` |
| 複数行 | `@src/app.ts#5-10` |
| マルチルート | `@beta/src/app.ts`（先頭にフォルダ名） |
| ワークスペース外 | 絶対パス |
| フォルダ | `@src/components/`（末尾に `/`） |
| 複数 | `@src/ @docs/ @logo.png`（空白でつなぐ） |

公式との違いが 1 つある。次の行の先頭で選択が終わっているとき、この拡張はその行を範囲に含めない（公式は含める）。

---

## 7. 設計上の判断

- 公式コマンドに任せる。参照の形式やチャットへの入れ方が公式と一致し、コードも短い。そのかわり、公式拡張の更新でコマンド名が変わると動かなくなる。そのときは `constants.ts` の `CLAUDE` を書き換える
- 先にチャットを開く。チャットが閉じていると、公式コマンドは起動を 15 秒待って、参照を入れずに諦める（失敗も返さない）。そこで、先に `claude-vscode.focus` で開く。チャットが開いているかを調べる API はないので、毎回開く
- 元のエディタを前面に戻す。チャットをエディタのタブで開いていると、フォーカスが移って「アクティブなエディタ」がなくなる。そこで、元のエディタを `showTextDocument` で前面に戻してから公式コマンドを呼ぶ。まだ前面にあるときは何もしない（左右に分けたエディタで、余計なタブを作らないため）
- フォルダなどは貼り付けで入れる。公式コマンドはファイルしか扱えないので、公開されている `claude-vscode.focus` と VS Code 標準の貼り付けを組み合わせる。欠点は、クリップボードを上書きすることと、本当に入ったかを確かめられないこと。そのため、貼り付けたときは通知を出さない
- `use` と `keep` を選べる。エクスプローラーのファイルは、初期設定では開かずに貼り付ける。`keep` はタブが一瞬ちらつき、`use` はクリップボードを上書きする。どちらを取るかを選べるようにした
- 貼り付ける前に 800ms 待つ。短いと、フォーカスがチャットに移りきる前の場所（エディタなど）に貼り付けてしまう。待たされても気にならない 1 秒未満で、なるべく長くした
- ファイルに貼り付けてしまったら、条件付きで取り消す。条件と流れは 5-4。ターミナルに入ったときは見分けられない
- 改行などを含む参照は、どこにも入れない。ファイル名に制御文字・見えない書式文字・行区切り（`\p{Cc}` `\p{Cf}` `\p{Zl}` `\p{Zp}`）があると、貼り付けもコピーもせず、件数だけ警告する。エディタやターミナルに入ると改行でコマンドとして動きかねず、文字の向きを変える文字で通知の表示を偽装されることもあるため
- 失敗しても無駄にしない。チャットに入れられないときは、クリップボードにコピーして、手で貼れるようにする
- `@types/node` は Node 20 に固定する。VS Code 1.94〜1.100 の拡張ホストは Node 20 で動く。本体が Node 20 にない API を使わないよう、型を合わせている

---

## 8. 既知の制約（実験で分かったこと）

| 項目 | 内容 | この拡張で対処できるか |
|---|---|---|
| 送り先 | 表示中の Claude のチャットが複数あると、すべてに入る | できない（公式の動作） |
| ターミナル版 | 対象外。`useTerminal` が true のときはメニューを出さない | 対象外（意図的） |
| 同じ名前のフォルダ | マルチルートで同名フォルダがあると、参照が区別できない | `.code-workspace` の `"name"` で回避 |
| 設定のスコープ | `claudeCode.*` は window / application / machine スコープ。マルチルートのフォルダの settings.json に書いても効かない | できない（VS Code の仕様） |
| リモート（WSL・SSH・Dev Containers） | 手元の PC にだけ入れると、この拡張は手元で、公式拡張はリモート側で動く。このとき `getExtension` では公式拡張が見えないので、見えなくても公式コマンドを呼んでみる（5-3）。この拡張がリモート側にも入っていると、リモート側のものが動く | 呼んでみて判断する（WSL・SSH で確認済み。Dev Containers は未確認） |
| チャットが起動しきっていない | 公式拡張は 15 秒待っても起動しないと、参照を入れずに諦める。失敗を返さないので、この拡張からは分からない | できない（README に書いている） |
| コマンドパレットの表示 | フォーカスがエクスプローラーやターミナルにあると、ファイルを開いていてもパレットに出ない | 仕様として受け入れる |
| Dependabot の待ち期間 | `cooldown` は依存ごとに数えるので、TypeScript と `oxlint-tsgolint` が別々の PR で届き、CI が落ちることがある | 次の更新を待つか、手でそろえる |

---

## 9. 開発・ビルド

コマンドとリリースの手順は [DEVELOPMENT.md](DEVELOPMENT.md) にある。ここでは、しくみと理由だけを書く。

### GitHub Actions

- `ci.yml`: PR と main への push で、`npm ci`・リンター・ユニットテスト・VSIX 作成を確かめる。Dependabot の PR も、取り込む前に確かめられる
- `release.yml`: `v*` のタグを push すると動く
  - `package` ジョブ（読み取り権限のみ）: リンター・テスト・VSIX 作成
  - `release` ジョブ（書き込み権限あり、依存は入れない）: VSIX を Releases に添付し、出どころの証明（`actions/attest-build-provenance`）を付ける
  - 説明文は `CHANGELOG.md` の該当バージョンの項目から作る。項目がなければ失敗する。同じタグのリリースがあれば差し替える
  - 手動実行では Releases を作らず、VSIX を Actions の成果物に置くだけ

### リンター（Oxlint、`.oxlintrc.json`）

- TypeScript 7 に対応しているので Oxlint を使う。型情報を使うルールは `oxlint-tsgolint` が担当する（typescript-eslint は TypeScript 7 に対応していない）。TypeScript を上げるときは、`oxlint-tsgolint` も一緒に上げる
- ルールは、`correctness` の一式と、`typescript/no-floating-promises`（`await` 忘れ）、`typescript/no-misused-promises` だけにして、増やしすぎない
- `no-floating-promises` には `checkThenables: true` を付けている。VS Code の API は `Thenable` を返すので、付けないと見逃す。わざと待たない通知には `void` を付ける

### 安全のための設定

- 依存パッケージのインストールスクリプトは動かさない（`npm ci --ignore-scripts`）。外部の Action はコミットの SHA で固定する
- Dependabot は、新しいバージョンが出てから 7 日たってから提案する。`@types/vscode` は `engines.vscode` に合わせて手で上げる

---

## 10. テスト

テストの種類と、どれをいつ流すかは [TEST_POLICY.md](TEST_POLICY.md) にある。

```mermaid
flowchart LR
  subgraph Unit["ユニット（npm test）"]
    M["helpers/vscodeMock.ts<br/>VS Code API のモック"]
    U["reference / workspacePath /<br/>commands / manifest"]
    M --> U
  end
  subgraph Int["統合（npm run test:integration）"]
    I["suite/extension.itest.ts<br/>公式拡張なし"]
    F["fakeClaude/claude.itest.ts<br/>偽の公式拡張あり"]
  end
  subgraph E2E["E2E（npm run test:e2e）"]
    E["chat.e2e.ts<br/>本物の公式拡張"]
  end
  U --> EXT["out/extension.js"]
  I & F --> EXT
  E -->|VSIX| EXT
```

| 場所 | 内容 |
|---|---|
| `src/test/unit/` | ユニットテスト。`commands.test.ts` が中心で、細かい項目はテストの名前を見る。`manifest.test.ts` は package.json の宣言と、手元の公式拡張にコマンドがまだあるかを確かめる |
| `src/test/helpers/vscodeMock.ts` | VS Code API のモック。`setup()` で、モックと拡張と activate を一度に用意する |
| `src/test/integration/` | 統合テスト。公式拡張なし（`suite/`）と、偽の公式拡張あり（`fakeClaude/`）の 2 回に分けて動かす |
| `src/test/fixtures/fake-claude-code/` | 偽の公式拡張。公開コマンドの `insertAtMention` と `focus` だけを用意し、呼ばれた瞬間の状態を記録する。チャットのかわりに、入力欄だけの Webview を開く |
| `src/test/fixtures/multi-root/` | 統合テストと E2E 用のワークスペース（同名の `app.js` を持つ alpha / beta、バイナリファイル） |
| `src/test/e2e/` | E2E テスト。Playwright（`playwright-core` の `_electron`）で本物の VS Code を動かす。画面の部品の探し方は `selectors.ts` にまとめる |

### ポイント

- `npm test` は `out/` を消してからコンパイルし、`node --test` で動かす。統合テストは VS Code の中で `mocha` を使う
- 公式拡張を更新したら `npm test` を流す。`manifest.test.ts` が、呼んでいるコマンドがまだあるかを確かめる（`CLAUDE_EXT_DIR` で場所を指定できる）
- 偽の公式拡張のチャットは、本物と同じく Webview にしている。テキストのエディタにすると、テスト用のウィンドウにフォーカスがないとき、アクティブなエディタの情報が古いまま残り、結果が毎回変わったため
- テストが偶然通っていないかを、わざとバグを入れて確かめている（行番号のずれ、前面に戻す処理を消す、取り消しの条件を外す、など）

### E2E テストで守ること

本物のアカウントで動くので、次を守る。


- Enter を押さない。送信しない。候補はクリックで選ぶ。念のため、Enter だけでは送信しない設定（`claudeCode.useCtrlEnterToSend`）も入れる
- 入力欄に入ったことを確かめたら、毎回空にする。空にするのは Webview の中だけで行う（キー操作で消すと、フォーカスがエディタにあったときにファイルの中身を消してしまう。実際に起きた）
- テスト用のファイルは読み取り専用で開き、始める前と終わったあとに git の状態を確かめる。公式拡張が読む設定（`.claude/`、`.mcp.json`、`CLAUDE.md` など）が紛れ込んでいたら止める
- 普段の VS Code とは別のフォルダ（`.vscode-test/e2e/`）を使う。VS Code の版は、画面を調べた 1.145.2 に固定する（`VSCODE_TEST_VERSION` で変えられる）
- 公式拡張の画面の部品は、実際の画面を開いて調べてから使う。チャットの入力欄は `[role="textbox"][aria-label="Message input"]`。ビルドごとに変わるクラス名は使わない
- 公式拡張のチャットがフォーカスを取り返すことがあるので、コマンドパレットや右クリックメニューが閉じたら、フォーカスを戻して開き直す
