// 設定を読む

import * as vscode from 'vscode';
import { SETTINGS } from './constants';

/**
 * クリップボードを使うか（エクスプローラーのファイルと、Markdown のプレビューで選んだところ）
 * - use: 元のファイルを開かずに、参照をクリップボードから貼り付けで入れる（タブがちらつかない）
 * - keep: クリップボードは使わず、元のファイルを一瞬開いて公式コマンドで入れる
 */
export type ClipboardUse = 'use' | 'keep';

/** エクスプローラーからファイルを追加するときに、クリップボードを使うか */
export function explorerClipboard(): ClipboardUse {
  return readClipboardUse(SETTINGS.explorerClipboard);
}

/** Markdown のプレビューから追加するときに、クリップボードを使うか */
export function previewClipboard(): ClipboardUse {
  return readClipboardUse(SETTINGS.previewClipboard);
}

function readClipboardUse(key: string): ClipboardUse {
  const value = vscode.workspace.getConfiguration(SETTINGS.section).get<string>(key, 'use');
  // 知らない値が入っていたら、初期設定の use として扱う
  return value === 'keep' ? 'keep' : 'use';
}
