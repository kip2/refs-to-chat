// 公式コマンドで入れないものを、最後にまとめて貼り付けかコピーで届ける
// 複数あっても、クリップボードへの書き込みと通知は 1 回にまとめる

import * as vscode from 'vscode';
import { type InsertFailure, isClaudeInstalled, pasteClipboardIntoChat } from './claudeChat';
import { MESSAGES, REASON_MESSAGES } from './messages';
import { joinReferences } from './reference';

/**
 * 公式コマンドで入れない理由
 * pasteFile は、設定でエクスプローラーのファイルも貼り付けで入れるとき（初期設定）
 */
export type DeliveryReason = InsertFailure | 'notText' | 'folder' | 'pasteFile';

/** まとめて届ける参照と、その理由 */
export interface PendingReference {
  readonly ref: string;
  readonly reason: DeliveryReason;
}

/**
 * まとめて届ける
 * - 公式拡張があり、理由がフォルダ・開けないファイル・貼り付けの設定のファイルだけ: 貼り付けで入れる
 * - それ以外、または貼り付けを呼べないとき: コピーして警告を出す
 */
export async function deliverPendingReferences(pending: readonly PendingReference[]): Promise<void> {
  if (pending.length === 0) return;

  const refs = pending.map((p) => p.ref);
  const reasons = pending.map((p) => p.reason);

  if (!isClaudeInstalled()) {
    // フォルダなどは公式コマンドを呼ぶ前に振り分けるので、拡張がないことをここで理由に足す
    await copyWithWarning(refs, ['notInstalled', ...reasons]);
    return;
  }
  if (reasons.every(canPaste) && refs.every(isSafeToPaste) && (await pasteIntoChat(refs))) return;
  await copyWithWarning(refs, reasons);
}

/** 公式拡張は動いていて、公式コマンドを使わないだけのとき */
function canPaste(reason: DeliveryReason): boolean {
  return reason === 'folder' || reason === 'notText' || reason === 'pasteFile';
}

// フォーカスがチャットに移らないと、貼り付けはエディタやターミナルに入る
// ファイル名の改行などがターミナルに入るとコマンドとして動きうるので、制御文字を含むものは貼り付けない
// 見えない書式の文字（文字の向きを変えるものなど）や行区切りも、表示を偽装できるので同じく貼り付けない
function isSafeToPaste(ref: string): boolean {
  return !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(ref);
}

/**
 * コピーしてチャットに貼り付ける
 * 貼り付けを呼べなかったら false（クリップボードには入ったまま）
 */
async function pasteIntoChat(refs: readonly string[]): Promise<boolean> {
  const text = joinReferences(refs);
  await vscode.env.clipboard.writeText(text);
  if (!(await pasteClipboardIntoChat())) return false;

  // 通知は await しない（ユーザーが閉じるまで処理が止まるため）
  void vscode.window.showInformationMessage(MESSAGES.pasted(refs));
  return true;
}

async function copyWithWarning(refs: readonly string[], reasons: readonly DeliveryReason[]): Promise<void> {
  const text = joinReferences(refs);
  await vscode.env.clipboard.writeText(text);

  const why = [...new Set(reasons)].map((r) => REASON_MESSAGES[r]).join('。');
  void vscode.window.showWarningMessage(MESSAGES.copied(why, text));
}
