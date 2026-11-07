// 実際の VS Code 上で動かすテスト
// ワークスペース: test/fixtures/multi-root（alpha / beta の2フォルダ）
// 公式 Claude 拡張は無効なので、送信結果はクリップボードの中身で確認する
'use strict';

const assert = require('assert');
const vscode = require('vscode');

const EXT_ID = 'kip2.right-click-mention';
const IDS = ['rightClickMention.sendSelection', 'rightClickMention.sendCurrentFile', 'rightClickMention.sendFile'];

function fileIn(folderName, rel) {
  const folder = vscode.workspace.workspaceFolders.find((f) => f.name === folderName);
  assert.ok(folder, `ワークスペースに ${folderName} が無い`);
  return vscode.Uri.joinPath(folder.uri, ...rel.split('/'));
}

async function openWithSelection(uri, sl, sc, el, ec) {
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  editor.selection = new vscode.Selection(sl, sc, el, ec);
  return editor;
}

const clipboard = () => vscode.env.clipboard.readText();

describe('Right Click Mention（実VS Code・マルチルート）', function () {
  before(async function () {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `${EXT_ID} が読み込まれていない`);
    await ext.activate();
  });

  beforeEach(async function () {
    await vscode.env.clipboard.writeText('');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  describe('前提条件', function () {
    it('ワークスペースが alpha / beta の2フォルダ', function () {
      assert.deepStrictEqual(vscode.workspace.workspaceFolders.map((f) => f.name), ['alpha', 'beta']);
    });

    it('公式 Claude 拡張は無効（フォールバック経路をテストするため）', function () {
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

  describe('エクスプローラーからの送信', function () {
    it('1ファイル → 開いて選択なしで送る', async function () {
      const uri = fileIn('beta', 'src/only-in-beta.js');
      await vscode.commands.executeCommand('rightClickMention.sendFile', uri, [uri]);
      assert.strictEqual(await clipboard(), '@beta/src/only-in-beta.js');
      const ed = vscode.window.activeTextEditor;
      assert.strictEqual(ed.document.uri.toString(), uri.toString());
      assert.ok(ed.selection.isEmpty);
    });

    it('前回の選択が残っているファイルでも、選択なしで送る', async function () {
      const uri = fileIn('alpha', 'src/app.js');
      await openWithSelection(uri, 1, 0, 3, 5);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.commands.executeCommand('rightClickMention.sendFile', uri, [uri]);
      assert.strictEqual(await clipboard(), '@alpha/src/app.js');
    });

    it('複数選択 → 順に処理し、参照はまとめてコピー。最後のファイルが開いて残る', async function () {
      const a = fileIn('alpha', 'src/app.js');
      const b = fileIn('beta', 'src/only-in-beta.js');
      await vscode.commands.executeCommand('rightClickMention.sendFile', a, [a, b]);
      assert.strictEqual(await clipboard(), '@alpha/src/app.js @beta/src/only-in-beta.js');
      assert.strictEqual(vscode.window.activeTextEditor.document.uri.toString(), b.toString());
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
});
