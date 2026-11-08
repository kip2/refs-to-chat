# 手動テストの手順

自動テストにできない項目だけを、人が確かめます。
リリースの前に、上から順に進めてください。

## 準備

1. 初めてなら、先に `npm install` を実行する。そのあと、リポジトリのフォルダで VSIX を作り、VS Code に入れる

   ```bash
   npm run package
   code --install-extension refs-to-chat-<バージョン>.vsix
   ```

   同じバージョンのまま入れ直すと、変更が反映されないことがあります。
   そのときは、`package.json` の `version` を上げて作り直すか、VS Code を終了して `%APPDATA%\Code\CachedProfilesData\__default__profile__\extensions.user.cache` を消してください。

2. コマンドパレット（`Ctrl+Shift+P`）で「Developer: Reload Window」を実行する
3. 拡張機能ビューで、`Refs to Chat` が今回のバージョンになっていることを確かめる
4. 公式拡張（公式の Claude Code 拡張）が入っていて、ログインしていることを確かめる
5. 設定 `refsToChat.explorerClipboard` と `refsToChat.previewClipboard` が初期設定の `use`、`refsToChat.markdownPreview` が初期設定の `true` になっていることを確かめる

結果は表の「結果」の列に OK か NG で書きます。
NG のときは何が起きたかをメモし、「表示」→「出力」の「Claude VSCode」と、「Developer: Toggle Developer Tools」の「Console」も見てください。

## 人が確かめる項目

| 項目 | 手順 | 期待する結果 | 結果 |
| --- | --- | --- | --- |
| 無題のファイル | `Ctrl+N` で無題のファイルを作り、何か書く。コマンドパレットで「Refs to Chat: このファイルをClaudeのチャットに追加」を実行する | 無題のファイルの名前で、参照が入る | |
| 設定画面 | 設定画面（`Ctrl+,`）で「Refs to Chat」と検索する | 「Explorer Clipboard」と「Preview Clipboard」の設定があり、どちらも `use` と `keep` を選べる。「Markdown Preview」の設定があり、オン・オフを切り替えられる。それぞれに説明が出る | |
| もう一度貼る | 設定は `use` のまま。エクスプローラーでファイルを右クリックし、「Claudeのチャットに追加」を選ぶ。そのあと、チャットの入力欄で `Ctrl+V` を押す | `@ファイル` がもう一度入る | |
| 起動の直後 | 「Developer: Reload Window」の直後（チャットが起動しきる前）に、エディタとエクスプローラーから 1 回ずつ追加する（1 回ごとに Reload し直す） | 参照が入る。入らなくても、チャットの読み込みが終わってから試すと入る | |
| 制限モード | まだ信頼していないフォルダ（新しく作った空のフォルダなど）を開き、作成者を信頼するかで「いいえ」を選ぶ。ファイルを作り、エディタとエクスプローラーで右クリックする | 右クリックメニューに、この拡張の項目が出てこない | |

## Remote（WSL・SSH）

この拡張をリモート側に入れて、Remote でも動くことを確かめます。
始める前に、WSL 拡張と Remote - SSH 拡張を入れ、それぞれにつなげるようにしておいてください（WSL は Ubuntu 22.04 以降など、新しい Linux を使います）。
公式拡張もリモート側に入れます。この拡張は、はじめは手元の PC にだけ入れておき、表の上から順に進めます。

エクスプローラーのファイルは設定 `refsToChat.explorerClipboard`、Markdown のプレビューは設定 `refsToChat.previewClipboard` を、`use` と `keep` の両方で試します。終わったら `use` に戻してください。

| 項目 | 手順 | 期待する結果 | 結果 |
| --- | --- | --- | --- |
| 手元だけのとき | 「WSL: Connect to WSL」で WSL のフォルダを開く。拡張機能ビューを見て、エディタで右クリックする | `Refs to Chat` に、WSL 側に入れるボタンが出ている。右クリックメニューに、この拡張の項目が出ない | |
| 自動で入れる | 設定 `remote.defaultExtensionsIfInstalledLocally` に `kip2.refs-to-chat` を足し、WSL のウィンドウを開き直す | `Refs to Chat` が WSL 側に入る | |
| WSL | WSL のフォルダで、エディタと、エクスプローラーのファイル・フォルダから追加する | どれも入る。参照のパスは WSL 側のパスになる | |
| WSL のプレビュー | WSL のフォルダの md ファイルを開き、`Ctrl+K V` でプレビューを横に開く。文章を選んで右クリックし、「選択範囲をClaudeのチャットに追加」を選ぶ | メニューが出て、`@ファイル#行` が入る | |
| SSH | Remote - SSH で SSH 先のフォルダを開く。この拡張を SSH 側に入れ、WSL と同じこと（プレビューも）をする | どれも入る | |

## 終わったら

- すべて OK なら、[DEVELOPMENT.md](DEVELOPMENT.md) の「リリースの手順」に進む
- NG があれば、Issue にするか、直してからもう一度この手順を通す
