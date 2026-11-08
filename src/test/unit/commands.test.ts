// コマンドの登録と、送信・フォールバックの分岐のテスト

import * as assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { CLAUDE, FOCUS_WAIT_MS, PASTE_COMMAND } from '../../constants';
import { MESSAGES, REASON_MESSAGES as R } from '../../messages';
import { makeEditor, makeSelection, type MockOptions, setup, uri } from '../helpers/vscodeMock';

// constants.ts から読まずに直書きしているのは、ID が勝手に変わったら気づけるようにするため
const CMD = 'claude-vscode.insertAtMention';
const FOCUS = 'claude-vscode.focus';
const PASTE = 'editor.action.clipboardPasteAction';
const IDS = ['refsToChat.sendSelection', 'refsToChat.sendCurrentFile', 'refsToChat.sendFile', 'refsToChat.sendPreviewSelection'];

// クリップボードを使わず、ファイルを一瞬開いて公式コマンドで入れる設定（keep）で動かす
// 初期設定はクリップボードから貼り付ける（use）ので、開く動きを確かめるテストはこれを使う
const setupOpen = (o: MockOptions = {}) =>
  setup({ ...o, settings: { 'refsToChat.explorerClipboard': 'keep', ...o.settings } });

// 失敗時の console.error をテスト出力に出さない
let origError: typeof console.error;
beforeEach(() => {
  origError = console.error;
  console.error = () => {};
});
afterEach(() => {
  console.error = origError;
});

describe('activate / deactivate', () => {
  it('4つのコマンドを登録し、すべて subscriptions に入れる', () => {
    const { state, context } = setup();
    assert.deepEqual([...state.registered.keys()].sort(), [...IDS].sort());
    assert.equal(context.subscriptions.length, 4);
  });

  it('subscriptions を dispose するとコマンドが解除される', () => {
    const { state, context } = setup();
    context.subscriptions.forEach((d) => d.dispose());
    assert.equal(state.registered.size, 0);
  });

  it('deactivate は何もせずに終わる', () => {
    const { ext } = setup();
    assert.equal(ext.deactivate(), undefined);
  });

  it('公式コマンドIDと拡張IDが想定どおり', () => {
    assert.equal(CLAUDE.insertMentionCommand, CMD);
    assert.equal(CLAUDE.focusInputCommand, FOCUS);
    assert.equal(CLAUDE.extensionId, 'anthropic.claude-code');
    assert.equal(PASTE_COMMAND, PASTE);
  });

  it('貼り付け前の待ち時間は、待たされても気にならない 1 秒未満', () => {
    assert.ok(FOCUS_WAIT_MS > 0 && FOCUS_WAIT_MS < 1000, `${FOCUS_WAIT_MS}ms`);
  });

  it('extension.ts が公開するのは activate と deactivate だけ', () => {
    const { ext } = setup();
    assert.deepEqual(Object.keys(ext).sort(), ['activate', 'deactivate']);
  });
});

