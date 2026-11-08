// エディタの右クリック（選択範囲あり・なし共通）とコマンドパレット

import * as vscode from 'vscode';
import { MESSAGES } from '../messages';
import type { Source } from './source';

export const editorSource: Source<[]> = {
  async collect() {
    const editor = vscode.window.activeTextEditor;
    return editor ? { targets: [{ kind: 'editor', editor }] } : { notice: MESSAGES.noEditor };
  },
  // エディタからは、いつも公式コマンドで入れる（クリップボードを使うのは、入れられなかったときだけ）
  clipboard: () => 'keep',
};
