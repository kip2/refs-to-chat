# Right Click Mention

右クリックメニューから、選択範囲やファイルの参照を [Claude Code](https://www.anthropic.com/claude-code) の VS Code 拡張のチャットに入れる VS Code 拡張です。参照は `@src/app.ts#5-10` の形になります。

> Anthropic 公式ではない、個人の非公式拡張です。

## できること

| 右クリックする場所 | メニュー | チャットに入る参照 |
| --- | --- | --- |
| エディタ（範囲を選択している） | 選択範囲をClaudeのチャットに追加 | `@src/app.ts#5-10` |
| エディタ（何も選択していない） | このファイルをClaudeのチャットに追加 | `@src/app.ts` |
| エクスプローラーのファイル | Claudeのチャットに追加 | `@src/app.ts` |
| エクスプローラーのファイル（複数選択） | Claudeのチャットに追加 | `@src/app.ts` `@src/util.ts` `@README.md`（選んだファイルごとに 1 つ） |
| エクスプローラーのフォルダ | Claudeのチャットに追加 | `@src/components/`（貼り付けで入れる。下の説明を参照） |

公式の Claude Code 拡張のコマンド「Claude Code: Insert @-Mention Reference」（`Alt+K`）を右クリックから呼べるようにするだけの拡張です。参照の書き方やチャットへの入れ方は、公式拡張と同じになります。

チャットの入力欄に参照が入るだけで、メッセージは送信されません。続けて質問を書いてから送信してください。

エディタの 2 つは、コマンドパレット（`Ctrl+Shift+P`）からも「Right Click Mention: 選択範囲をClaudeのチャットに追加」のように呼べます。

### フォルダと、テキストで開けないファイル

公式拡張のコマンドは、開いているファイルからしか参照を作れません。そのため、フォルダと、画像などテキストとして開けないファイルは、次の手順でチャットに入れます。

1. 参照（`@src/components/` など）をクリップボードにコピーする
2. 公式拡張の「Claude Code: Focus input」で、チャットの入力欄にフォーカスを移す
3. 貼り付ける

クリップボードの中身は、この参照で上書きされます。チャットの入力欄に入っていなかったときは、チャットの入力欄で `Ctrl+V` を押してください。

### チャットに追加できなかったとき

公式拡張が見つからないときや、チャットに追加できなかったときは、参照をクリップボードにコピーして警告を出します。チャットの入力欄に手で貼り付けてください。

ファイル名に改行などの制御文字が入っているときも、自動では貼り付けず、クリップボードにコピーして警告を出します（フォーカスがチャットに移らなかったとき、エディタやターミナルに貼り付けてしまうおそれがあるためです）。

いくつか選んだときは、コピーする参照を `@src/ @docs/ @logo.png` のように空白でつなぎ、1 回でまとめてコピーします。通知や警告も 1 回だけ出します。

## 必要なもの

- VS Code 1.94 以上
- 公式の Claude Code 拡張（`anthropic.claude-code`）
- Claude Code をパネルで使っていること。設定 `claudeCode.useTerminal` が `true`（ターミナル版）のときは、メニューを出しません。
- 信頼したワークスペースで使うこと。制限モード（信頼していないワークスペース）では動きません。

Remote（WSL・SSH）での動作は確かめていません。

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

- 公式拡張のコマンド（`claude-vscode.insertAtMention`）を呼んでいるので、公式拡張の更新でコマンド名や動きが変わると、チャットに追加できなくなることがあります。そのときは、参照をクリップボードにコピーします。
- Claude のチャットを複数表示していると、すべてのチャットに参照が入ります。公式拡張の動きです。
- エクスプローラーから追加すると、ファイルを 1 つずつエディタで開いてからチャットに入れます（公式拡張のコマンドが、開いているファイルからしか参照を作れないため）。
  - いま使っているエディタグループにそのファイルのタブがなかったときは、この拡張が開いたタブを、チャットに入れたあとで閉じます。ほかのエディタグループでだけ開いていたファイルも、いま使っているグループに一度タブを開いて、あとで閉じます。
  - いま使っているエディタグループで、もともと開いていたファイルは、タブをそのまま残します。カーソルの位置や選択範囲も元に戻します。

## 開発

本体もテストも TypeScript で書いています（ソースは `src/`、テストは `src/test/`、コンパイル結果は `out/`）。Node.js 26 を使います（`.node-version` に書いてあります）。このフォルダを VS Code で開き、`F5` を押すと、コンパイルしてから拡張を読み込んだ VS Code が起動します。

```bash
npm install                 # 初回だけ
npm run compile             # TypeScript をコンパイルする（npm run watch なら保存のたびにコンパイル）
npm run lint                # Oxlint でコードを調べる（await 忘れなど）
npm test                    # コンパイルしてからユニットテスト
npm run test:integration    # 本物の VS Code を使う統合テスト（初回はテスト用の VS Code をダウンロード）
npm run package             # VSIX ファイルを作る
```

### リリースの手順

1. [CHANGELOG.md](CHANGELOG.md) に、新しいバージョンの項目（`## [0.0.6] - 日付`）を書く
2. `package.json` の `version` を上げてコミットし、main に push する
3. 同じ番号のタグを付けて push する

   ```bash
   git push origin main
   git tag v0.0.6
   git push origin v0.0.6
   ```

4. GitHub Actions（[.github/workflows/release.yml](.github/workflows/release.yml)）がテストをして VSIX を作り、Releases に添付する。リリースの説明文は、CHANGELOG.md のそのバージョンの項目から作る

タグと `version` が違うときや、CHANGELOG.md にそのバージョンの項目がないときは、Actions は失敗します。同じタグのリリースが既にあるときは、VSIX と説明文を差し替えます。Actions の画面からブランチを選んで手動で実行すると、Releases は作らずに、VSIX だけを Actions の成果物（Artifacts）に置きます。

構成、処理の流れ、テストについては [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を見てください。

## 変更履歴

[CHANGELOG.md](CHANGELOG.md) を見てください。

## ライセンス

[MIT](LICENSE)
