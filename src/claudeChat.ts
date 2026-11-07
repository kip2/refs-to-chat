// 公式 Claude Code 拡張とのやり取り。中身には触れず、公開コマンドを呼ぶだけ。

import * as vscode from 'vscode';
import { CLAUDE, FOCUS_WAIT_MS, LOG_PREFIX, PASTE_COMMAND } from './constants';

export type InsertFailure = 'notInstalled' | 'failed';

export function isClaudeInstalled(): boolean {
  return vscode.extensions.getExtension(CLAUDE.extensionId) !== undefined;
}

/** アクティブなエディタの参照をチャットに入れる。入れられたら undefined、だめなら理由 */
export async function insertActiveEditorMention(): Promise<InsertFailure | undefined> {
  if (!isClaudeInstalled()) return 'notInstalled';
  try {
    await vscode.commands.executeCommand(CLAUDE.insertMentionCommand);
    return undefined;
  } catch (err) {
    console.error(LOG_PREFIX, err);
    return 'failed';
  }
}

/**
 * クリップボードの中身をチャットの入力欄に貼り付ける。
 * フォーカスが移るのを少し待ってから貼る。本当に入ったかは分からないので、呼べたら true。
 */
export async function pasteClipboardIntoChat(): Promise<boolean> {
  try {
    await vscode.commands.executeCommand(CLAUDE.focusInputCommand);
    await sleep(FOCUS_WAIT_MS);
    await vscode.commands.executeCommand(PASTE_COMMAND);
    return true;
  } catch (err) {
    console.error(LOG_PREFIX, err);
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
