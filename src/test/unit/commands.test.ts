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
const IDS = ['rightClickMention.sendSelection', 'rightClickMention.sendCurrentFile', 'rightClickMention.sendFile'];

// ファイルを一瞬開いて公式コマンドで入れる設定（open）で動かす
// 初期設定は貼り付け（paste）なので、開く動きを確かめるテストはこれを使う
const setupOpen = (o: MockOptions = {}) =>
  setup({ ...o, settings: { 'rightClickMention.explorerFiles': 'open', ...o.settings } });

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
  it('3つのコマンドを登録し、すべて subscriptions に入れる', () => {
    const { state, context } = setup();
    assert.deepEqual([...state.registered.keys()].sort(), [...IDS].sort());
    assert.equal(context.subscriptions.length, 3);
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
  for (const id of ['rightClickMention.sendSelection', 'rightClickMention.sendCurrentFile']) {
    it(`${id}: 公式コマンドを1回だけ呼ぶ`, async () => {
      const { vscode, state, run } = setup();
      vscode.window.activeTextEditor = makeEditor('/ws/project/a.js', makeSelection(1, 0, 3, 2));
      await run(id);
      assert.deepEqual(state.executed, [FOCUS, CMD]);
      assert.equal(state.clipboard, '');
      assert.deepEqual(state.warnings, []);
    });
  }

  it('アクティブなエディタが無い → 案内を出して何もしない', async () => {
    const { state, run } = setup();
    await run('rightClickMention.sendSelection');
    assert.deepEqual(state.executed, []);
    assert.equal(state.clipboard, '');
    assert.equal(state.infos.length, 1);
  });

  it('Claude拡張が無い → 公式コマンドは呼ばずクリップボードへ', async () => {
    const { vscode, state, run } = setup({ claudeInstalled: false });
    vscode.window.activeTextEditor = makeEditor('/ws/project/src/app.ts', makeSelection(4, 0, 9, 1));
    await run('rightClickMention.sendSelection');
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
    await assert.doesNotReject(run('rightClickMention.sendSelection'));
    assert.deepEqual(state.executed, [FOCUS, CMD]);
    assert.equal(state.clipboard, '@src/app.ts#1');
    assert.ok(state.warnings[0].includes(R.failed));
  });

  it('入れる前にチャットを開き、元のエディタを前面に戻す', async () => {
    const { vscode, state, run } = setup();
    vscode.window.activeTextEditor = makeEditor('/ws/project/a.js', makeSelection(1, 0, 3, 2));
    await run('rightClickMention.sendSelection');
    assert.deepEqual(state.executed, [FOCUS, CMD]);
    assert.deepEqual(
      state.shown.map((s) => s.fsPath),
      ['/ws/project/a.js'],
    );
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
    await run('rightClickMention.sendSelection');
    assert.deepEqual(seen, [{ path: '/ws/project/a.js', line: 4, empty: false }]);
  });

  it('チャットを開くのに失敗しても、公式コマンドで入れることは試す', async () => {
    const { vscode, state, run } = setup({
      onExecute: (id) => {
        if (id === FOCUS) throw new Error('no chat');
      },
    });
    vscode.window.activeTextEditor = makeEditor('/ws/project/a.js');
    await run('rightClickMention.sendCurrentFile');
    assert.deepEqual(state.executed, [FOCUS, CMD]);
    assert.deepEqual(state.warnings, []);
  });

  it('マルチルートのフォールバックはフォルダ名付き', async () => {
    const { vscode, state, run } = setup({ claudeInstalled: false, workspaceFolders: ['/ws/alpha', '/ws/beta'] });
    vscode.window.activeTextEditor = makeEditor('/ws/beta/src/app.js', makeSelection(2, 0, 4, 1));
    await run('rightClickMention.sendSelection');
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
    await run('rightClickMention.sendFile', A, undefined);
    assert.deepEqual(state.opened, ['/ws/project/a.js']);
    assert.equal(state.shown.length, 2); // 開く + チャットを開いたあとで前面に戻す
    const o = state.shown[0].options;
    assert.equal(o.preview, false); // プレビューで開くと、ユーザーのプレビューのタブを消してしまう
    assert.equal(o.preserveFocus, false);
    assert.deepEqual(state.executed, [FOCUS, CMD]);
    assert.deepEqual(emptyAtInsert, [true]);
  });

  it('複数選択: 選択した順にすべて送る（右クリックしたファイルは重複させない）', async () => {
    const { state, run } = setupOpen();
    await run('rightClickMention.sendFile', B, [A, B]);
    assert.deepEqual(state.opened, ['/ws/project/a.js', '/ws/project/b.js']);
    assert.deepEqual(state.executed, [FOCUS, CMD, FOCUS, CMD]);
  });

  it('選択配列が空なら右クリックしたファイルを使う', async () => {
    const { state, run } = setupOpen();
    await run('rightClickMention.sendFile', A, []);
    assert.deepEqual(state.opened, ['/ws/project/a.js']);
  });

  it('引数が何も無い（パレット等から）→ 何もしない', async () => {
    const { state, run } = setupOpen();
    await run('rightClickMention.sendFile');
    assert.deepEqual(state.opened, []);
    assert.deepEqual(state.executed, []);
  });

  it('配列に undefined が混ざっても無視する', async () => {
    const { state, run } = setupOpen();
    await run('rightClickMention.sendFile', undefined, [undefined, A]);
    assert.deepEqual(state.opened, ['/ws/project/a.js']);
  });

  it('テキストで開けないファイル → @path をコピーし、チャットに貼り付ける', async () => {
    const { state, run } = setupOpen({ isBinary: (p) => p.endsWith('.png') });
    await run('rightClickMention.sendFile', IMG);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
    assert.equal(state.clipboard, '@logo.png');
    assert.deepEqual(state.warnings, []);
    assert.equal(state.infos[0], MESSAGES.pasted('@logo.png'));
  });

  it('開けないファイルが混ざっても残りは送り、開けないものは最後に貼り付ける', async () => {
    const { state, run } = setupOpen({ isBinary: (p) => p.endsWith('.png') });
    await run('rightClickMention.sendFile', A, [A, IMG, B]);
    assert.deepEqual(state.executed, [FOCUS, CMD, FOCUS, CMD, FOCUS, PASTE]);
    assert.deepEqual(state.clipboardWrites, ['@logo.png']);
  });

  it('開けたファイルで公式コマンドが失敗 →「追加できなかった」として扱い、「開けない」と取り違えない', async () => {
    const { state, run } = setupOpen({ onExecute: () => { throw new Error('boom'); } });
    await run('rightClickMention.sendFile', A);
    assert.deepEqual(state.clipboardWrites, ['@a.js']);
    assert.equal(state.warnings.length, 1);
    assert.ok(state.warnings[0].includes(R.failed));
    assert.ok(!state.warnings[0].includes(R.notText));
  });

  it('Claude拡張が無い → 全部の参照をまとめて 1 回でコピーし、警告も 1 回', async () => {
    const { state, run } = setupOpen({ claudeInstalled: false });
    await run('rightClickMention.sendFile', A, [A, B]);
    assert.deepEqual(state.clipboardWrites, ['@a.js @b.js']);
    assert.equal(state.warnings.length, 1);
    assert.ok(state.warnings[0].includes(R.notInstalled));
  });

  it('フォルダ → @src/ をコピーし、入力欄にフォーカスして貼り付ける（ファイルとしては開かない）', async () => {
    const SRC = uri('/ws/project/src');
    const { state, run } = setupOpen({ isFolder: (p) => p === '/ws/project/src' });
    await run('rightClickMention.sendFile', SRC);
    assert.deepEqual(state.opened, []);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
    assert.deepEqual(state.clipboardWrites, ['@src/']);
    assert.deepEqual(state.warnings, []);
    assert.equal(state.infos.length, 1);
    assert.match(state.infos[0], /@src\//);
  });

  it('フォルダで貼り付けに失敗 → コピーしたまま警告を 1 回（貼り付けたとは言わない）', async () => {
    const SRC = uri('/ws/project/src');
    const { state, run } = setupOpen({
      isFolder: (p) => p === '/ws/project/src',
      onExecute: (id) => { if (id === FOCUS) throw new Error('no focus'); },
    });
    await run('rightClickMention.sendFile', SRC);
    assert.equal(state.clipboard, '@src/');
    assert.equal(state.warnings.length, 1);
    assert.ok(state.warnings[0].includes(R.folder));
    assert.deepEqual(state.infos, []);
  });

  it('フォーカスは移ったが貼り付けに失敗 → コピーしたまま警告を 1 回', async () => {
    const SRC = uri('/ws/project/src');
    const { state, run } = setupOpen({
      isFolder: (p) => p === '/ws/project/src',
      onExecute: (id) => { if (id === PASTE) throw new Error('paste failed'); },
    });
    await run('rightClickMention.sendFile', SRC);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
    assert.equal(state.clipboard, '@src/');
    assert.equal(state.warnings.length, 1);
    assert.deepEqual(state.infos, []);
  });

  it('Claude拡張が無いときは、フォルダでも貼り付けを試さず、拡張が無いことを伝える', async () => {
    const SRC = uri('/ws/project/src');
    const { state, run } = setupOpen({ claudeInstalled: false, isFolder: (p) => p === '/ws/project/src' });
    await run('rightClickMention.sendFile', SRC);
    assert.deepEqual(state.executed, []);
    assert.deepEqual(state.clipboardWrites, ['@src/']);
    assert.equal(state.warnings.length, 1);
    assert.ok(state.warnings[0].includes(R.notInstalled));
  });

  it('フォルダへのシンボリックリンクもフォルダとして扱う', async () => {
    const LINK = uri('/ws/project/linked');
    const { state, run } = setupOpen({ isSymlinkFolder: (p) => p === '/ws/project/linked' });
    await run('rightClickMention.sendFile', LINK);
    assert.deepEqual(state.opened, []);
    assert.deepEqual(state.clipboardWrites, ['@linked/']);
  });

  it('フォルダか調べられない → ファイルとして開いて送る', async () => {
    const { state, run } = setupOpen({ statFails: (p) => p === '/ws/project/a.js' });
    await run('rightClickMention.sendFile', A);
    assert.deepEqual(state.opened, ['/ws/project/a.js']);
    assert.deepEqual(state.executed, [FOCUS, CMD]);
  });

  it('エディタで表示できないファイルがあっても止まらず、残りと後回しの分を届ける', async () => {
    const SRC = uri('/ws/project/src');
    const { state, run } = setupOpen({
      isFolder: (p) => p === '/ws/project/src',
      showFails: (p) => p === '/ws/project/a.js',
    });
    await assert.doesNotReject(run('rightClickMention.sendFile', A, [SRC, A, B]));
    assert.deepEqual(state.executed, [FOCUS, CMD, FOCUS, PASTE]); // B は送り、src と a.js は貼り付け
    assert.deepEqual(state.clipboardWrites, ['@src/ @a.js']);
  });

  it('同じ理由は 1 回だけ、最初に出た順で警告に書く', async () => {
    const SRC = uri('/ws/project/src');
    const DOCS = uri('/ws/project/docs');
    const { state, run } = setupOpen({
      claudeInstalled: false,
      isFolder: (p) => p === '/ws/project/src' || p === '/ws/project/docs',
    });
    await run('rightClickMention.sendFile', SRC, [SRC, A, DOCS]);
    const reasons = state.warnings[0].split('。').slice(0, -1);
    assert.deepEqual(reasons, [R.notInstalled, R.folder]);
  });

  it('ファイルとフォルダの混在 → ファイルは送り、フォルダだけまとめてコピー', async () => {
    const SRC = uri('/ws/project/src');
    const DOCS = uri('/ws/project/docs');
    const { state, run } = setupOpen({ isFolder: (p) => p === '/ws/project/src' || p === '/ws/project/docs' });
    await run('rightClickMention.sendFile', A, [SRC, A, DOCS]);
    assert.deepEqual(state.opened, ['/ws/project/a.js']);
    assert.deepEqual(state.executed, [FOCUS, CMD, FOCUS, PASTE]);
    assert.deepEqual(state.clipboardWrites, ['@src/ @docs/']);
    assert.equal(state.infos.length, 1);
  });

  it('理由が違うものが混ざっても、コピーも警告も 1 回で、理由は全部書く', async () => {
    const SRC = uri('/ws/project/src');
    const { state, run } = setupOpen({
      claudeInstalled: false,
      isFolder: (p) => p === '/ws/project/src',
      isBinary: (p) => p.endsWith('.png'),
    });
    await run('rightClickMention.sendFile', A, [A, SRC, IMG]);
    assert.deepEqual(state.clipboardWrites, ['@a.js @src/ @logo.png']);
    assert.equal(state.warnings.length, 1);
    assert.ok(state.warnings[0].includes(R.notInstalled));
    assert.ok(state.warnings[0].includes(R.folder));
    assert.ok(state.warnings[0].includes(R.notText));
  });

  it('名前に改行などを含む参照は、貼り付けずにコピーだけする（貼り付けがターミナルに入ると危ない）', async () => {
    const ODD = uri('/ws/project/odd\nname');
    const { state, run } = setupOpen({ isFolder: (p) => p === '/ws/project/odd\nname' });
    await run('rightClickMention.sendFile', ODD);
    assert.deepEqual(state.executed, []); // フォーカスも貼り付けも呼ばない
    assert.deepEqual(state.clipboardWrites, ['@odd\nname/']);
    assert.equal(state.warnings.length, 1);
  });

  it('全部チャットに送れたら、クリップボードには触らない', async () => {
    const { state, run } = setupOpen();
    await run('rightClickMention.sendFile', A, [A, B]);
    assert.deepEqual(state.clipboardWrites, []);
    assert.deepEqual(state.warnings, []);
  });

  it('マルチルートの別フォルダのファイル', async () => {
    const { state, run } = setupOpen({ claudeInstalled: false, workspaceFolders: ['/ws/alpha', '/ws/beta'] });
    await run('rightClickMention.sendFile', uri('/ws/beta/src/only-in-beta.js'));
    assert.equal(state.clipboard, '@beta/src/only-in-beta.js');
  });
});

describe('エクスプローラーから送るときに開いたタブ', () => {
  const A = uri('/ws/project/a.js');
  const B = uri('/ws/project/b.js');
  const tabPaths = (tabs: { input: { uri: { fsPath: string } } }[]) => tabs.map((t) => t.input.uri.fsPath);

  it('参照を作るために開いたタブは、チャットに入れたあとで閉じる', async () => {
    const { state, run } = setupOpen();
    await run('rightClickMention.sendFile', A);
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
    await run('rightClickMention.sendFile', A);
    assert.deepEqual(tabsAtInsert, [['/ws/project/a.js']]);
    assert.deepEqual(state.tabs, []);
  });

  it('もともと開いていたファイルのタブは閉じない', async () => {
    const { state, run } = setupOpen({ openTabs: ['/ws/project/a.js'] });
    await run('rightClickMention.sendFile', A, [A, B]);
    assert.deepEqual(state.executed, [FOCUS, CMD, FOCUS, CMD]);
    assert.deepEqual(state.closed, ['/ws/project/b.js']);
    assert.deepEqual(tabPaths(state.tabs), ['/ws/project/a.js']);
  });

  it('公式拡張が無くてコピーに回ったときも、開いたタブは閉じる', async () => {
    const { state, run } = setupOpen({ claudeInstalled: false });
    await run('rightClickMention.sendFile', A, [A, B]);
    assert.deepEqual(state.clipboardWrites, ['@a.js @b.js']);
    assert.deepEqual(state.tabs, []);
  });

  it('タブを閉じられなくても、残りのファイルは送る（タブは残り、通知もコピーもしない）', async () => {
    const { state, run } = setupOpen({ closeFails: true });
    await assert.doesNotReject(run('rightClickMention.sendFile', A, [A, B]));
    assert.deepEqual(state.executed, [FOCUS, CMD, FOCUS, CMD]);
    assert.deepEqual(state.closed, []);
    assert.deepEqual(tabPaths(state.tabs), ['/ws/project/a.js', '/ws/project/b.js']);
    assert.deepEqual(state.warnings, []);
    assert.deepEqual(state.clipboardWrites, []);
  });

  it('タブを閉じるときは、フォーカスを今の場所に保つ', async () => {
    const { state, run } = setupOpen();
    await run('rightClickMention.sendFile', A);
    assert.deepEqual(state.closePreserveFocus, [true]);
  });

  it('別のエディタグループにだけ開いていたファイルは、今のグループにできたタブを閉じる', async () => {
    const { state, run } = setupOpen({ otherGroupTabs: ['/ws/project/a.js'] });
    await run('rightClickMention.sendFile', A);
    assert.deepEqual(state.tabs, []);
    assert.deepEqual(tabPaths(state.otherTabs), ['/ws/project/a.js']);
  });

  it('パスの大文字小文字だけ違っても、もともと開いていたタブは閉じない（Windows）', async () => {
    // エクスプローラーからは小文字、開いているドキュメントは大文字の App.ts
    const { state, run } = setupOpen({
      openTabs: ['/ws/project/App.ts'],
      documentPath: (p) => (p.toLowerCase() === '/ws/project/app.ts' ? '/ws/project/App.ts' : p),
    });
    await run('rightClickMention.sendFile', uri('/ws/project/app.ts'));
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
    await run('rightClickMention.sendFile', A, [A, B]);
    assert.deepEqual(seen, ['/ws/project/a.js', '/ws/project/b.js']);
    assert.deepEqual(state.tabs, []);
  });

  it('もともと開いていたファイルは、送ったあとで選択（カーソル位置）を元に戻す', async () => {
    const sel = makeSelection(4, 2, 9, 7);
    const { state, run } = setupOpen({ openTabs: ['/ws/project/a.js'], selections: { '/ws/project/a.js': sel } });
    await run('rightClickMention.sendFile', A);
    const editor = state.editors.get('/ws/project/a.js');
    assert.ok(editor);
    assert.deepEqual(editor.selections, [sel]);
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
    await run('rightClickMention.sendFile', A);
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
    await run('rightClickMention.sendFile', SRC, [SRC, IMG]);
    assert.deepEqual(state.closed, []);
    assert.deepEqual(tabPaths(state.tabs), ['/ws/project/other.js']);
  });

  it('エディタの右クリックでは、タブを閉じない', async () => {
    const { vscode, state, run } = setupOpen({ openTabs: ['/ws/project/a.js'] });
    vscode.window.activeTextEditor = makeEditor('/ws/project/a.js', makeSelection(1, 0, 3, 2));
    await run('rightClickMention.sendSelection');
    assert.deepEqual(state.closed, []);
  });
});

describe('エクスプローラーから送るファイル（貼り付けの設定・初期設定）', () => {
  const A = uri('/ws/project/a.js');
  const B = uri('/ws/project/b.js');

  it('初期設定では、ファイルを開かずに貼り付けで入れる', async () => {
    const { state, run } = setup();
    await run('rightClickMention.sendFile', A);
    assert.deepEqual(state.opened, []);
    assert.deepEqual(state.shown, []);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
    assert.deepEqual(state.clipboardWrites, ['@a.js']);
    assert.equal(state.infos[0], MESSAGES.pasted('@a.js'));
  });

  it('設定に paste と書いても同じ', async () => {
    const { state, run } = setup({ settings: { 'rightClickMention.explorerFiles': 'paste' } });
    await run('rightClickMention.sendFile', A);
    assert.deepEqual(state.opened, []);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
  });

  it('知らない値が設定されていたら、初期設定の貼り付けとして扱う', async () => {
    const { state, run } = setup({ settings: { 'rightClickMention.explorerFiles': 'unknown' } });
    await run('rightClickMention.sendFile', A);
    assert.deepEqual(state.opened, []);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
  });

  it('複数のファイルとフォルダは、選んだ順にまとめて 1 回で貼り付ける', async () => {
    const SRC = uri('/ws/project/src');
    const { state, run } = setup({ isFolder: (p) => p === '/ws/project/src' });
    await run('rightClickMention.sendFile', A, [A, SRC, B]);
    assert.deepEqual(state.opened, []);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
    assert.deepEqual(state.clipboardWrites, ['@a.js @src/ @b.js']);
    assert.equal(state.infos.length, 1);
  });

  it('タブには触らない（開きも閉じもしない）', async () => {
    const { state, run } = setup({ openTabs: ['/ws/project/a.js'] });
    await run('rightClickMention.sendFile', A, [A, B]);
    assert.deepEqual(state.closed, []);
    assert.deepEqual(state.shown, []);
  });

  it('画像などのファイルも、開こうとせずに貼り付ける', async () => {
    const IMG = uri('/ws/project/logo.png');
    const { state, run } = setup({ isBinary: (p) => p.endsWith('.png') });
    await run('rightClickMention.sendFile', IMG);
    assert.deepEqual(state.opened, []);
    assert.deepEqual(state.clipboardWrites, ['@logo.png']);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
  });

  it('貼り付けに失敗したら、コピーしたまま警告を 1 回出す', async () => {
    const { state, run } = setup({
      onExecute: (id) => {
        if (id === PASTE) throw new Error('paste failed');
      },
    });
    await run('rightClickMention.sendFile', A);
    assert.equal(state.clipboard, '@a.js');
    assert.equal(state.warnings.length, 1);
    assert.ok(state.warnings[0].includes(R.pasteFile));
    assert.deepEqual(state.infos, []);
  });

  it('公式拡張がないときは、貼り付けずにコピーし、拡張がないことを伝える', async () => {
    const { state, run } = setup({ claudeInstalled: false });
    await run('rightClickMention.sendFile', A, [A, B]);
    assert.deepEqual(state.executed, []);
    assert.deepEqual(state.clipboardWrites, ['@a.js @b.js']);
    assert.ok(state.warnings[0].includes(R.notInstalled));
  });

  it('名前に改行を含むファイルは、貼り付けずにコピーだけする', async () => {
    const ODD = uri('/ws/project/odd\nname.js');
    const { state, run } = setup();
    await run('rightClickMention.sendFile', ODD);
    assert.deepEqual(state.executed, []);
    assert.deepEqual(state.clipboardWrites, ['@odd\nname.js']);
    assert.equal(state.warnings.length, 1);
  });

  it('エディタの右クリックは、設定に関係なく公式コマンドで入れる', async () => {
    const { vscode, state, run } = setup({ settings: { 'rightClickMention.explorerFiles': 'paste' } });
    vscode.window.activeTextEditor = makeEditor('/ws/project/a.js', makeSelection(1, 0, 3, 2));
    await run('rightClickMention.sendSelection');
    assert.deepEqual(state.executed, [FOCUS, CMD]);
    assert.deepEqual(state.clipboardWrites, []);
  });
});
