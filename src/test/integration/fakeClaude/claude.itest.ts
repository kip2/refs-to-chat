// 偽の公式拡張を使う統合テスト（実 VS Code）
// 偽の公式拡張（src/test/fixtures/fake-claude-code）は、公式コマンドが呼ばれた瞬間の状態を記録する
// これで、公式コマンドを呼ぶ動きを、ログインなしで確かめる

import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { clipboard, EXT_ID, fileIn, hasTab, open, openWithSelection, selectionOf, setExplorerClipboard, settle } from '../helpers';

const CLAUDE_ID = 'anthropic.claude-code';

interface FakeCall {
  id: 'focus' | 'insert';
  editor?: { uri: string; selection: [number, number, number, number] };
}

interface FakeClaude {
  readonly calls: FakeCall[];
  setChatMode(mode: 'editorTab' | 'sidebar'): void;
  setFail(fail: { insert?: boolean; focus?: boolean }): void;
  chatText(): string;
  isChatOpen(): boolean;
  reset(): void;
}

/** 左のグループに、プレビューではないタブで開く */
const LEFT: vscode.TextDocumentShowOptions = { viewColumn: vscode.ViewColumn.One, preview: false };

/** そのグループに開いているテキストのタブ */
function tabUris(column: vscode.ViewColumn): string[] {
  const group = vscode.window.tabGroups.all.find((g) => g.viewColumn === column);
  return (group?.tabs ?? []).flatMap((t) => (t.input instanceof vscode.TabInputText ? [t.input.uri.toString()] : []));
}

/** 今見えているエディタの選択範囲 */
function liveSelection(uri: vscode.Uri): [number, number, number, number] {
  const live = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString());
  assert.ok(live, `${uri.toString()} が見えていない`);
  return selectionOf(live);
}

const isEmpty = (s?: [number, number, number, number]) => s !== undefined && s[0] === s[2] && s[1] === s[3];

/**
 * 実行中に開いたテキストのタブ（グループと URI）を記録する
 * アクティブなエディタやグループの情報は、テストのウィンドウにフォーカスがないと遅れて届く
 * そのため「どのグループに開いたか」は、タブが開いたときのイベントで確かめる
 */
async function openedTabsDuring(action: () => Thenable<unknown>): Promise<{ column: number; uri: string }[]> {
  const opened: { column: number; uri: string }[] = [];
  const sub = vscode.window.tabGroups.onDidChangeTabs((e) => {
    for (const t of e.opened) {
      if (t.input instanceof vscode.TabInputText) opened.push({ column: t.group.viewColumn, uri: t.input.uri.toString() });
    }
  });
  try {
    await action();
    // タブのイベントはコマンドが終わったあとに届くことがあるので、少し待ってから見張りをやめる
    await settle();
  } finally {
    sub.dispose();
  }
  return opened;
}

const sendSelection = () => vscode.commands.executeCommand('refsToChat.sendSelection');
const sendCurrentFile = () => vscode.commands.executeCommand('refsToChat.sendCurrentFile');
const sendFiles = (...uris: vscode.Uri[]) => vscode.commands.executeCommand('refsToChat.sendFile', uris[0], uris);