describe('エディタからの送信（sendSelection / sendCurrentFile）', () => {
  for (const id of ['refsToChat.sendSelection', 'refsToChat.sendCurrentFile']) {
    it(`${id}: 公式コマンドを1回だけ呼ぶ`, async () => {
      const { vscode, state, run } = setup();
      vscode.window.activeTextEditor = makeEditor('/ws/project/a.js', makeSelection(1, 0, 3, 2));
      await run(id);
      assert.deepEqual(state.executed, [FOCUS, CMD]);
      assert.equal(state.clipboard, '');
      assert.deepEqual(state.warnings, []);
    });
  }

  it('アクティブなエディタがない → 案内を出して何もしない', async () => {
    const { state, run } = setup();
    await run('refsToChat.sendSelection');
    assert.deepEqual(state.executed, []);
    assert.equal(state.clipboard, '');
    assert.equal(state.infos.length, 1);
  });

  it('公式拡張がない → 公式コマンドは呼ばずクリップボードへ', async () => {
    const { vscode, state, run } = setup({ claudeInstalled: false });
    vscode.window.activeTextEditor = makeEditor('/ws/project/src/app.ts', makeSelection(4, 0, 9, 1));
    await run('refsToChat.sendSelection');
    assert.deepEqual(state.executed, []);
    assert.equal(state.clipboard, '@src/app.ts#5-10');
    assert.equal(state.warnings.length, 1);
    assert.ok(state.warnings[0].includes(R.notInstalled));
    assert.match(state.warnings[0], /@src\/app\.ts#5-10/);
  });

  // executeCommand は常に Promise を返すので、失敗は reject として届く
  it('公式コマンドが失敗 → クリップボードへ（例外は外に出さない）', async () => {
    const { vscode, state, run } = setup({ onExecute: () => { throw new Error('command not found'); } });
    vscode.window.activeTextEditor = makeEditor('/ws/project/src/app.ts', makeSelection(0, 0, 0, 3));
    await assert.doesNotReject(run('refsToChat.sendSelection'));
    assert.deepEqual(state.executed, [FOCUS, CMD]);
    assert.equal(state.clipboard, '@src/app.ts#1');
    assert.ok(state.warnings[0].includes(R.failed));
  });

  it('入れる前にチャットを開く（エディタがまだ前面にあれば、前面に戻す処理はしない）', async () => {
    const { vscode, state, run } = setup();
    vscode.window.activeTextEditor = makeEditor('/ws/project/a.js', makeSelection(1, 0, 3, 2));
    await run('refsToChat.sendSelection');
    assert.deepEqual(state.log, [`cmd:${FOCUS}`, `cmd:${CMD}`]);
    assert.deepEqual(state.shown, []);
  });

  it('チャットがエディタのタブにあるときは、チャットを開く → 元のグループに選択ごと戻す → 入れる、の順', async () => {
    const sel = makeSelection(4, 0, 9, 1);
    const { vscode, state, run } = setup({ chatInEditorTab: true, chatColumn: 2 });
    vscode.window.activeTextEditor = makeEditor('/ws/project/a.js', sel);
    await run('refsToChat.sendSelection');
    assert.deepEqual(state.log, [`cmd:${FOCUS}`, 'show:/ws/project/a.js@1', `cmd:${CMD}`]);
    assert.equal(state.shown[0].options.viewColumn, 1);
    assert.equal(state.shown[0].options.preserveFocus, false);
    assert.equal(state.shown[0].options.selection, sel);
  });

  it('前面に戻せなくても、公式コマンドで入れることは試す（警告は出さない）', async () => {
    const { vscode, state, run } = setup({ chatInEditorTab: true, showFails: (p) => p === '/ws/project/a.js' });
    vscode.window.activeTextEditor = makeEditor('/ws/project/a.js');
    await run('refsToChat.sendCurrentFile');
    assert.deepEqual(state.executed, [FOCUS, CMD]);
    assert.deepEqual(state.warnings, []);
  });

  it('ノートブックのセルは、前面に戻すと普通のタブが開いてしまうので戻さない', async () => {
    const { vscode, state, run } = setup({ chatInEditorTab: true });
    const editor = makeEditor('/ws/project/note.ipynb');
    editor.document.uri.scheme = 'vscode-notebook-cell';
    vscode.window.activeTextEditor = editor;
    await run('refsToChat.sendCurrentFile');
    assert.deepEqual(state.shown, []);
    assert.deepEqual(state.executed, [FOCUS, CMD]);
  });

  it('どのグループか分からないエディタは、別の場所に開いてしまうので戻さない', async () => {
    const { vscode, state, run } = setup({ chatInEditorTab: true });
    const editor = makeEditor('/ws/project/a.js');
    (editor as { viewColumn?: number }).viewColumn = undefined;
    vscode.window.activeTextEditor = editor;
    await run('refsToChat.sendCurrentFile');
    assert.deepEqual(state.shown, []);
  });

  it('チャットをエディタのタブで開いていても、選択範囲を保ったまま元のエディタで入れる', async () => {
    const seen: { path?: string; line?: number; empty?: boolean }[] = [];
    const ctx: { vscode?: ReturnType<typeof setup>['vscode'] } = {};
    const { vscode, run } = setup({
      chatInEditorTab: true,
      onExecute: (id) => {
        const ed = ctx.vscode?.window.activeTextEditor;
        if (id === CMD) seen.push({ path: ed?.document.uri.fsPath, line: ed?.selection.start.line, empty: ed?.selection.isEmpty });
      },
    });
    ctx.vscode = vscode;
    vscode.window.activeTextEditor = makeEditor('/ws/project/a.js', makeSelection(4, 0, 9, 1));
    await run('refsToChat.sendSelection');
    assert.deepEqual(seen, [{ path: '/ws/project/a.js', line: 4, empty: false }]);
  });

  it('チャットを開くのに失敗しても、公式コマンドで入れることは試す', async () => {
    const { vscode, state, run } = setup({
      onExecute: (id) => {
        if (id === FOCUS) throw new Error('no chat');
      },
    });
    vscode.window.activeTextEditor = makeEditor('/ws/project/a.js');
    await run('refsToChat.sendCurrentFile');
    assert.deepEqual(state.executed, [FOCUS, CMD]);
    assert.deepEqual(state.warnings, []);
  });

  it('マルチルートのフォールバックはフォルダ名付き', async () => {
    const { vscode, state, run } = setup({ claudeInstalled: false, workspaceFolders: ['/ws/alpha', '/ws/beta'] });
    vscode.window.activeTextEditor = makeEditor('/ws/beta/src/app.js', makeSelection(2, 0, 4, 1));
    await run('refsToChat.sendSelection');
    assert.equal(state.clipboard, '@beta/src/app.js#3-5');
  });
});

describe('エクスプローラーからの送信（sendFile）', () => {
  const A = uri('/ws/project/a.js');
  const B = uri('/ws/project/b.js');
  const IMG = uri('/ws/project/logo.png');

  it('1ファイル: 開いて（フォーカスあり）、選択が空の状態で公式コマンドを呼ぶ', async () => {
    const emptyAtInsert: boolean[] = [];
    const ctx: { vscode?: ReturnType<typeof setup>['vscode'] } = {};
    const { vscode, state, run } = setupOpen({
      onExecute: (id) => {
        if (id === CMD) emptyAtInsert.push(Boolean(ctx.vscode?.window.activeTextEditor?.selection.isEmpty));
      },
    });
    ctx.vscode = vscode;
    await run('refsToChat.sendFile', A, undefined);
    assert.deepEqual(state.opened, ['/ws/project/a.js']);
    assert.equal(state.shown.length, 1); // 開いたファイルがまだ前面にあるので、前面に戻す処理はしない
    const o = state.shown[0].options;
    assert.equal(o.preview, false); // プレビューで開くと、ユーザーのプレビューのタブを消してしまう
    assert.equal(o.preserveFocus, false);
    assert.deepEqual(state.executed, [FOCUS, CMD]);
    assert.deepEqual(emptyAtInsert, [true]);
  });

  it('複数選択: 選択した順にすべて送る（右クリックしたファイルは重複させない）', async () => {
    const { state, run } = setupOpen();
    await run('refsToChat.sendFile', B, [A, B]);
    assert.deepEqual(state.opened, ['/ws/project/a.js', '/ws/project/b.js']);
    assert.deepEqual(state.executed, [FOCUS, CMD, FOCUS, CMD]);
  });

  it('選択配列が空なら右クリックしたファイルを使う', async () => {
    const { state, run } = setupOpen();
    await run('refsToChat.sendFile', A, []);
    assert.deepEqual(state.opened, ['/ws/project/a.js']);
  });

  it('引数が何もない（パレット等から）→ 何もしない', async () => {
    const { state, run } = setupOpen();
    await run('refsToChat.sendFile');
    assert.deepEqual(state.opened, []);
    assert.deepEqual(state.executed, []);
  });

  it('配列に undefined が混ざっても無視する', async () => {
    const { state, run } = setupOpen();
    await run('refsToChat.sendFile', undefined, [undefined, A]);
    assert.deepEqual(state.opened, ['/ws/project/a.js']);
  });

  it('テキストで開けないファイル → @path をコピーし、チャットに貼り付ける', async () => {
    const { state, run } = setupOpen({ isBinary: (p) => p.endsWith('.png') });
    await run('refsToChat.sendFile', IMG);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
    assert.equal(state.clipboard, '@logo.png ');
    assert.deepEqual(state.warnings, []);
    assert.deepEqual(state.infos, []);
  });

  it('開けないファイルが混ざっても残りは送り、開けないものは最後に貼り付ける', async () => {
    const { state, run } = setupOpen({ isBinary: (p) => p.endsWith('.png') });
    await run('refsToChat.sendFile', A, [A, IMG, B]);
    assert.deepEqual(state.executed, [FOCUS, CMD, FOCUS, CMD, FOCUS, PASTE]);
    assert.deepEqual(state.clipboardWrites, ['@logo.png ']);
  });

  it('開けたファイルで公式コマンドが失敗 →「追加できなかった」として扱い、「開けない」と取り違えない', async () => {
    const { state, run } = setupOpen({ onExecute: () => { throw new Error('boom'); } });
    await run('refsToChat.sendFile', A);
    assert.deepEqual(state.clipboardWrites, ['@a.js']);
    assert.equal(state.warnings.length, 1);
    assert.ok(state.warnings[0].includes(R.failed));
  });

  it('公式拡張がない → すべての参照をまとめて 1 回でコピーし、警告も 1 回', async () => {
    const { state, run } = setupOpen({ claudeInstalled: false });
    await run('refsToChat.sendFile', A, [A, B]);
    assert.deepEqual(state.clipboardWrites, ['@a.js @b.js']);
    assert.equal(state.warnings.length, 1);
    assert.ok(state.warnings[0].includes(R.notInstalled));
  });

  it('フォルダ → @src/ をコピーし、入力欄にフォーカスして貼り付ける（ファイルとしては開かない）', async () => {
    const SRC = uri('/ws/project/src');
    const { state, run } = setupOpen({ isFolder: (p) => p === '/ws/project/src' });
    await run('refsToChat.sendFile', SRC);
    assert.deepEqual(state.opened, []);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
    assert.deepEqual(state.clipboardWrites, ['@src/ ']);
    assert.deepEqual(state.warnings, []);
    assert.deepEqual(state.infos, []);
  });

  it('フォルダで貼り付けに失敗 → コピーしたまま警告を 1 回（貼り付けたとは言わない）', async () => {
    const SRC = uri('/ws/project/src');
    const { state, run } = setupOpen({
      isFolder: (p) => p === '/ws/project/src',
      onExecute: (id) => { if (id === FOCUS) throw new Error('no focus'); },
    });
    await run('refsToChat.sendFile', SRC);
    assert.equal(state.clipboard, '@src/');
    assert.equal(state.warnings.length, 1);
    assert.ok(state.warnings[0].includes(R.pasteFailed));
    assert.deepEqual(state.infos, []);
  });

  it('フォーカスは移ったが貼り付けに失敗 → コピーしたまま警告を 1 回', async () => {
    const SRC = uri('/ws/project/src');
    const { state, run } = setupOpen({
      isFolder: (p) => p === '/ws/project/src',
      onExecute: (id) => { if (id === PASTE) throw new Error('paste failed'); },
    });
    await run('refsToChat.sendFile', SRC);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
    assert.equal(state.clipboard, '@src/');
    assert.equal(state.warnings.length, 1);
    assert.deepEqual(state.infos, []);
  });

  it('公式拡張がないときは、フォルダでも貼り付けを試さず、拡張がないことを伝える', async () => {
    const SRC = uri('/ws/project/src');
    const { state, run } = setupOpen({ claudeInstalled: false, isFolder: (p) => p === '/ws/project/src' });
    await run('refsToChat.sendFile', SRC);
    assert.deepEqual(state.executed, []);
    assert.deepEqual(state.clipboardWrites, ['@src/']);
    assert.equal(state.warnings.length, 1);
    assert.ok(state.warnings[0].includes(R.notInstalled));
  });

  it('フォルダへのシンボリックリンクもフォルダとして扱う', async () => {
    const LINK = uri('/ws/project/linked');
    const { state, run } = setupOpen({ isSymlinkFolder: (p) => p === '/ws/project/linked' });
    await run('refsToChat.sendFile', LINK);
    assert.deepEqual(state.opened, []);
    assert.deepEqual(state.clipboardWrites, ['@linked/ ']);
  });

  it('フォルダか調べられない → ファイルとして開いて送る', async () => {
    const { state, run } = setupOpen({ statFails: (p) => p === '/ws/project/a.js' });
    await run('refsToChat.sendFile', A);
    assert.deepEqual(state.opened, ['/ws/project/a.js']);
    assert.deepEqual(state.executed, [FOCUS, CMD]);
  });

  it('エディタで表示できないファイルがあっても止まらず、残りと後回しの分を届ける', async () => {
    const SRC = uri('/ws/project/src');
    const { state, run } = setupOpen({
      isFolder: (p) => p === '/ws/project/src',
      showFails: (p) => p === '/ws/project/a.js',
    });
    await assert.doesNotReject(run('refsToChat.sendFile', A, [SRC, A, B]));
    assert.deepEqual(state.executed, [FOCUS, CMD, FOCUS, PASTE]); // B は送り、src と a.js は貼り付け
    assert.deepEqual(state.clipboardWrites, ['@src/ @a.js ']);
  });

  it('同じ理由は 1 回だけ警告に書く', async () => {
    const SRC = uri('/ws/project/src');
    const DOCS = uri('/ws/project/docs');
    const { state, run } = setupOpen({
      claudeInstalled: false,
      isFolder: (p) => p === '/ws/project/src' || p === '/ws/project/docs',
    });
    await run('refsToChat.sendFile', SRC, [SRC, A, DOCS]);
    const reasons = state.warnings[0].split('。').slice(0, -1);
    assert.deepEqual(reasons, [R.notInstalled]);
  });

  it('ファイルとフォルダの混在 → ファイルは送り、フォルダだけまとめてコピー', async () => {
    const SRC = uri('/ws/project/src');
    const DOCS = uri('/ws/project/docs');
    const { state, run } = setupOpen({ isFolder: (p) => p === '/ws/project/src' || p === '/ws/project/docs' });
    await run('refsToChat.sendFile', A, [SRC, A, DOCS]);
    assert.deepEqual(state.opened, ['/ws/project/a.js']);
    assert.deepEqual(state.executed, [FOCUS, CMD, FOCUS, PASTE]);
    assert.deepEqual(state.clipboardWrites, ['@src/ @docs/ ']);
    assert.deepEqual(state.infos, []);
  });

  it('理由が違うものが混ざっても、コピーも警告も 1 回で、理由は全部書く', async () => {
    const SRC = uri('/ws/project/src');
    const { state, run } = setupOpen({
      claudeInstalled: false,
      isFolder: (p) => p === '/ws/project/src',
      isBinary: (p) => p.endsWith('.png'),
    });
    await run('refsToChat.sendFile', A, [A, SRC, IMG]);
    assert.deepEqual(state.clipboardWrites, ['@a.js @src/ @logo.png']);
    assert.equal(state.warnings.length, 1);
    assert.ok(state.warnings[0].includes(R.notInstalled));
  });

  // ターミナルなどに入ると、コマンドとして動きうるため
  it('名前に改行などを含む参照は、貼り付けもコピーもせず、警告だけ出す', async () => {
    const ODD = uri('/ws/project/odd\nname');
    const { state, run } = setupOpen({ isFolder: (p) => p === '/ws/project/odd\nname' });
    await run('refsToChat.sendFile', ODD);
    assert.deepEqual(state.executed, []); // フォーカスも貼り付けも呼ばない
    assert.deepEqual(state.clipboardWrites, []);
    assert.deepEqual(state.warnings, [MESSAGES.unsafeName(1)]);
  });

  it('名前に改行などを含むものが混ざっても、ほかのものは貼り付けで入れる', async () => {
    const ODD = uri('/ws/project/odd\nname');
    const SRC = uri('/ws/project/src');
    const { state, run } = setup({ isFolder: (p) => p === '/ws/project/src' });
    await run('refsToChat.sendFile', A, [A, ODD, SRC]);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
    assert.deepEqual(state.clipboardWrites, ['@a.js @src/ ']);
    assert.deepEqual(state.warnings, [MESSAGES.unsafeName(1)]);
  });

  it('すべてチャットに送れたら、クリップボードには触らない', async () => {
    const { state, run } = setupOpen();
    await run('refsToChat.sendFile', A, [A, B]);
    assert.deepEqual(state.clipboardWrites, []);
    assert.deepEqual(state.warnings, []);
  });

  it('マルチルートの別フォルダのファイル', async () => {
    const { state, run } = setupOpen({ claudeInstalled: false, workspaceFolders: ['/ws/alpha', '/ws/beta'] });
    await run('refsToChat.sendFile', uri('/ws/beta/src/only-in-beta.js'));
    assert.equal(state.clipboard, '@beta/src/only-in-beta.js');
  });
});

describe('エクスプローラーから送るときに開いたタブ', () => {
  const A = uri('/ws/project/a.js');
  const B = uri('/ws/project/b.js');
  const tabPaths = (tabs: { input: { uri: { fsPath: string } } }[]) => tabs.map((t) => t.input.uri.fsPath);

  it('参照を作るために開いたタブは、チャットに入れたあとで閉じる', async () => {
    const { state, run } = setupOpen();
    await run('refsToChat.sendFile', A);
    assert.deepEqual(state.executed, [FOCUS, CMD]);
    assert.deepEqual(state.closed, ['/ws/project/a.js']);
    assert.deepEqual(state.tabs, []);
  });

  it('閉じるのは公式コマンドで入れたあと（入れる時点ではタブが開いている）', async () => {
    const tabsAtInsert: string[][] = [];
    const ctx: { state?: ReturnType<typeof setup>['state'] } = {};
    const { state, run } = setupOpen({
      onExecute: (id) => {
        if (id === CMD && ctx.state) tabsAtInsert.push(tabPaths(ctx.state.tabs));
      },
    });
    ctx.state = state;
    await run('refsToChat.sendFile', A);
    assert.deepEqual(tabsAtInsert, [['/ws/project/a.js']]);
    assert.deepEqual(state.tabs, []);
  });

  it('もともと開いていたファイルのタブは閉じない', async () => {
    const { state, run } = setupOpen({ openTabs: ['/ws/project/a.js'] });
    await run('refsToChat.sendFile', A, [A, B]);
    assert.deepEqual(state.executed, [FOCUS, CMD, FOCUS, CMD]);
    assert.deepEqual(state.closed, ['/ws/project/b.js']);
    assert.deepEqual(tabPaths(state.tabs), ['/ws/project/a.js']);
  });

  it('公式拡張が無くてコピーに回ったときも、開いたタブは閉じる', async () => {
    const { state, run } = setupOpen({ claudeInstalled: false });
    await run('refsToChat.sendFile', A, [A, B]);
    assert.deepEqual(state.clipboardWrites, ['@a.js @b.js']);
    assert.deepEqual(state.tabs, []);
  });

  it('タブを閉じられなくても、残りのファイルは送る（タブは残り、通知もコピーもしない）', async () => {
    const { state, run } = setupOpen({ closeFails: true });
    await assert.doesNotReject(run('refsToChat.sendFile', A, [A, B]));
    assert.deepEqual(state.executed, [FOCUS, CMD, FOCUS, CMD]);
    assert.deepEqual(state.closed, []);
    assert.deepEqual(tabPaths(state.tabs), ['/ws/project/a.js', '/ws/project/b.js']);
    assert.deepEqual(state.warnings, []);
    assert.deepEqual(state.clipboardWrites, []);
  });

  it('タブを閉じるときは、フォーカスを今の場所に保つ', async () => {
    const { state, run } = setupOpen();
    await run('refsToChat.sendFile', A);
    assert.deepEqual(state.closePreserveFocus, [true]);
  });

  it('別のエディタグループにだけ開いていたファイルは、今のグループにできたタブを閉じる', async () => {
    const { state, run } = setupOpen({ otherGroupTabs: ['/ws/project/a.js'] });
    await run('refsToChat.sendFile', A);
    assert.deepEqual(state.tabs, []);
    assert.deepEqual(tabPaths(state.otherTabs), ['/ws/project/a.js']);
  });

  it('パスの大文字小文字だけ違っても、もともと開いていたタブは閉じない（Windows）', async () => {
    // エクスプローラーからは小文字、開いているドキュメントは大文字の App.ts
    const { state, run } = setupOpen({
      openTabs: ['/ws/project/App.ts'],
      documentPath: (p) => (p.toLowerCase() === '/ws/project/app.ts' ? '/ws/project/App.ts' : p),
    });
    await run('refsToChat.sendFile', uri('/ws/project/app.ts'));
    assert.deepEqual(state.closed, []);
    assert.deepEqual(tabPaths(state.tabs), ['/ws/project/App.ts']);
  });

  it('チャットをエディタのタブで開いていても、開いたファイルで入れて、そのタブは閉じる', async () => {
    const seen: (string | undefined)[] = [];
    const ctx: { vscode?: ReturnType<typeof setup>['vscode'] } = {};
    const { vscode, state, run } = setupOpen({
      chatInEditorTab: true,
      onExecute: (id) => {
        if (id === CMD) seen.push(ctx.vscode?.window.activeTextEditor?.document.uri.fsPath);
      },
    });
    ctx.vscode = vscode;
    await run('refsToChat.sendFile', A, [A, B]);
    assert.deepEqual(seen, ['/ws/project/a.js', '/ws/project/b.js']);
    assert.deepEqual(state.tabs, []);
  });

  it('もともと開いていたファイルは、送ったあとで選択（カーソル位置）を元に戻す', async () => {
    const sel = makeSelection(4, 2, 9, 7);
    const { state, run } = setupOpen({ openTabs: ['/ws/project/a.js'], selections: { '/ws/project/a.js': sel } });
    await run('refsToChat.sendFile', A);
    const editor = state.editors.get('/ws/project/a.js');
    assert.ok(editor);
    assert.deepEqual(editor.selections, [sel]);
  });

  it('もともと開いていたが裏にあったタブは、閉じずに、入れたあとで前面にあったタブを戻す', async () => {
    const { state, run } = setupOpen({ openTabs: ['/ws/project/a.js', '/ws/project/b.js'] });
    await run('refsToChat.sendFile', A);
    assert.deepEqual(state.closed, []);
    assert.equal(state.front.get(1)?.input.uri.fsPath, '/ws/project/b.js');
    // そのグループにフォーカスを移してから、直前に使ったエディタを開く（Webview のタブも戻せるように）
    assert.deepEqual(state.executed, [
      FOCUS,
      CMD,
      'workbench.action.focusFirstEditorGroup',
      'workbench.action.openPreviousRecentlyUsedEditorInGroup',
    ]);
  });

  it('もともと前面にあったタブなら、ほかのタブを前面に出し直さない', async () => {
    const { state, run } = setupOpen({ openTabs: ['/ws/project/b.js', '/ws/project/a.js'] });
    await run('refsToChat.sendFile', A);
    assert.deepEqual(
      state.shown.map((s) => s.fsPath),
      ['/ws/project/a.js'],
    );
    assert.equal(state.front.get(1)?.input.uri.fsPath, '/ws/project/a.js');
  });

  it('公式コマンドを呼ぶときは、カーソル位置で選択を空にしている（先頭に飛ばさない）', async () => {
    const seen: { empty: boolean; line: number }[] = [];
    const ctx: { vscode?: ReturnType<typeof setup>['vscode'] } = {};
    const { vscode, run } = setupOpen({
      openTabs: ['/ws/project/a.js'],
      selections: { '/ws/project/a.js': makeSelection(4, 2, 9, 7) },
      onExecute: (id) => {
        const sel = ctx.vscode?.window.activeTextEditor?.selection;
        if (id === CMD && sel) seen.push({ empty: sel.isEmpty, line: sel.start.line });
      },
    });
    ctx.vscode = vscode;
    await run('refsToChat.sendFile', A);
    assert.deepEqual(seen, [{ empty: true, line: 9 }]);
  });

  it('フォルダとテキストで開けないファイルは開かないので、タブには触らない', async () => {
    const SRC = uri('/ws/project/src');
    const IMG = uri('/ws/project/logo.png');
    const { state, run } = setupOpen({
      openTabs: ['/ws/project/other.js'],
      isFolder: (p) => p === '/ws/project/src',
      isBinary: (p) => p.endsWith('.png'),
    });
    await run('refsToChat.sendFile', SRC, [SRC, IMG]);
    assert.deepEqual(state.closed, []);
    assert.deepEqual(tabPaths(state.tabs), ['/ws/project/other.js']);
  });

  it('エディタの右クリックでは、タブを閉じない', async () => {
    const { vscode, state, run } = setupOpen({ openTabs: ['/ws/project/a.js'] });
    vscode.window.activeTextEditor = makeEditor('/ws/project/a.js', makeSelection(1, 0, 3, 2));
    await run('refsToChat.sendSelection');
    assert.deepEqual(state.closed, []);
  });
});

describe('エクスプローラーから送るファイル（設定 use・初期設定）', () => {
  const A = uri('/ws/project/a.js');
  const B = uri('/ws/project/b.js');

  it('初期設定では、ファイルを開かずに貼り付けで入れる', async () => {
    const { state, run } = setup();
    await run('refsToChat.sendFile', A);
    assert.deepEqual(state.opened, []);
    assert.deepEqual(state.shown, []);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
    assert.deepEqual(state.clipboardWrites, ['@a.js ']);
    assert.deepEqual(state.infos, []);
  });

  it('設定に use と書いても同じ', async () => {
    const { state, run } = setup({ settings: { 'refsToChat.explorerClipboard': 'use' } });
    await run('refsToChat.sendFile', A);
    assert.deepEqual(state.opened, []);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
  });

  it('知らない値が設定されていたら、初期設定の貼り付けとして扱う', async () => {
    const { state, run } = setup({ settings: { 'refsToChat.explorerClipboard': 'unknown' } });
    await run('refsToChat.sendFile', A);
    assert.deepEqual(state.opened, []);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
  });

  it('複数のファイルとフォルダは、選んだ順にまとめて 1 回で貼り付ける', async () => {
    const SRC = uri('/ws/project/src');
    const { state, run } = setup({ isFolder: (p) => p === '/ws/project/src' });
    await run('refsToChat.sendFile', A, [A, SRC, B]);
    assert.deepEqual(state.opened, []);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
    assert.deepEqual(state.clipboardWrites, ['@a.js @src/ @b.js ']);
    assert.deepEqual(state.infos, []);
  });

  it('タブには触らない（開きも閉じもしない）', async () => {
    const { state, run } = setup({ openTabs: ['/ws/project/a.js'] });
    await run('refsToChat.sendFile', A, [A, B]);
    assert.deepEqual(state.closed, []);
    assert.deepEqual(state.shown, []);
  });

  it('画像などのファイルも、開こうとせずに貼り付ける', async () => {
    const IMG = uri('/ws/project/logo.png');
    const { state, run } = setup({ isBinary: (p) => p.endsWith('.png') });
    await run('refsToChat.sendFile', IMG);
    assert.deepEqual(state.opened, []);
    assert.deepEqual(state.clipboardWrites, ['@logo.png ']);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
  });

  it('貼り付けに失敗したら、コピーしたまま警告を 1 回出す', async () => {
    const { state, run } = setup({
      onExecute: (id) => {
        if (id === PASTE) throw new Error('paste failed');
      },
    });
    await run('refsToChat.sendFile', A);
    assert.equal(state.clipboard, '@a.js');
    assert.equal(state.warnings.length, 1);
    assert.ok(state.warnings[0].includes(R.pasteFailed));
    assert.deepEqual(state.infos, []);
  });

  it('公式拡張がないときは、貼り付けずにコピーし、拡張がないことを伝える', async () => {
    const { state, run } = setup({ claudeInstalled: false });
    await run('refsToChat.sendFile', A, [A, B]);
    assert.deepEqual(state.executed, []);
    assert.deepEqual(state.clipboardWrites, ['@a.js @b.js']);
    assert.ok(state.warnings[0].includes(R.notInstalled));
  });

  it('名前に改行を含むファイルは、貼り付けもコピーもしない', async () => {
    const ODD = uri('/ws/project/odd\nname.js');
    const { state, run } = setup();
    await run('refsToChat.sendFile', ODD);
    assert.deepEqual(state.executed, []);
    assert.deepEqual(state.clipboardWrites, []);
    assert.deepEqual(state.warnings, [MESSAGES.unsafeName(1)]);
  });

  describe('フォーカスが移らず、ファイルに貼り付けてしまったとき', () => {
    const withEditor = (o: MockOptions) => {
      const env = setup(o);
      env.vscode.window.activeTextEditor = makeEditor('/ws/project/open.js');
      return env;
    };

    it('前面のエディタのファイルに入ったら、取り消してコピーと警告に切り替える', async () => {
      const { state, run } = withEditor({ pasteIntoFile: 'active' });
      await run('refsToChat.sendFile', A);
      assert.deepEqual(state.executed, [FOCUS, PASTE, 'undo']);
      assert.equal(state.clipboard, '@a.js');
      assert.equal(state.warnings.length, 1);
      assert.ok(state.warnings[0].includes(R.pasteFailed));
    });

    it('前面ではないファイルに入ったら、取り消さずに知らせる（ほかの操作を取り消さないため）', async () => {
      const { state, run } = withEditor({ pasteIntoFile: 'other' });
      await run('refsToChat.sendFile', A);
      assert.deepEqual(state.executed, [FOCUS, PASTE]);
      assert.equal(state.warnings.length, 1);
      assert.ok(state.warnings[0].includes(R.leftInFile));
    });

    it('入ったあとにファイルがほかにも変わっていたら、取り消さずに知らせる', async () => {
      const { state, run } = withEditor({ pasteIntoFile: 'activeThenEdited' });
      await run('refsToChat.sendFile', A);
      assert.deepEqual(state.executed, [FOCUS, PASTE]);
      assert.ok(state.warnings[0].includes(R.leftInFile));
    });

    it('undo しても取り消せなかったら、知らせる', async () => {
      const { state, run } = withEditor({ pasteIntoFile: 'active', undoDoesNothing: true });
      await run('refsToChat.sendFile', A);
      assert.deepEqual(state.executed, [FOCUS, PASTE, 'undo']);
      assert.ok(state.warnings[0].includes(R.leftInFile));
    });

    it('前面にエディタがないときは、取り消さずに知らせる', async () => {
      const { state, run } = setup({ pasteIntoFile: 'active' });
      await run('refsToChat.sendFile', A);
      assert.deepEqual(state.executed, [FOCUS, PASTE]);
      assert.ok(state.warnings[0].includes(R.leftInFile));
    });
  });

  it('エディタの右クリックは、設定に関係なく公式コマンドで入れる', async () => {
    const { vscode, state, run } = setup({ settings: { 'refsToChat.explorerClipboard': 'use' } });
    vscode.window.activeTextEditor = makeEditor('/ws/project/a.js', makeSelection(1, 0, 3, 2));
    await run('refsToChat.sendSelection');
    assert.deepEqual(state.executed, [FOCUS, CMD]);
    assert.deepEqual(state.clipboardWrites, []);
  });
});

describe('エクスプローラーから送るときの細かい動き', () => {
  const A = uri('/ws/project/a.js');
  const B = uri('/ws/project/b.js');

  it('送るものが何もないときは、そう知らせる', async () => {
    const { state, run } = setup();
    await run('refsToChat.sendFile', undefined, []);
    assert.deepEqual(state.infos, [MESSAGES.noTarget]);
    assert.deepEqual(state.executed, []);
  });

  // 本当に入ったかは分からないので、うまくいったように見えても通知は出さない
  // 続けて貼り付けたときに、前の参照とくっついて 1 つの参照に見えないようにする
  it('貼り付けるときは末尾に空白を付ける。コピーだけのときは付けない', async () => {
    const pasted = setup();
    await pasted.run('refsToChat.sendFile', A, [A, B]);
    assert.deepEqual(pasted.state.clipboardWrites, ['@a.js @b.js ']);

    const copied = setup({ claudeInstalled: false });
    await copied.run('refsToChat.sendFile', A, [A, B]);
    assert.deepEqual(copied.state.clipboardWrites, ['@a.js @b.js']);
  });

  it('貼り付けたときは、通知を出さない', async () => {
    const { state, run } = setup();
    await run('refsToChat.sendFile', A, [A, B]);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
    assert.deepEqual(state.infos, []);
    assert.deepEqual(state.warnings, []);
  });

  it('文字の向きを変える見えない文字を含む名前は、貼り付けもコピーもしない', async () => {
    const ODD = uri('/ws/project/abc‮js.txt');
    const { state, run } = setup();
    await run('refsToChat.sendFile', ODD);
    assert.deepEqual(state.executed, []);
    assert.deepEqual(state.clipboardWrites, []);
    assert.deepEqual(state.warnings, [MESSAGES.unsafeName(1)]);
  });

  it('設定 keep で複数送るとき、チャットのグループではなく、最初に選んでいたグループに開く', async () => {
    const { state, run } = setupOpen({ chatInEditorTab: true, chatColumn: 2 });
    await run('refsToChat.sendFile', A, [A, B]);
    assert.deepEqual(
      state.shown.filter((s) => s.options.preview === false).map((s) => s.options.viewColumn),
      [1, 1],
    );
    assert.deepEqual(state.otherTabs, []);
    assert.deepEqual(state.tabs, []);
  });

  it('設定は送り始めに 1 回だけ読み、途中で変わっても最後まで同じ入れ方で送る', async () => {
    const settings: Record<string, unknown> = { 'refsToChat.explorerClipboard': 'keep' };
    const { state, run } = setup({
      settings,
      onExecute: (id) => {
        if (id === CMD) settings['refsToChat.explorerClipboard'] = 'use';
      },
    });
    await run('refsToChat.sendFile', A, [A, B]);
    assert.deepEqual(state.opened, ['/ws/project/a.js', '/ws/project/b.js']);
    assert.deepEqual(state.clipboardWrites, []);
  });
});

// WSL・SSH・Dev Containers では、公式拡張がリモート側にあり、手元の PC で動くこの拡張からは見えない
// それでもコマンドは呼べるので、見えなくても呼んでみる
describe('Remote（公式拡張がリモート側にある）', () => {
  const A = uri('/ws/project/a.js');
  const SRC = uri('/ws/project/src');
  const REMOTE: MockOptions = { remoteName: 'wsl', claudeInRemote: true };
  const REMOTE_NO_CLAUDE: MockOptions = { remoteName: 'wsl', claudeInstalled: false };

  it('エディタ: 見えなくても公式コマンドを呼んで入れる', async () => {
    const { vscode, state, run } = setup(REMOTE);
    vscode.window.activeTextEditor = makeEditor('/ws/project/src/app.ts', makeSelection(4, 0, 9, 1));
    await run('refsToChat.sendSelection');
    assert.deepEqual(state.executed, [FOCUS, CMD]);
    assert.deepEqual(state.clipboardWrites, []);
    assert.deepEqual(state.warnings, []);
  });

  it('エクスプローラー（貼り付け・初期設定）: ファイルとフォルダを貼り付けで入れる', async () => {
    const { state, run } = setup({ ...REMOTE, isFolder: (p) => p === '/ws/project/src' });
    await run('refsToChat.sendFile', A, [A, SRC]);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
    assert.deepEqual(state.clipboardWrites, ['@a.js @src/ ']);
    assert.deepEqual(state.infos, []);
    assert.deepEqual(state.warnings, []);
  });

  it('エクスプローラー（設定 keep）: ファイルを開いて公式コマンドで入れる', async () => {
    const { state, run } = setupOpen(REMOTE);
    await run('refsToChat.sendFile', A);
    assert.deepEqual(state.opened, ['/ws/project/a.js']);
    assert.deepEqual(state.executed, [FOCUS, CMD]);
    assert.deepEqual(state.warnings, []);
  });

  it('公式拡張がどこにもない（エディタ）→ 呼んでみて、見つからないと警告してコピーする', async () => {
    const { vscode, state, run } = setup(REMOTE_NO_CLAUDE);
    vscode.window.activeTextEditor = makeEditor('/ws/project/src/app.ts', makeSelection(4, 0, 9, 1));
    await run('refsToChat.sendSelection');
    assert.deepEqual(state.executed, [FOCUS, CMD]);
    assert.equal(state.clipboard, '@src/app.ts#5-10');
    assert.equal(state.warnings.length, 1);
    assert.ok(state.warnings[0].includes(R.notInstalled));
  });

  it('公式拡張がどこにもない（エクスプローラー）→ 見つからないと警告してコピーする', async () => {
    const { state, run } = setup({ ...REMOTE_NO_CLAUDE, isFolder: (p) => p === '/ws/project/src' });
    await run('refsToChat.sendFile', A, [A, SRC]);
    // 一度貼り付けを試してから、コピーに切り替える
    assert.deepEqual(state.executed, [FOCUS]);
    assert.deepEqual(state.clipboardWrites, ['@a.js @src/ ', '@a.js @src/']);
    assert.equal(state.infos.length, 0);
    assert.equal(state.warnings.length, 1);
    assert.ok(state.warnings[0].includes(R.notInstalled));
  });

  it('公式拡張はあるが公式コマンドが失敗 →「見つからない」ではなく「追加できなかった」と伝える', async () => {
    const { vscode, state, run } = setup({
      ...REMOTE,
      onExecute: (id) => { if (id === CMD) throw new Error('boom'); },
    });
    vscode.window.activeTextEditor = makeEditor('/ws/project/src/app.ts', makeSelection(4, 0, 9, 1));
    await run('refsToChat.sendSelection');
    assert.equal(state.warnings.length, 1);
    assert.ok(state.warnings[0].includes(R.failed));
    assert.ok(!state.warnings[0].includes(R.notInstalled));
  });

  it('公式拡張がどこにもない（設定 keep、ファイルとフォルダ）→ まとめて 1 回コピーし、理由は 1 回だけ書く', async () => {
    const { state, run } = setupOpen({ ...REMOTE_NO_CLAUDE, isFolder: (p) => p === '/ws/project/src' });
    await run('refsToChat.sendFile', A, [A, SRC]);
    assert.deepEqual(state.clipboardWrites, ['@a.js @src/']);
    assert.equal(state.warnings.length, 1);
    assert.deepEqual(state.warnings[0].split('。').slice(0, -1), [R.notInstalled]);
  });

  it('公式コマンドが失敗し、コマンドの一覧も読めない → 見つからないものとして扱う', async () => {
    const { vscode, state, run } = setup({ ...REMOTE_NO_CLAUDE, getCommandsFails: true });
    vscode.window.activeTextEditor = makeEditor('/ws/project/src/app.ts', makeSelection(4, 0, 9, 1));
    await run('refsToChat.sendSelection');
    assert.ok(state.warnings[0].includes(R.notInstalled));
  });

  it('リモートでなければ、見えないときは公式コマンドを呼ばない（今までどおり）', async () => {
    const { state, run } = setup({ claudeInstalled: false });
    await run('refsToChat.sendFile', A);
    assert.deepEqual(state.executed, []);
    assert.ok(state.warnings[0].includes(R.notInstalled));
  });
});

describe('Markdown のプレビューからの送信（sendPreviewSelection）', () => {
  const ID = 'refsToChat.sendPreviewSelection';
  const GUIDE = '/ws/project/docs/guide.md';
  const TEXT = ['# Title', '', 'line A', 'line B', '', '```js', 'code 1', 'code 2', '```'].join('\n');
  const point = (line: number, newlines = 0, code = false) => ({ line, newlines, code });
  // プレビューのスクリプトが data-vscode-context に入れ、VS Code がコマンドの引数に渡すもの
  const arg = (start: object, end: object, source = `file://${GUIDE}`) => ({
    webview: 'vscode.markdown.preview.editor',
    refsToChatPreviewSelection: { source, start, end },
  });
  const opts = { documentText: { [GUIDE]: TEXT } };

  it('元のファイルを開かずに、行の参照を作って貼り付けで入れる', async () => {
    const { state, run } = setup(opts);
    await run(ID, arg(point(2), point(2, 1)));
    assert.deepEqual(state.shown, []);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
    assert.deepEqual(state.clipboardWrites, ['@docs/guide.md#3-4 ']);
    assert.deepEqual(state.warnings, []);
    assert.deepEqual(state.infos, []);
  });

  it('フェンスのコードブロックは、フェンスの次の行から数える', async () => {
    const { state, run } = setup(opts);
    await run(ID, arg(point(5, 1, true), point(5, 1, true)));
    assert.deepEqual(state.clipboardWrites, ['@docs/guide.md#8 ']);
  });

  it('マルチルートでは、先頭にフォルダ名が付く', async () => {
    const file = '/ws/beta/README.md';
    const { state, run } = setup({ workspaceFolders: ['/ws/alpha', '/ws/beta'], documentText: { [file]: 'a\nb' } });
    await run(ID, arg(point(0), point(1), `file://${file}`));
    assert.deepEqual(state.clipboardWrites, ['@beta/README.md#1-2 ']);
  });

  it('公式拡張がない → 貼り付けずにコピーして警告', async () => {
    const { state, run } = setup({ ...opts, claudeInstalled: false });
    await run(ID, arg(point(2), point(2)));
    assert.deepEqual(state.executed, []);
    assert.deepEqual(state.clipboardWrites, ['@docs/guide.md#3']);
    assert.ok(state.warnings[0].includes(R.notInstalled));
  });

  for (const [name, bad] of [
    ['引数がない（キーボードショートカットなどから）', undefined],
    ['プレビューの値がない（選択なし）', { webview: 'markdown.preview' }],
    ['行が数でない', arg({ line: '2', newlines: 0, code: false }, point(2))],
    ['URI がない', arg(point(2), point(2), '')],
  ] as const) {
    it(`${name} → 案内を出して何もしない`, async () => {
      const { state, run } = setup(opts);
      await run(ID, bad);
      assert.deepEqual(state.executed, []);
      assert.deepEqual(state.clipboardWrites, []);
      assert.deepEqual(state.infos, [MESSAGES.noPreviewSelection]);
    });
  }

  it('プレビューの行が元のファイルに収まらない → 案内を出して何もしない', async () => {
    const { state, run } = setup(opts);
    await run(ID, arg(point(2), point(40)));
    assert.deepEqual(state.executed, []);
    assert.deepEqual(state.infos, [MESSAGES.noPreviewSelection]);
  });

  it('元のファイルを読めない → 案内を出して何もしない', async () => {
    const { state, run } = setup({ ...opts, isBinary: (p) => p === GUIDE });
    await run(ID, arg(point(2), point(2)));
    assert.deepEqual(state.executed, []);
    assert.deepEqual(state.infos, [MESSAGES.noPreviewSelection]);
  });
});

describe('Markdown のプレビューからの送信（設定 keep）', () => {
  const ID = 'refsToChat.sendPreviewSelection';
  const GUIDE = '/ws/project/docs/guide.md';
  const TEXT = ['# Title', '', 'line A', 'line B', ''].join('\n');
  const point = (line: number, newlines = 0) => ({ line, newlines, code: false });
  // 3〜4 行目（0 始まりで 2〜3）を選んだときの引数
  const ARG = { refsToChatPreviewSelection: { source: `file://${GUIDE}`, start: point(2), end: point(2, 1) } };
  const setupKeep = (o: MockOptions = {}) =>
    setup({
      ...o,
      documentText: { [GUIDE]: TEXT },
      settings: { 'refsToChat.previewClipboard': 'keep', ...o.settings },
    });

  it('元のファイルを一瞬開き、その行を選んだ状態で公式コマンドを呼び、開いたタブを閉じる', async () => {
    const seen: { file?: string; start: [number, number]; end: [number, number] }[] = [];
    const ctx: { vscode?: ReturnType<typeof setup>['vscode'] } = {};
    const { vscode, state, run } = setupKeep({
      onExecute: (id) => {
        const editor = ctx.vscode?.window.activeTextEditor;
        if (id !== CMD || !editor) return;
        const { start, end } = editor.selection;
        seen.push({ file: editor.document.uri.fsPath, start: [start.line, start.character], end: [end.line, end.character] });
      },
    });
    ctx.vscode = vscode;
    await run(ID, ARG);
    // 3 行目の先頭から 4 行目の末尾（"line B" の 6 文字）まで
    assert.deepEqual(seen, [{ file: GUIDE, start: [2, 0], end: [3, 6] }]);
    assert.deepEqual(state.executed, [FOCUS, CMD]);
    assert.deepEqual(state.closed, [GUIDE]);
    assert.deepEqual(state.clipboardWrites, []);
    assert.deepEqual(state.warnings, []);
  });

  it('元のファイルを別のグループで表示していれば、そのグループで入れ、タブは閉じずに選択を戻す', async () => {
    const original = makeSelection(0, 1, 0, 1);
    const { vscode, state, run } = setupKeep({ otherGroupTabs: [GUIDE] });
    const shownBefore = makeEditor(GUIDE, original);
    shownBefore.viewColumn = 2;
    vscode.window.activeTextEditor = shownBefore;
    vscode.window.activeTextEditor = undefined;
    await run(ID, ARG);
    assert.equal(state.shown[0].options.viewColumn, 2);
    assert.deepEqual(state.closed, []);
    assert.deepEqual(state.editors.get(GUIDE)?.selections, [original]);
  });

  it('元のファイルのタブが今のグループの裏にあれば、閉じずに、前面にあったタブを戻す', async () => {
    const APP = '/ws/project/src/app.js';
    const { state, run } = setupKeep({ openTabs: [GUIDE, APP] });
    await run(ID, ARG);
    assert.deepEqual(state.closed, []);
    assert.equal(state.front.get(1)?.input.uri.fsPath, APP);
  });

  it('公式コマンドが失敗 → 行の参照をコピーして警告', async () => {
    const { state, run } = setupKeep({
      onExecute: (id) => {
        if (id === CMD) throw new Error('boom');
      },
    });
    await run(ID, ARG);
    assert.deepEqual(state.clipboardWrites, ['@docs/guide.md#3-4']);
    assert.ok(state.warnings[0].includes(R.failed));
    assert.deepEqual(state.closed, [GUIDE]);
  });

  it('知らない値が設定されていたら、初期設定の貼り付けとして扱う', async () => {
    const { state, run } = setupKeep({ settings: { 'refsToChat.previewClipboard': 'unknown' } });
    await run(ID, ARG);
    assert.deepEqual(state.shown, []);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
  });
});
