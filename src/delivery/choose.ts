// Target をどうやってチャットに入れるかを決める
// 入れ方の組み合わせ（docs/ARCHITECTURE.md の 5-2 の表）は、ここだけで決める
// vscode に依存しないので、テストから直接読み込める

import type { ClipboardUse } from '../config';
import type { Target } from '../target';

/**
 * 入れ方
 * - insert: 前面のエディタのまま、公式コマンドで入れる
 * - open: ファイルを一瞬開いて（行があれば選んで）、公式コマンドで入れる
 *   column は開くグループ（showing: そのファイルを表示しているグループを優先、start: 右クリックしたときのグループ）
 * - paste: 参照をクリップボードから貼り付ける（最後にまとめて 1 回）
 */
export type Delivery =
  | { readonly how: 'insert' }
  | { readonly how: 'open'; readonly column: 'showing' | 'start' }
  | { readonly how: 'paste' };

/**
 * Target の入れ方を決める
 * clipboard は、その入口の設定（use: クリップボードを使う、keep: 使わない）
 */
export function chooseDelivery(target: Target, clipboard: ClipboardUse): Delivery {
  switch (target.kind) {
    // エディタは公式コマンドがそのまま参照を作れるので、設定に関係なく公式コマンドで入れる
    case 'editor':
      return { how: 'insert' };
    // 公式コマンドはフォルダを扱えないので、設定に関係なく貼り付ける
    case 'folder':
      return { how: 'paste' };
    // エクスプローラーのファイルは、右クリックしたときのグループに開く（2 つ目以降も同じグループにそろえる）
    case 'file':
      return clipboard === 'use' ? { how: 'paste' } : { how: 'open', column: 'start' };
    // プレビューの行は、横に表示している元のファイルがあれば、そのエディタを使う（新しいタブを作らない）
    case 'lines':
      return clipboard === 'use' ? { how: 'paste' } : { how: 'open', column: 'showing' };
  }
}
