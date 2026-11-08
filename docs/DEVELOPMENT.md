# 開発

本体もテストも TypeScript で書いています（ソースは `src/`、テストは `src/test/`、コンパイル結果は `out/`）。Markdown のプレビューに読み込むスクリプトだけは JavaScript です（`media/`）。
Node.js 26 を使います（`.node-version` に書いてあります）。
このフォルダを VS Code で開いて `F5` を押すと、コンパイルしてから、拡張を読み込んだ VS Code が起動します。

構成や処理の流れは [ARCHITECTURE.md](ARCHITECTURE.md)、テストの考え方は [TEST_POLICY.md](TEST_POLICY.md) にあります。

## コマンド

```bash
npm install                 # 初回だけ
npm run compile             # TypeScript をコンパイルする（npm run watch なら保存のたびにコンパイル）
npm run lint                # Oxlint でコードを調べる（await 忘れなど）
npm test                    # コンパイルしてからユニットテスト
npm run test:integration    # 本物の VS Code を使う統合テスト（初回はテスト用の VS Code をダウンロード）
npm run test:e2e:setup      # E2E テストの準備（初回だけ。起動した VS Code で Claude にログインする）
npm run test:e2e            # 本物の公式拡張を使う E2E テスト（手元の PC だけ。チャットには送信しない）
npm run package             # VSIX ファイルを作る
```

- コードを変えたら、`npm run lint`、`npm test`、`npm run test:integration` を流します。CI で動くのは `npm run lint` と `npm test` だけです
- 統合テストと E2E テストはクリップボードの中身を書き換えます。流しているあいだは、コピーや貼り付けをしないでください

## リリースの手順

リリースの前に、次を確かめます。

- `npm run lint`、`npm test`、`npm run test:integration`、`npm run test:e2e` が通る
- [手動テストの手順](MANUAL_TEST.md) の項目

1. [CHANGELOG.md](../CHANGELOG.md) に、新しいバージョンの項目（`## [<バージョン>] - 日付`）を書く
2. `package.json` の `version` を上げ、作業ブランチでコミットする。PR を出して main に取り込む
3. main で、同じ番号のタグを付けて push する

   ```bash
   git switch main
   git pull
   git tag v<バージョン>
   git push origin v<バージョン>
   ```

4. GitHub Actions（[release.yml](../.github/workflows/release.yml)）がテストをして VSIX を作り、Releases に添付する。説明文は CHANGELOG.md のそのバージョンの項目から作る

タグと `version` が違うときや、CHANGELOG.md にそのバージョンの項目がないときは、Actions が失敗します。

VSIX には GitHub Actions で作ったことの証明が付きます。確かめるときは、[GitHub CLI](https://cli.github.com/) で次を実行します。

```bash
gh attestation verify refs-to-chat-<バージョン>.vsix -R kip2/refs-to-chat
```
