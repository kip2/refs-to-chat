// Target の入れ方を決める処理のテスト
// delivery/choose.ts は vscode に依存しないので、モックなしで直接読み込む
// docs/ARCHITECTURE.md の 5-2 の表と同じ組み合わせを確かめる

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClipboardUse } from '../../config';
import { chooseDelivery, type Delivery } from '../../delivery/choose';
import type { Target } from '../../target';

// chooseDelivery は kind しか見ないので、URI やエディタは形だけそろえる
const uri = {} as never;
const TARGETS: Record<Target['kind'], Target> = {
  editor: { kind: 'editor', editor: {} as never },
  file: { kind: 'file', uri },
  folder: { kind: 'folder', uri },
  lines: { kind: 'lines', uri, first: 2, last: 3 },
};

const TABLE: [Target['kind'], ClipboardUse, Delivery][] = [
  ['editor', 'use', { how: 'insert' }],
  ['editor', 'keep', { how: 'insert' }],
  ['folder', 'use', { how: 'paste' }],
  ['folder', 'keep', { how: 'paste' }],
  ['file', 'use', { how: 'paste' }],
  ['file', 'keep', { how: 'open', column: 'start' }],
  ['lines', 'use', { how: 'paste' }],
  ['lines', 'keep', { how: 'open', column: 'showing' }],
];

describe('chooseDelivery: 入れ方の組み合わせ', () => {
  for (const [kind, clipboard, expected] of TABLE) {
    it(`${kind}・設定 ${clipboard} → ${expected.how}${'column' in expected ? `（${expected.column}）` : ''}`, () => {
      assert.deepEqual(chooseDelivery(TARGETS[kind], clipboard), expected);
    });
  }

  it('すべての kind と設定の組み合わせを表に書いている', () => {
    assert.equal(TABLE.length, Object.keys(TARGETS).length * 2);
  });
});
