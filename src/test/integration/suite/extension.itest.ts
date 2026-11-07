// 実際の VS Code 上で動かすテスト
// ワークスペース: src/test/fixtures/multi-root（alpha / beta の 2 フォルダ）
// 公式拡張は無効なので、結果はクリップボードの中身で確かめる

import * as assert from 'node:assert';
import * as vscode from 'vscode';

const EXT_ID = 'kip2.right-click-mention';
const IDS = ['rightClickMention.sendSelection', 'rightClickMention.sendCurrentFile', 'rightClickMention.sendFile'];

const folders = () => vscode.workspace.workspaceFolders ?? [];

function fileIn(folderName: string, rel: string): vscode.Uri {
  const folder = folders().find((f) => f.name === folderName);
  assert.ok(folder, `ワークスペースに ${folderName} がない`);
  return vscode.Uri.joinPath(folder.uri, ...rel.split('/'));
}

async function openWithSelection(uri: vscode.Uri, sl: number, sc: number, el: number, ec: number) {
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  editor.selection = new vscode.Selection(sl, sc, el, ec);
  return editor;
}

const clipboard = () => vscode.env.clipboard.readText();

/** エクスプローラーのファイルの入れ方を設定する（undefined で初期設定に戻す） */
async function setExplorerFiles(value: 'paste' | 'open' | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration('rightClickMention')
    .update('explorerFiles', value, vscode.ConfigurationTarget.Global);
}

