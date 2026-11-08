// 参照の文字列（@path#start-end）を作る処理のテスト
// reference.ts は vscode に依存しないので、モックなしで直接読み込む

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileReference, folderReference, joinReferences, linesReference } from '../../reference';
import { makeSelection, Range } from '../helpers/vscodeMock';

const PATH = 'src/app.ts';

describe('fileReference: 行番号', () => {
  it('選択なし → ファイルだけ', () => {
    assert.equal(fileReference(PATH, new Range(3, 5, 3, 5)), '@src/app.ts');
  });

  it('選択を渡さない → ファイルだけ', () => {
    assert.equal(fileReference(PATH), '@src/app.ts');
  });

  it('1行の一部 → #行', () => {
    assert.equal(fileReference(PATH, makeSelection(7, 2, 7, 9)), '@src/app.ts#8');
  });

  it('複数行 → #開始-終了（1始まり）', () => {
    assert.equal(fileReference(PATH, makeSelection(4, 0, 9, 3)), '@src/app.ts#5-10');
  });

  it('次の行の先頭で終わる選択は最終行を含めない', () => {
    assert.equal(fileReference(PATH, makeSelection(4, 0, 10, 0)), '@src/app.ts#5-10');
  });

  it('1行まるごと（次行の先頭まで）→ #行', () => {
    assert.equal(fileReference(PATH, makeSelection(4, 0, 5, 0)), '@src/app.ts#5');
  });

  it('下から上へ選択しても同じ結果', () => {
    assert.equal(fileReference(PATH, makeSelection(9, 3, 4, 0)), '@src/app.ts#5-10');
  });

  it('1行目', () => {
    assert.equal(fileReference(PATH, makeSelection(0, 0, 0, 4)), '@src/app.ts#1');
  });

  it('同じ行の途中で終わる場合は行を減らさない', () => {
    assert.equal(fileReference(PATH, makeSelection(4, 3, 9, 1)), '@src/app.ts#5-10');
  });
});

describe('folderReference / joinReferences', () => {
  it('フォルダは末尾に / を付ける', () => {
    assert.equal(folderReference('src/components'), '@src/components/');
  });

  it('すでに / で終わっていれば重ねない', () => {
    assert.equal(folderReference('src/'), '@src/');
  });

  it('複数の参照は空白でつなぐ', () => {
    assert.equal(joinReferences(['@a.js', '@src/', '@logo.png']), '@a.js @src/ @logo.png');
  });
});

describe('linesReference: 行の範囲（0 始まり）', () => {
  it('1 行 → #行（1 始まり）', () => {
    assert.equal(linesReference(PATH, 7, 7), '@src/app.ts#8');
  });

  it('複数行 → #開始-終了（1 始まり）', () => {
    assert.equal(linesReference(PATH, 4, 9), '@src/app.ts#5-10');
  });
});
