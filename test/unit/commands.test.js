// コマンドの登録と、送信・フォールバックの分岐のテスト
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, makeEditor, makeSelection, uri } = require('../helpers/vscode-mock');

const CMD = 'claude-vscode.insertAtMention';
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

  it('テキストで開けないファイル → @path をコピーして警告', async () => {
    const { state, run } = setup({ isBinary: (p) => p.endsWith('.png') });
    await run('rightClickMention.sendFile', IMG);
    assert.deepEqual(state.executed, []);
    assert.equal(state.clipboard, '@logo.png');
    assert.match(state.warnings[0], /テキストとして開けない/);
  });

  it('開けないファイルが混ざっても残りは送る', async () => {
    const { state, run } = setup({ isBinary: (p) => p.endsWith('.png') });
    await run('rightClickMention.sendFile', A, [A, IMG, B]);
    assert.deepEqual(state.executed, [CMD, CMD]);
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

  it('Claude拡張が無い → 各ファイルの参照をコピー（最後のものが残る）', async () => {
    const { state, run } = setup({ claudeInstalled: false });
    await run('rightClickMention.sendFile', A, [A, B]);
    assert.deepEqual(state.clipboardWrites, ['@a.js', '@b.js']);
    assert.equal(state.clipboard, '@b.js');
  });

  it('マルチルートの別フォルダのファイル', async () => {
    const { state, run } = setup({ claudeInstalled: false, workspaceFolders: ['/ws/alpha', '/ws/beta'] });
    await run('rightClickMention.sendFile', uri('/ws/beta/src/only-in-beta.js'));
    assert.equal(state.clipboard, '@beta/src/only-in-beta.js');
  });
});