describe('Refs to Chat（偽の公式拡張・実 VS Code）', function () {
  let fake: FakeClaude;
  const ids = () => fake.calls.map((c) => c.id);
  const insertCalls = () => fake.calls.filter((c) => c.id === 'insert');

  /** チャットの入力欄の中身は Webview から遅れて届くので、しばらく待って確かめる */
  async function expectChatText(expected: string): Promise<void> {
    for (let i = 0; i < 100 && fake.chatText() !== expected; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.strictEqual(fake.chatText(), expected);
  }

  before(async function () {
    const ext = vscode.extensions.getExtension<FakeClaude>(CLAUDE_ID);
    assert.ok(ext, '偽の公式拡張が読み込まれていない');
    fake = await ext.activate();
    await vscode.extensions.getExtension(EXT_ID)?.activate();
  });

  beforeEach(async function () {
    await setExplorerClipboard(undefined);
    fake.reset();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.env.clipboard.writeText('');
  });

  afterEach(async function () {
    // 貼り付けがチャットではなくファイルに入ると、未保存のまま残り、次のテストで閉じるときに止まる
    // 元に戻してから、テストを失敗させる
    const dirty = vscode.workspace.textDocuments.filter((d) => d.isDirty && d.uri.scheme === 'file');
    for (const doc of dirty) {
      await vscode.window.showTextDocument(doc);
      await vscode.commands.executeCommand('workbench.action.files.revert');
    }
    assert.deepStrictEqual(
      dirty.map((d) => d.uri.toString()),
      [],
      'テストのファイルが書き換わった（貼り付けがファイルに入った）',
    );
  });

  after(async function () {
    await setExplorerClipboard(undefined);
    fake.reset();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  describe('前提条件', function () {
    it('偽の公式拡張が anthropic.claude-code として読み込まれ、公開コマンドが登録されている', async function () {
      const all = await vscode.commands.getCommands(true);
      assert.ok(all.includes('claude-vscode.insertAtMention'));
      assert.ok(all.includes('claude-vscode.focus'));
    });
  });

  describe('エディタから追加する', function () {
    it('選択範囲を追加 → チャットを開いてから、選択したままのエディタで公式コマンドを呼ぶ。選択範囲はそのまま', async function () {
      const uri = fileIn('alpha', 'src/app.js');
      const editor = await openWithSelection(uri, 1, 0, 3, 1, LEFT);
      const before = selectionOf(editor);
      const opened = await openedTabsDuring(sendSelection);

      assert.deepStrictEqual(ids(), ['focus', 'insert']);
      const insert = insertCalls()[0];
      assert.strictEqual(insert.editor?.uri, uri.toString());
      assert.deepStrictEqual(insert.editor?.selection, before);
      // チャットはエディタのタブにあるので、入れる前に元のエディタを前面に戻す（別のグループにタブは開かない）
      assert.deepStrictEqual(opened, []);
      assert.deepStrictEqual(liveSelection(uri), before);
    });

    it('何も選ばずに追加 → 選択が空のまま公式コマンドを呼ぶ', async function () {
      const uri = fileIn('beta', 'src/app.js');
      await openWithSelection(uri, 0, 0, 0, 0, LEFT);
      await sendCurrentFile();
      const insert = insertCalls()[0];
      assert.strictEqual(insert.editor?.uri, uri.toString());
      assert.deepStrictEqual(insert.editor?.selection, [0, 0, 0, 0]);
    });

    it('チャットが閉じていても、先に開いてから公式コマンドを呼ぶ', async function () {
      assert.ok(!fake.isChatOpen(), 'チャットが開いている');
      const uri = fileIn('alpha', 'src/app.js');
      await openWithSelection(uri, 1, 0, 2, 3, LEFT);
      await sendSelection();
      assert.deepStrictEqual(ids(), ['focus', 'insert']);
      assert.ok(fake.isChatOpen(), 'チャットが開いていない');
      assert.strictEqual(insertCalls()[0].editor?.uri, uri.toString());
    });

    it('チャットがサイドバーにあるときも、選択範囲を保ったまま公式コマンドを呼び、タブは増えない', async function () {
      fake.setChatMode('sidebar');
      const uri = fileIn('alpha', 'src/app.js');
      const editor = await openWithSelection(uri, 1, 0, 3, 1, LEFT);
      const before = selectionOf(editor);
      const tabsBefore = tabUris(vscode.ViewColumn.One);
      await sendSelection();
      assert.deepStrictEqual(ids(), ['focus', 'insert']);
      assert.deepStrictEqual(insertCalls()[0].editor?.selection, before);
      assert.deepStrictEqual(tabUris(vscode.ViewColumn.One), tabsBefore);
    });

    it('右側のグループで選んだ範囲を追加 → 右側のエディタで公式コマンドを呼び、左側にタブは増えない', async function () {
      fake.setChatMode('sidebar');
      const left = fileIn('beta', 'src/app.js');
      const right = fileIn('alpha', 'src/app.js');
      await open(left, LEFT);
      const editor = await openWithSelection(right, 1, 0, 2, 3, { viewColumn: vscode.ViewColumn.Two, preview: false });
      const before = selectionOf(editor);
      const opened = await openedTabsDuring(sendSelection);
      const insert = insertCalls()[0];
      assert.strictEqual(insert.editor?.uri, right.toString());
      assert.deepStrictEqual(opened, []);
      assert.deepStrictEqual(insert.editor?.selection, before);
      assert.deepStrictEqual(tabUris(vscode.ViewColumn.One), [left.toString()]);
    });

    it('公式コマンドが失敗したら、参照をクリップボードにコピーする', async function () {
      fake.setFail({ insert: true });
      await openWithSelection(fileIn('alpha', 'src/app.js'), 1, 0, 3, 1, LEFT);
      await sendSelection();
      assert.strictEqual(await clipboard(), '@alpha/src/app.js#2-4');
    });

    it('チャットを開くのに失敗しても、公式コマンドで入れることは試す', async function () {
      fake.setFail({ focus: true });
      await openWithSelection(fileIn('alpha', 'src/app.js'), 0, 0, 0, 0, LEFT);
      await sendCurrentFile();
      assert.deepStrictEqual(ids(), ['focus', 'insert']);
      assert.strictEqual(await clipboard(), '');
    });
  });

  describe('エクスプローラーから追加する（初期設定 use）', function () {
    it('開いていないファイル → 開かずに、チャットを開いて貼り付ける。クリップボードは参照に置き換わる', async function () {
      const uri = fileIn('alpha', 'src/app.js');
      await vscode.env.clipboard.writeText('前にコピーしていたもの');
      const opened = await openedTabsDuring(() => sendFiles(uri));
      assert.deepStrictEqual(ids(), ['focus']);
      await expectChatText('@alpha/src/app.js ');
      assert.deepStrictEqual(opened, [], 'ファイルのタブが開いた');
      assert.strictEqual(await clipboard(), '@alpha/src/app.js ');
    });

    it('ファイル 2 つとフォルダ 1 つ → 選んだ順に 1 回で貼り付ける', async function () {
      await sendFiles(fileIn('alpha', 'src/app.js'), fileIn('beta', 'src'), fileIn('beta', 'src/only-in-beta.js'));
      assert.deepStrictEqual(ids(), ['focus']);
      await expectChatText('@alpha/src/app.js @beta/src/ @beta/src/only-in-beta.js ');
    });

    it('続けて 2 回追加しても、参照どうしがくっつかない', async function () {
      await sendFiles(fileIn('alpha', 'src/app.js'));
      await expectChatText('@alpha/src/app.js ');
      await sendFiles(fileIn('beta', 'src/only-in-beta.js'));
      await expectChatText('@alpha/src/app.js @beta/src/only-in-beta.js ');
    });

    it('開いているファイル（範囲を選んでおく）→ 行番号なしで貼り付け、タブも選択範囲もそのまま', async function () {
      const uri = fileIn('alpha', 'src/app.js');
      const editor = await openWithSelection(uri, 1, 0, 3, 1, LEFT);
      const before = selectionOf(editor);
      await sendFiles(uri);
      await expectChatText('@alpha/src/app.js ');
      assert.ok(hasTab(uri));
      assert.deepStrictEqual(selectionOf(editor), before);
    });

    it('チャットを開くのに失敗したら、貼り付けずに参照をクリップボードにコピーする', async function () {
      fake.setFail({ focus: true });
      await sendFiles(fileIn('alpha', 'src/app.js'));
      assert.strictEqual(await clipboard(), '@alpha/src/app.js');
      assert.strictEqual(fake.chatText(), '');
    });
  });

  describe('エクスプローラーから追加する（設定 keep）', function () {
    beforeEach(async function () {
      await setExplorerClipboard('keep');
    });

    it('開いていないファイル → 一瞬開いて、そのエディタで公式コマンドを呼び、タブは閉じる', async function () {
      const uri = fileIn('alpha', 'src/app.js');
      await sendFiles(uri);
      assert.deepStrictEqual(ids(), ['focus', 'insert']);
      const insert = insertCalls()[0];
      assert.strictEqual(insert.editor?.uri, uri.toString());
      assert.ok(isEmpty(insert.editor?.selection), '選択が空ではない');
      assert.ok(!hasTab(uri), 'タブが残っている');
    });

    it('チャットがサイドバーにあるときも同じ（前面に戻す処理は要らない）', async function () {
      fake.setChatMode('sidebar');
      const uri = fileIn('alpha', 'src/app.js');
      await sendFiles(uri);
      assert.strictEqual(insertCalls()[0].editor?.uri, uri.toString());
      assert.ok(!hasTab(uri));
    });

    it('開いているファイル（範囲を選んでおく）→ 選択を空にして呼び、あとでタブと選択範囲を元に戻す', async function () {
      const uri = fileIn('alpha', 'src/app.js');
      const editor = await openWithSelection(uri, 1, 0, 3, 1, LEFT);
      const before = selectionOf(editor);
      await sendFiles(uri);
      const insert = insertCalls()[0];
      assert.strictEqual(insert.editor?.uri, uri.toString());
      assert.ok(isEmpty(insert.editor?.selection), '選択が空ではない');
      assert.ok(hasTab(uri), 'もともと開いていたタブが閉じた');
      assert.deepStrictEqual(liveSelection(uri), before);
    });

    it('右側にだけ開いているファイルを、左側を選んだ状態で追加 → 左側に一瞬開いて閉じ、右側のタブは残る', async function () {
      fake.setChatMode('sidebar');
      const x = fileIn('alpha', 'src/app.js');
      const y = fileIn('beta', 'src/app.js');
      await open(x, { viewColumn: vscode.ViewColumn.Two, preview: false });
      await open(y, LEFT);
      const opened = await openedTabsDuring(() => sendFiles(x));
      assert.strictEqual(insertCalls()[0].editor?.uri, x.toString());
      assert.deepStrictEqual(opened, [{ column: vscode.ViewColumn.One, uri: x.toString() }]);
      assert.deepStrictEqual(tabUris(vscode.ViewColumn.One), [y.toString()]);
      assert.ok(tabUris(vscode.ViewColumn.Two).includes(x.toString()));
    });

    it('ファイルを 3 つ → それぞれのエディタで公式コマンドを呼び、どれも左側のグループに開いて、タブは残らない', async function () {
      const files = [fileIn('alpha', 'src/app.js'), fileIn('beta', 'src/app.js'), fileIn('beta', 'src/only-in-beta.js')];
      const opened = await openedTabsDuring(() => sendFiles(...files));
      assert.deepStrictEqual(
        insertCalls().map((c) => c.editor?.uri),
        files.map((f) => f.toString()),
      );
      // 2 つ目以降も、チャットのグループではなく左側に開く
      assert.deepStrictEqual(
        opened,
        files.map((f) => ({ column: vscode.ViewColumn.One, uri: f.toString() })),
      );
      for (const f of files) assert.ok(!hasTab(f), `${f.toString()} のタブが残っている`);
    });

    it('フォルダ → チャットに貼り付ける', async function () {
      await sendFiles(fileIn('alpha', 'src'));
      assert.deepStrictEqual(ids(), ['focus']);
      await expectChatText('@alpha/src/ ');
    });

    it('画像など開けないファイル → チャットに貼り付ける', async function () {
      await sendFiles(fileIn('alpha', 'binary.bin'));
      await expectChatText('@alpha/binary.bin ');
    });

    it('ファイルとフォルダの混在 → ファイルは公式コマンドで入れ、フォルダは最後に貼り付ける', async function () {
      const file = fileIn('alpha', 'src/app.js');
      await sendFiles(file, fileIn('beta', 'src'));
      assert.deepStrictEqual(ids(), ['focus', 'insert', 'focus']);
      assert.strictEqual(insertCalls()[0].editor?.uri, file.toString());
      await expectChatText('@beta/src/ ');
    });

    it('プレビューで開いていた別のファイルのタブは消えない', async function () {
      const other = fileIn('beta', 'src/app.js');
      await open(other, { viewColumn: vscode.ViewColumn.One, preview: true });
      const uri = fileIn('alpha', 'src/app.js');
      await sendFiles(uri);
      assert.ok(hasTab(other), 'プレビューのタブが消えた');
      assert.ok(!hasTab(uri));
    });

    it('公式コマンドが失敗したら、参照をクリップボードにコピーし、開いたタブは閉じる', async function () {
      fake.setFail({ insert: true });
      const uri = fileIn('alpha', 'src/app.js');
      await sendFiles(uri);
      assert.strictEqual(await clipboard(), '@alpha/src/app.js');
      assert.ok(!hasTab(uri));
    });
  });
});
