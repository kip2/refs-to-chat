// 設定を読む

import * as vscode from 'vscode';
import { SETTINGS } from './constants';

/**
 * エクスプローラーから送るファイルで、クリップボードを使うか
 * - use: 開かずに、参照をクリップボードから貼り付けで入れる（タブがちらつかない）
 * - keep: クリップボードは使わず、一瞬開いて公式コマンドで入れる
 */
export type ExplorerClipboard = 'use' | 'keep';

export function explorerClipboard(): ExplorerClipboard {
  const value = vscode.workspace.getConfiguration(SETTINGS.section).get<string>(SETTINGS.explorerClipboard, 'use');
  // 知らない値が入っていたら、初期設定の use として扱う
  return value === 'keep' ? 'keep' : 'use';
}
