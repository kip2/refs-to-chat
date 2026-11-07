// 公式の Claude Code 拡張とのやり取り
// 中身には触れず、公開コマンドを呼ぶだけ

import * as vscode from 'vscode';
import { CLAUDE, FOCUS_WAIT_MS, LOG_PREFIX, PASTE_COMMAND } from './constants';

export type InsertFailure = 'notInstalled' | 'failed';

export function isClaudeInstalled(): boolean {
  return vscode.extensions.getExtension(CLAUDE.extensionId) !== undefined;
}

/**
 * エディタの参照（選択範囲があれば行番号付き）をチャットに入れる
 * 入れられたら undefined、だめなら理由
 */
export async function insertMentionFor(editor: vscode.TextEditor): Promise<InsertFailure | undefined> {
  if (!isClaudeInstalled()) return 'notInstalled';
  // チャットが閉じていると、公式コマンドは起動を 15 秒待って、入れずに諦めることがある
  // 先にチャットを開いて起動させておく
  await openChat();
  // チャットにフォーカスが移ると、公式コマンドが参照を作る「アクティブなエディタ」がなくなることがある
  // 元のエディタを前面に戻す（選択範囲はそのまま残る）
  await bringToFront(editor);
  try {
    await vscode.commands.executeCommand(CLAUDE.insertMentionCommand);
    return undefined;
  } catch (err) {
    console.error(LOG_PREFIX, err);
    return 'failed';
  }
}

async function openChat(): Promise<void> {
  try {
    await vscode.commands.executeCommand(CLAUDE.focusInputCommand);
  } catch (err) {
    // 開けなくても、公式コマンドで入れることは試す
    console.error(LOG_PREFIX, err);
  }
}

async function bringToFront(editor: vscode.TextEditor): Promise<void> {
  // まだ前面にあれば何もしない（チャットがサイドバーにあるときは、たいていこれ）
  if (vscode.window.activeTextEditor?.document === editor.document) return;
  // どのグループか分からないときと、ノートブックのセルは、戻すと別の場所に普通のタブが開いてしまう
  if (editor.viewColumn === undefined || editor.document.uri.scheme === 'vscode-notebook-cell') return;
  try {
    await vscode.window.showTextDocument(editor.document, {
      viewColumn: editor.viewColumn,
      preserveFocus: false,
      selection: editor.selection,
    });
  } catch (err) {
    console.error(LOG_PREFIX, err);
  }
}

/**
 * クリップボードの中身をチャットの入力欄に貼り付ける
 * フォーカスが移るのを少し待ってから貼る
 * 本当に入ったかは分からないので、呼べたら true
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