/** そのファイルのタブがどこかに開いているか */
function hasTab(uri: vscode.Uri): boolean {
  return vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .some((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === uri.toString());
}

describe('Right Click Mention（実VS Code・マルチルート）', function () {
  before(async function () {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `${EXT_ID} が読み込まれていない`);
    await ext.activate();
    // テスト用の VS Code の設定は実行をまたいで残るので、前の実行が途中で止まっていても初期設定から始める
    await setExplorerFiles(undefined);
    const setting = vscode.workspace.getConfiguration('rightClickMention').inspect('explorerFiles');
    assert.strictEqual(setting?.globalValue, undefined);
  });

  beforeEach(async function () {
    await vscode.env.clipboard.writeText('');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  describe('前提条件', function () {
    it('ワークスペースが alpha / beta の 2 フォルダ', function () {
      assert.deepStrictEqual(folders().map((f) => f.name), ['alpha', 'beta']);
    });

    it('公式拡張は無効（フォールバック経路をテストするため）', function () {
      assert.strictEqual(vscode.extensions.getExtension('anthropic.claude-code'), undefined);
    });

    it('3つのコマンドが登録されている', async function () {
      const all = await vscode.commands.getCommands(true);
      for (const id of IDS) assert.ok(all.includes(id), id);
    });
  });

  describe('エディタからの送信', function () {
    it('alpha の複数行 → @alpha/src/app.js#2-4', async function () {
      await openWithSelection(fileIn('alpha', 'src/app.js'), 1, 0, 3, 5);
      await vscode.commands.executeCommand('rightClickMention.sendSelection');
      assert.strictEqual(await clipboard(), '@alpha/src/app.js#2-4');
    });

    it('同名の beta のファイル → @beta/src/app.js#2-4（取り違えない）', async function () {
      await openWithSelection(fileIn('beta', 'src/app.js'), 1, 0, 3, 5);
      await vscode.commands.executeCommand('rightClickMention.sendSelection');
      assert.strictEqual(await clipboard(), '@beta/src/app.js#2-4');
    });

    it('1行の一部 → #行', async function () {
      await openWithSelection(fileIn('alpha', 'src/app.js'), 2, 2, 2, 8);
      await vscode.commands.executeCommand('rightClickMention.sendSelection');
      assert.strictEqual(await clipboard(), '@alpha/src/app.js#3');
    });

    it('次行の先頭で終わる選択は最終行を含めない', async function () {
      await openWithSelection(fileIn('alpha', 'src/app.js'), 1, 0, 3, 0);
      await vscode.commands.executeCommand('rightClickMention.sendSelection');
      assert.strictEqual(await clipboard(), '@alpha/src/app.js#2-3');
    });

    it('下から上への選択でも同じ', async function () {
      await openWithSelection(fileIn('alpha', 'src/app.js'), 3, 5, 1, 0);
      await vscode.commands.executeCommand('rightClickMention.sendSelection');
      assert.strictEqual(await clipboard(), '@alpha/src/app.js#2-4');
    });

    it('選択なし → ファイルの参照', async function () {
      await openWithSelection(fileIn('beta', 'src/app.js'), 0, 0, 0, 0);
      await vscode.commands.executeCommand('rightClickMention.sendCurrentFile');
      assert.strictEqual(await clipboard(), '@beta/src/app.js');
    });

    it('エディタが開いていない → 何もコピーしない', async function () {
      await vscode.commands.executeCommand('rightClickMention.sendSelection');
      assert.strictEqual(await clipboard(), '');
    });
  });

  describe('エクスプローラーからの送信（ファイルを開く設定: open）', function () {
    before(async function () {
      await setExplorerFiles('open');
    });
    after(async function () {
      await setExplorerFiles(undefined);
    });

    it('1ファイル → 開いて選択なしで送り、開いたタブは閉じる', async function () {
      const uri = fileIn('beta', 'src/only-in-beta.js');
      await vscode.commands.executeCommand('rightClickMention.sendFile', uri, [uri]);
      assert.strictEqual(await clipboard(), '@beta/src/only-in-beta.js');
      assert.strictEqual(hasTab(uri), false);
    });

    it('もともと開いていたファイルは、送ったあともタブが残る', async function () {
      const uri = fileIn('alpha', 'src/app.js');
      await openWithSelection(uri, 0, 0, 0, 0);
      await vscode.commands.executeCommand('rightClickMention.sendFile', uri, [uri]);
      assert.strictEqual(await clipboard(), '@alpha/src/app.js');
      assert.strictEqual(hasTab(uri), true);
    });

    it('もともと開いていたファイルは、選択範囲を消さずに送り、あとで元に戻す', async function () {
      const uri = fileIn('alpha', 'src/app.js');
      const editor = await openWithSelection(uri, 1, 0, 2, 3);
      // 行の長さに合わせて VS Code が詰めることがあるので、送る前の選択を覚えておく
      const before = editor.selection;
      assert.ok(!before.isEmpty);
      await vscode.commands.executeCommand('rightClickMention.sendFile', uri, [uri]);
      // 選択範囲があっても、エクスプローラーからはファイル全体の参照になる
      assert.strictEqual(await clipboard(), '@alpha/src/app.js');
      assert.ok(editor.selection.isEqual(before));
    });

    it('プレビューで開いていた別のファイルのタブを消さない', async function () {
      const other = fileIn('beta', 'src/app.js');
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(other), { preview: true });
      const uri = fileIn('alpha', 'src/app.js');
      await vscode.commands.executeCommand('rightClickMention.sendFile', uri, [uri]);
      assert.strictEqual(hasTab(other), true);
      assert.strictEqual(hasTab(uri), false);
    });

    it('前回の選択が残っているファイルでも、選択なしで送る', async function () {
      const uri = fileIn('alpha', 'src/app.js');
      await openWithSelection(uri, 1, 0, 3, 5);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.commands.executeCommand('rightClickMention.sendFile', uri, [uri]);
      assert.strictEqual(await clipboard(), '@alpha/src/app.js');
    });

    it('複数選択 → 順に処理し、参照はまとめてコピー。開いたタブは残らない', async function () {
      const a = fileIn('alpha', 'src/app.js');
      const b = fileIn('beta', 'src/only-in-beta.js');
      await vscode.commands.executeCommand('rightClickMention.sendFile', a, [a, b]);
      assert.strictEqual(await clipboard(), '@alpha/src/app.js @beta/src/only-in-beta.js');
      assert.strictEqual(hasTab(a), false);
      assert.strictEqual(hasTab(b), false);
    });

    it('バイナリファイル → 開かずに @path をコピー', async function () {
      const uri = fileIn('alpha', 'binary.bin');
      await vscode.commands.executeCommand('rightClickMention.sendFile', uri, [uri]);
      assert.strictEqual(await clipboard(), '@alpha/binary.bin');
    });

    it('フォルダ → 本物のファイルシステムでフォルダと判定し、@folder/ をコピー', async function () {
      const dir = fileIn('alpha', 'src');
      await vscode.commands.executeCommand('rightClickMention.sendFile', dir, [dir]);
      assert.strictEqual(await clipboard(), '@alpha/src/');
    });

    it('ファイルとフォルダの混在 → まとめて 1 回でコピー', async function () {
      const dir = fileIn('beta', 'src');
      const a = fileIn('alpha', 'src/app.js');
      await vscode.commands.executeCommand('rightClickMention.sendFile', dir, [dir, a]);
      assert.strictEqual(await clipboard(), '@beta/src/ @alpha/src/app.js');
    });
  });

  describe('エクスプローラーからの送信（初期設定: 貼り付け）', function () {
    // 公式拡張を無効にしているので、貼り付けまではいかず、クリップボードへのコピーになる
    // 設定 open でも、開いてすぐ閉じるので最後のタブの状態は同じになる
    // そのため、タブが一度も変化しないことで、開いていないことを確かめる
    it('ファイルを開かずに参照を作る（タブは一度も開かない）', async function () {
      const uri = fileIn('alpha', 'src/app.js');
      let tabChanges = 0;
      const sub = vscode.window.tabGroups.onDidChangeTabs(() => tabChanges++);
      try {
        await vscode.commands.executeCommand('rightClickMention.sendFile', uri, [uri]);
      } finally {
        sub.dispose();
      }
      assert.strictEqual(await clipboard(), '@alpha/src/app.js');
      assert.strictEqual(tabChanges, 0);
      assert.strictEqual(hasTab(uri), false);
    });

    it('ファイルとフォルダを混ぜても、選んだ順にまとめて 1 回でコピーする', async function () {
      const a = fileIn('alpha', 'src/app.js');
      const dir = fileIn('beta', 'src');
      const b = fileIn('beta', 'src/only-in-beta.js');
      await vscode.commands.executeCommand('rightClickMention.sendFile', a, [a, dir, b]);
      assert.strictEqual(await clipboard(), '@alpha/src/app.js @beta/src/ @beta/src/only-in-beta.js');
      assert.strictEqual(hasTab(a), false);
      assert.strictEqual(hasTab(b), false);
    });
  });
});
