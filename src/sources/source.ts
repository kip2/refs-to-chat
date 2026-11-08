// 右クリックの入口の型
// 入口は、右クリックで渡された引数を Target の一覧に直すだけで、チャットへの入れ方は知らない

import type { ClipboardUse } from '../config';
import type { Target } from '../target';

/**
 * 入口が集めた結果
 * - targets: チャットに入れるもの（1 つ以上）
 * - notice: 入れるものがないときに、案内として出す文
 */
export type Collected = { readonly targets: readonly Target[] } | { readonly notice: string };

/** 右クリックの入口（エディタ・エクスプローラー・Markdown のプレビュー） */
export interface Source<Args extends unknown[]> {
  /** 右クリックで渡された引数から、チャットに入れるものを集める */
  collect(...args: Args): Promise<Collected>;
  /**
   * この入口で、クリップボードを使うか（設定を読む）
   * 1 回の右クリックで 1 回だけ呼ぶ
   */
  clipboard(): ClipboardUse;
}
