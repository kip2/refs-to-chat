// 参照文字列（@path#start-end）の組み立てとパス形式のテスト
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { setup, makeEditor, makeSelection, Range } = require('../helpers/vscode-mock');

function ref(sel, { file = '/ws/project/src/app.ts', folders } = {}) {
  const { ext } = setup({ workspaceFolders: folders });
  return ext._internal.buildReference(makeEditor(file, sel));
}

describe('buildReference: 行番号', () => {
  it('選択なし → ファイルだけ', () => {
    assert.equal(ref(new Range(3, 5, 3, 5)), '@src/app.ts');
  });

  it('selection が undefined でもファイルだけ', () => {
    const { ext } = setup();
    assert.equal(ext._internal.buildReference({ document: makeEditor('/ws/project/a.js').document }), '@a.js');
  });

  it('1行の一部 → #行', () => {
    assert.equal(ref(makeSelection(7, 2, 7, 9)), '@src/app.ts#8');
  });

  it('複数行 → #開始-終了（1始まり）', () => {
    assert.equal(ref(makeSelection(4, 0, 9, 3)), '@src/app.ts#5-10');
  });

  it('次の行の先頭で終わる選択は最終行を含めない', () => {
    assert.equal(ref(makeSelection(4, 0, 10, 0)), '@src/app.ts#5-10');
  });

  it('1行まるごと（次行の先頭まで）→ #行', () => {
    assert.equal(ref(makeSelection(4, 0, 5, 0)), '@src/app.ts#5');
  });

  it('下から上へ選択しても同じ結果', () => {
    assert.equal(ref(makeSelection(9, 3, 4, 0)), '@src/app.ts#5-10');
  });

  it('1行目', () => {
    assert.equal(ref(makeSelection(0, 0, 0, 4)), '@src/app.ts#1');
  });

  it('同じ行の途中で終わる場合は行を減らさない', () => {
    assert.equal(ref(makeSelection(4, 3, 9, 1)), '@src/app.ts#5-10');
  });
});

describe('relPath / buildReference: パス形式', () => {
  it('単一フォルダ → フォルダ名なし', () => {
    assert.equal(ref(makeSelection(0, 0, 0, 1), { file: '/ws/project/src/app.ts' }), '@src/app.ts#1');
  });

  it('マルチルート → 先頭にフォルダ名', () => {
    const folders = ['/ws/alpha', '/ws/beta'];
    assert.equal(ref(makeSelection(2, 0, 4, 1), { file: '/ws/beta/src/app.js', folders }), '@beta/src/app.js#3-5');
    assert.equal(ref(makeSelection(2, 0, 4, 1), { file: '/ws/alpha/src/app.js', folders }), '@alpha/src/app.js#3-5');
  });

  it('マルチルートで別の場所にあるフォルダ', () => {
    const folders = ['/ws/alpha', '/other/drive/gamma'];
    assert.equal(ref(new Range(0, 0, 0, 0), { file: '/other/drive/gamma/src/g.js', folders }), '@gamma/src/g.js');
  });

  it('入れ子のフォルダは内側のフォルダ名になる', () => {
    const folders = ['/ws/alpha', '/ws/alpha/nested'];
    assert.equal(ref(new Range(0, 0, 0, 0), { file: '/ws/alpha/nested/src/n.js', folders }), '@nested/src/n.js');
  });

  it('ワークスペース外のファイル → 絶対パス', () => {
    assert.equal(ref(new Range(0, 0, 0, 0), { file: '/tmp/outside.txt' }), '@/tmp/outside.txt');
  });

  it('relPath は asRelativePath に第2引数を渡さない（公式拡張と同じ扱い）', () => {
    const { vscode, ext } = setup();
    const calls = [];
    const orig = vscode.workspace.asRelativePath;
    vscode.workspace.asRelativePath = (...args) => { calls.push(args.length); return orig(...args); };
    ext._internal.relPath({ fsPath: '/ws/project/x.js' });
    assert.deepEqual(calls, [1]);
  });
});
