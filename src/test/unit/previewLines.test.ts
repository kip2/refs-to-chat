// Markdown のプレビューで選んだところを、元のファイルの行に直す処理のテスト
// sources/previewLines.ts は vscode に依存しないので、モックなしで直接読み込む

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PREVIEW_CONTEXT_KEY,
  type PreviewPoint,
  parsePreviewSelection,
  previewLineRange,
} from '../../sources/previewLines';

const SOURCE = 'file:///ws/docs/guide.md';

// 1 始まりの行番号をコメントに書く
const LINES = [
  '---', //                1
  'title: x', //           2
  '---', //                3
  '', //                   4
  '# Heading', //          5
  '', //                   6
  'line A', //             7
  'line B', //             8
  'line C', //             9
  '', //                   10
  '```js', //              11
  'const x = 1;', //       12
  'const y = 2;', //       13
  '```', //                14
  '', //                   15
  '    indented 1', //     16
  '    indented 2', //     17
  '', //                   18
  '   ~~~', //             19
  'tilde', //              20
  '   ~~~', //             21
];

const point = (line: number, newlines = 0, code = false): PreviewPoint => ({ line, newlines, code });
const range = (start: PreviewPoint, end: PreviewPoint) => previewLineRange({ source: SOURCE, start, end }, LINES);
/** 1 始まりの行番号で書く */
const lines1 = (first: number, last: number) => ({ first: first - 1, last: last - 1 });

describe('previewLineRange: プレビューの位置から元のファイルの行へ', () => {
  it('ブロックの先頭の行（data-line は 0 始まり）', () => {
    assert.deepEqual(range(point(4), point(4)), lines1(5, 5));
  });

  it('段落の途中の行は、前にある改行の数だけ下がる', () => {
    assert.deepEqual(range(point(6, 1), point(6, 1)), lines1(8, 8));
  });

  it('段落の 1〜3 行目', () => {
    assert.deepEqual(range(point(6), point(6, 2)), lines1(7, 9));
  });

  it('複数のブロックにまたがる', () => {
    assert.deepEqual(range(point(4), point(6, 2)), lines1(5, 9));
  });

  it('フェンス（```）のコードブロックは、data-line がフェンスの行なので 1 つ下がる', () => {
    assert.deepEqual(range(point(10, 0, true), point(10, 1, true)), lines1(12, 13));
  });

  it('~~~ のフェンス（前に空白が 3 つまで）も同じ', () => {
    assert.deepEqual(range(point(18, 0, true), point(18, 0, true)), lines1(20, 20));
  });

  it('インデントのコードブロックは、data-line が中身の 1 行目なので下げない', () => {
    assert.deepEqual(range(point(15, 0, true), point(15, 1, true)), lines1(16, 17));
  });

  it('コードブロックでなければ、``` で始まる行でも下げない', () => {
    assert.deepEqual(range(point(10), point(10)), lines1(11, 11));
  });

  it('フロントマター（ブロックが見つからない）は 1 行目', () => {
    assert.deepEqual(range(point(0), point(0)), lines1(1, 1));
  });

  it('始まりと終わりが逆でも、小さいほうから並べる', () => {
    assert.deepEqual(range(point(6, 2), point(4)), lines1(5, 9));
  });

  it('改行を数えすぎても、ファイルの最後の行で止める', () => {
    assert.deepEqual(range(point(19), point(19, 50)), lines1(20, 21));
  });

  it('data-line がファイルの外（プレビューが古いなど）→ undefined', () => {
    assert.equal(range(point(4), point(21)), undefined);
    assert.equal(range(point(30), point(4)), undefined);
  });
});

describe('parsePreviewSelection: コマンドの引数（data-vscode-context の中身）を読む', () => {
  const good = { source: SOURCE, start: point(4), end: point(6, 2) };

  it('正しい形なら、そのまま取り出す（ほかのキーは無視する）', () => {
    assert.deepEqual(parsePreviewSelection({ webview: 'markdown.preview', [PREVIEW_CONTEXT_KEY]: good }), good);
  });

  it('プレビューのスクリプトと同じキーを使う', () => {
    assert.equal(PREVIEW_CONTEXT_KEY, 'refsToChatPreviewSelection');
  });

  const bad: [string, unknown][] = [
    ['引数がない', undefined],
    ['null', null],
    ['文字列', 'x'],
    ['キーがない', { webview: 'markdown.preview' }],
    ['source がない', { [PREVIEW_CONTEXT_KEY]: { ...good, source: undefined } }],
    ['source が空', { [PREVIEW_CONTEXT_KEY]: { ...good, source: '' } }],
    ['end がない', { [PREVIEW_CONTEXT_KEY]: { ...good, end: undefined } }],
    ['line が文字列', { [PREVIEW_CONTEXT_KEY]: { ...good, start: { line: '4', newlines: 0, code: false } } }],
    ['line が負', { [PREVIEW_CONTEXT_KEY]: { ...good, start: point(-1) } }],
    ['line が小数', { [PREVIEW_CONTEXT_KEY]: { ...good, start: point(1.5) } }],
    ['newlines が NaN', { [PREVIEW_CONTEXT_KEY]: { ...good, start: point(4, Number.NaN) } }],
    ['code が真偽値でない', { [PREVIEW_CONTEXT_KEY]: { ...good, start: { line: 4, newlines: 0, code: 'yes' } } }],
  ];
  for (const [name, arg] of bad) {
    it(`${name} → undefined`, () => {
      assert.equal(parsePreviewSelection(arg), undefined);
    });
  }
});
