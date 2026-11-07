# Right Click Mention

右クリックメニューから、選択範囲やファイルを [Claude Code](https://www.anthropic.com/claude-code) の VS Code 拡張のチャットに `@src/app.ts#5-10` の形で送る、シンプルな VS Code 拡張です。

## できること

| 右クリックする場所 | メニュー | チャットに入る参照 |
| --- | --- | --- |
| エディタ（範囲を選択している） | Claudeに選択範囲を送る | `@src/app.ts#5-10` |
| エディタ（何も選択していない） | Claudeにこのファイルを送る | `@src/app.ts` |
| エクスプローラーのファイル | Claudeにファイル・フォルダを送る | `@src/app.ts` |
| エクスプローラーのファイル（複数選択） | Claudeにファイル・フォルダを送る | `@src/app.ts` `@src/util.ts` `@README.md`（選んだファイルごとに 1 つ） |
| エクスプローラーのフォルダ | Claudeにファイル・フォルダを送る | `@src/components/`（クリップボードにコピー。下の説明を参照） |

公式拡張のコマンド「Claude Code: Insert @-Mention Reference」（`Alt+K`）を右クリックから呼べるようにするだけの拡張です。参照の書き方やチャットへの入れ方は、公式拡張と同じになります。

次のものは、チャットに直接入れられないので、参照をクリップボードにコピーします。チャット欄に手で貼り付けてください。

- フォルダ（公式拡張のコマンドが、開いているファイルからしか参照を作れないため）
- 画像など、テキストとして開けないファイル
- 公式拡張が見つからないとき、送るのに失敗したとき

いくつか選んだときは、コピーする参照を `@src/ @docs/ @logo.png` のように空白でつなぎ、1 回でまとめてコピーします。警告も 1 回だけ出します。

## 必要なもの

- VS Code 1.94 以上
- 公式の Claude Code 拡張（`anthropic.claude-code`）
- Claude Code をパネルで使っていること。設定 `claudeCode.useTerminal` が `true`（ターミナル版）のときは、メニューを出しません。
- 信頼したワークスペースで使うこと。制限モード（信頼していないワークスペース）では動きません。

## インストール

Marketplace には出していません。VSIX ファイルからインストールします。

1. [Releases](https://github.com/kip2/right-click-mention/releases) から `right-click-mention-<バージョン>.vsix` をダウンロードする
2. VS Code の拡張機能ビューを開き、右上の「…」→「VSIX からのインストール…」でダウンロードしたファイルを選ぶ

コマンドで入れることもできます。

```bash
code --install-extension right-click-mention-<バージョン>.vsix
```

ダウンロードした VSIX が、このリポジトリの GitHub Actions で作られたものか確かめたいときは、[GitHub CLI](https://cli.github.com/) で次を実行します。

```bash
gh attestation verify right-click-mention-<バージョン>.vsix -R kip2/right-click-mention
```

## 注意

- 公式拡張のコマンド（`claude-vscode.insertAtMention`）を呼んでいるので、公式拡張の更新でコマンド名や動きが変わると、送れなくなることがあります（そのときはクリップボードへのコピーになります）。
- Claude のチャットを複数表示していると、すべてのチャットに参照が入ります。公式拡張の動きです。
- エクスプローラーから送ると、ファイルを 1 つずつエディタで開いてから送ります（公式拡張のコマンドが、開いているファイルからしか参照を作れないため）。最後のファイルが開いたまま残ります。

## 開発

TypeScript で書いています（ソースは `src/`、コンパイル結果は `out/`）。このフォルダを VS Code で開き、`F5` を押すと、コンパイルしてから拡張を読み込んだ VS Code が起動します。

```bash
npm install                 # 初回だけ
npm run compile             # TypeScript をコンパイルする（npm run watch なら保存のたびにコンパイル）
npm test                    # コンパイルしてからユニットテスト
npm run test:integration    # 本物の VS Code を使う統合テスト（初回はテスト用の VS Code をダウンロード）
npm run package             # VSIX ファイルを作る
```

### リリースの手順

1. `package.json` の `version` を上げてコミットし、main に push する
2. 同じ番号のタグを付けて push する

   ```bash
   git push origin main
   git tag v0.0.2
   git push origin v0.0.2
   ```

3. GitHub Actions（[.github/workflows/release.yml](.github/workflows/release.yml)）がテストをして VSIX を作り、Releases に添付する

タグと `version` が違うと、Actions は失敗します。同じタグのリリースが既にあるときは、VSIX だけを差し替えます。Actions の画面からブランチを選んで手動で実行すると、Releases は作らずに、VSIX だけを Actions の成果物（Artifacts）に置きます。

構成、処理の流れ、テストについては [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を見てください。

## ライセンス

[MIT](LICENSE)

Anthropic 公式ではなく、非公式の拡張です。
