// 参照のパス形式のテスト
// 公式拡張なしで実行し、クリップボードの中身で確かめる
// パスの計算はモックの asRelativePath なので、本物の動きは統合テストで確かめる

import * as assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { makeEditor, makeSelection, Range, setup } from '../helpers/vscodeMock';

// 失敗時の console.error をテスト出力に出さない
let origError: typeof console.error;
beforeEach(() => {
  origError = console.error;
  console.error = () => {};
});
afterEach(() => {
  console.error = origError;
});

async function ref(file: string, sel: Range, folders?: string[]): Promise<string> {
  const { vscode, state, run } = setup({ claudeInstalled: false, workspaceFolders: folders });
  vscode.window.activeTextEditor = makeEditor(file, sel);
  await run('rightClickMention.sendSelection');
  return state.clipboard;
}

describe('参照のパス形式', () => {
  it('単一フォルダ → フォルダ名なし', async () => {
    assert.equal(await ref('/ws/project/src/app.ts', makeSelection(0, 0, 0, 1)), '@src/app.ts#1');
  });

  it('マルチルート → 先頭にフォルダ名', async () => {
    const folders = ['/ws/alpha', '/ws/beta'];
    assert.equal(await ref('/ws/beta/src/app.js', makeSelection(2, 0, 4, 1), folders), '@beta/src/app.js#3-5');
    assert.equal(await ref('/ws/alpha/src/app.js', makeSelection(2, 0, 4, 1), folders), '@alpha/src/app.js#3-5');
  });

  it('マルチルートで別の場所にあるフォルダ', async () => {
    const folders = ['/ws/alpha', '/other/drive/gamma'];
    assert.equal(await ref('/other/drive/gamma/src/g.js', new Range(0, 0, 0, 0), folders), '@gamma/src/g.js');
  });

  it('入れ子のフォルダは内側のフォルダ名になる', async () => {
    const folders = ['/ws/alpha', '/ws/alpha/nested'];
    assert.equal(await ref('/ws/alpha/nested/src/n.js', new Range(0, 0, 0, 0), folders), '@nested/src/n.js');
  });

  it('ワークスペース外のファイル → 絶対パス', async () => {
    assert.equal(await ref('/tmp/outside.txt', new Range(0, 0, 0, 0)), '@/tmp/outside.txt');
  });

  it('asRelativePath に第2引数を渡さない（公式拡張と同じ扱い）', async () => {
    const { vscode, run } = setup({ claudeInstalled: false });
    const argCounts: number[] = [];
    const orig = vscode.workspace.asRelativePath;
    vscode.workspace.asRelativePath = (...args: Parameters<typeof orig>) => {
      argCounts.push(args.length);
      return orig(...args);
    };
    vscode.window.activeTextEditor = makeEditor('/ws/project/x.js');
    await run('rightClickMention.sendCurrentFile');
    assert.deepEqual(argCounts, [1]);
  });
});
