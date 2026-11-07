// コマンドの登録と、送信・フォールバックの分岐のテスト
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, makeEditor, makeSelection, uri } = require('../helpers/vscode-mock');

const CMD = 'claude-vscode.insertAtMention';
const FOCUS = 'claude-vscode.focus';
const PASTE = 'editor.action.clipboardPasteAction';
const IDS = ['rightClickMention.sendSelection', 'rightClickMention.sendCurrentFile', 'rightClickMention.sendFile'];

// 失敗時の console.error をテスト出力に出さない
let origError;
beforeEach(() => { origError = console.error; console.error = () => {}; });
afterEach(() => { console.error = origError; });

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
    const { ext } = setup();
    assert.equal(ext._internal.CLAUDE_CMD, CMD);
    assert.equal(ext._internal.CLAUDE_EXT_ID, 'anthropic.claude-code');
  });
});

describe('エディタからの送信（sendSelection / sendCurrentFile）', () => {
  for (const id of ['rightClickMention.sendSelection', 'rightClickMention.sendCurrentFile']) {
    it(`${id}: 公式コマンドを1回だけ呼ぶ`, async () => {
      const { vscode, state, run } = setup();
      vscode.window.activeTextEditor = makeEditor('/ws/project/a.js', makeSelection(1, 0, 3, 2));
      await run(id);
      assert.deepEqual(state.executed, [CMD]);
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
    assert.match(state.warnings[0], /見つかりません/);
    assert.match(state.warnings[0], /@src\/app\.ts#5-10/);
  });

  it('公式コマンドが例外 → クリップボードへ（例外は外に出さない）', async () => {
    const { vscode, state, run } = setup({ onExecute: () => { throw new Error('command not found'); } });
    vscode.window.activeTextEditor = makeEditor('/ws/project/src/app.ts', makeSelection(0, 0, 0, 3));
    await assert.doesNotReject(run('rightClickMention.sendSelection'));
    assert.deepEqual(state.executed, [CMD]);
    assert.equal(state.clipboard, '@src/app.ts#1');
    assert.match(state.warnings[0], /失敗/);
  });

  it('公式コマンドが非同期で reject しても同様にフォールバック', async () => {
    const { vscode, state, run } = setup({ onExecute: async () => { throw new Error('boom'); } });
    vscode.window.activeTextEditor = makeEditor('/ws/project/b.js');
    await run('rightClickMention.sendCurrentFile');
    assert.equal(state.clipboard, '@b.js');
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

  it('1ファイル: 開いて（選択なし・フォーカスあり）公式コマンドを呼ぶ', async () => {
    const { state, run } = setup();
    await run('rightClickMention.sendFile', A, undefined);
    assert.deepEqual(state.opened, ['/ws/project/a.js']);
    assert.equal(state.shown.length, 1);
    const o = state.shown[0].options;
    assert.equal(o.preview, true);
    assert.equal(o.preserveFocus, false);
    assert.ok(o.selection.isEmpty);
    assert.equal(o.selection.start.line, 0);
    assert.deepEqual(state.executed, [CMD]);
  });

  it('複数選択: 選択した順にすべて送る（右クリックしたファイルは重複させない）', async () => {
    const { state, run } = setup();
    await run('rightClickMention.sendFile', B, [A, B]);
    assert.deepEqual(state.opened, ['/ws/project/a.js', '/ws/project/b.js']);
    assert.deepEqual(state.executed, [CMD, CMD]);
  });

  it('選択配列が空なら右クリックしたファイルを使う', async () => {
    const { state, run } = setup();
    await run('rightClickMention.sendFile', A, []);
    assert.deepEqual(state.opened, ['/ws/project/a.js']);
  });

  it('引数が何も無い（パレット等から）→ 何もしない', async () => {
    const { state, run } = setup();
    await run('rightClickMention.sendFile');
    assert.deepEqual(state.opened, []);
    assert.deepEqual(state.executed, []);
  });

  it('配列に undefined が混ざっても無視する', async () => {
    const { state, run } = setup();
    await run('rightClickMention.sendFile', undefined, [undefined, A]);
    assert.deepEqual(state.opened, ['/ws/project/a.js']);
  });

  it('テキストで開けないファイル → @path をコピーし、チャットに貼り付ける', async () => {
    const { state, run } = setup({ isBinary: (p) => p.endsWith('.png') });
    await run('rightClickMention.sendFile', IMG);
    assert.deepEqual(state.executed, [FOCUS, PASTE]);
    assert.equal(state.clipboard, '@logo.png');
    assert.deepEqual(state.warnings, []);
    assert.match(state.infos[0], /チャットに貼り付けました/);
  });

  it('開けないファイルが混ざっても残りは送り、開けないものは最後に貼り付ける', async () => {
    const { state, run } = setup({ isBinary: (p) => p.endsWith('.png') });
    await run('rightClickMention.sendFile', A, [A, IMG, B]);
    assert.deepEqual(state.executed, [CMD, CMD, FOCUS, PASTE]);
    assert.deepEqual(state.clipboardWrites, ['@logo.png']);
  });

  it('開けたファイルで公式コマンドが失敗 →「送信に失敗」として扱い、「開けない」と取り違えない', async () => {
    const { state, run } = setup({ onExecute: () => { throw new Error('boom'); } });
    await run('rightClickMention.sendFile', A);
    assert.deepEqual(state.clipboardWrites, ['@a.js']);
    assert.equal(state.warnings.length, 1);
    assert.match(state.warnings[0], /送信に失敗/);
    assert.doesNotMatch(state.warnings[0], /テキストとして開けない/);
  });

  it('Claude拡張が無い → 全部の参照をまとめて 1 回でコピーし、警告も 1 回', async () => {
    const { state, run } = setup({ claudeInstalled: false });
    await run('rightClickMention.sendFile', A, [A, B]);
    assert.deepEqual(state.clipboardWrites, ['@a.js @b.js']);
    assert.equal(state.warnings.length, 1);
    assert.match(state.warnings[0], /Claude Code拡張が見つかりません/);
  });

  it('フォルダ → @src/ をコピーし、入力欄にフォーカスして貼り付ける（ファイルとしては開かない）', async () => {
    const SRC = uri('/ws/project/src');
    const { state, run } = setup({ isFolder: (p) => p === '/ws/project/src' });
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
    const { state, run } = setup({
      isFolder: (p) => p === '/ws/project/src',
      onExecute: (id) => { if (id === FOCUS) throw new Error('no focus'); },
    });
    await run('rightClickMention.sendFile', SRC);
    assert.equal(state.clipboard, '@src/');
    assert.equal(state.warnings.length, 1);
    assert.match(state.warnings[0], /フォルダ/);
    assert.deepEqual(state.infos, []);
  });

  it('Claude拡張が無いときは、フォルダでも貼り付けを試さない', async () => {
    const SRC = uri('/ws/project/src');
    const { state, run } = setup({ claudeInstalled: false, isFolder: (p) => p === '/ws/project/src' });
    await run('rightClickMention.sendFile', SRC);
    assert.deepEqual(state.executed, []);
    assert.deepEqual(state.clipboardWrites, ['@src/']);
    assert.equal(state.warnings.length, 1);
  });

  it('ファイルとフォルダの混在 → ファイルは送り、フォルダだけまとめてコピー', async () => {
    const SRC = uri('/ws/project/src');
    const DOCS = uri('/ws/project/docs');
    const { state, run } = setup({ isFolder: (p) => p === '/ws/project/src' || p === '/ws/project/docs' });
    await run('rightClickMention.sendFile', A, [SRC, A, DOCS]);
    assert.deepEqual(state.opened, ['/ws/project/a.js']);
    assert.deepEqual(state.executed, [CMD, FOCUS, PASTE]);
    assert.deepEqual(state.clipboardWrites, ['@src/ @docs/']);
    assert.equal(state.infos.length, 1);
  });

  it('理由が違うものが混ざっても、コピーも警告も 1 回で、理由は全部書く', async () => {
    const SRC = uri('/ws/project/src');
    const { state, run } = setup({
      claudeInstalled: false,
      isFolder: (p) => p === '/ws/project/src',
      isBinary: (p) => p.endsWith('.png'),
    });
    await run('rightClickMention.sendFile', A, [A, SRC, IMG]);
    assert.deepEqual(state.clipboardWrites, ['@a.js @src/ @logo.png']);
    assert.equal(state.warnings.length, 1);
    assert.match(state.warnings[0], /Claude Code拡張が見つかりません/);
    assert.match(state.warnings[0], /フォルダ/);
    assert.match(state.warnings[0], /テキストとして開けない/);
  });

  it('全部チャットに送れたら、クリップボードには触らない', async () => {
    const { state, run } = setup();
    await run('rightClickMention.sendFile', A, [A, B]);
    assert.deepEqual(state.clipboardWrites, []);
    assert.deepEqual(state.warnings, []);
  });

  it('マルチルートの別フォルダのファイル', async () => {
    const { state, run } = setup({ claudeInstalled: false, workspaceFolders: ['/ws/alpha', '/ws/beta'] });
    await run('rightClickMention.sendFile', uri('/ws/beta/src/only-in-beta.js'));
    assert.equal(state.clipboard, '@beta/src/only-in-beta.js');
  });
});
