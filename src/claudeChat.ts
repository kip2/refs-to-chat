// 公式 Claude Code 拡張とのやり取り。
// 公式拡張の中身には触れず、コマンドパレットに出ている公開コマンドを呼ぶだけ。

import * as vscode from 'vscode';
import { CLAUDE, FOCUS_WAIT_MS, LOG_PREFIX, PASTE_COMMAND } from './constants';

/** チャットに入れられなかった理由 */
export type InsertFailure = 'notInstalled' | 'failed';

export function isClaudeInstalled(): boolean {
  return vscode.extensions.getExtension(CLAUDE.extensionId) !== undefined;
}

/**
 * アクティブなエディタの参照（選択範囲があれば行番号付き）をチャットに入れる。
 * 入れられたら undefined、入れられなかったらその理由を返す。
 */
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
 * クリップボードの中身を、チャットの入力欄に貼り付ける。
 * 入力欄にフォーカスを移してから、VS Code 標準の貼り付けを呼ぶ。
 * 本当に入ったかは確かめられないので、コマンドを呼べたら true を返す。
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
