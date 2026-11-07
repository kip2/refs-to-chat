// 設定を読む

import * as vscode from 'vscode';
import { SETTINGS } from './constants';

/**
 * エクスプローラーから送るファイルの入れ方
 * - paste: 開かずに、参照を貼り付けで入れる（タブがちらつかない）
 * - open: 一瞬開いて、公式コマンドで入れる（確実）
 */
export type ExplorerFileMode = 'paste' | 'open';

export function explorerFileMode(): ExplorerFileMode {
  const value = vscode.workspace.getConfiguration(SETTINGS.section).get<string>(SETTINGS.explorerFiles, 'paste');
  // 知らない値が入っていたら、初期設定の paste として扱う
  return value === 'open' ? 'open' : 'paste';
}
