// 公式コマンドで入れられなかった参照を、最後にまとめて貼り付けかコピーで届ける
// 複数あっても、クリップボードへの書き込みと通知は 1 回にまとめる

import * as vscode from 'vscode';
import { type InsertFailure, isClaudeInstalled, pasteClipboardIntoChat } from './claudeChat';
import { MESSAGES, REASON_MESSAGES } from './messages';
import { joinReferences } from './reference';

/** 公式コマンドで入れない理由（pasteFile は、設定でファイルも貼り付けで入れるとき） */
export type FallbackReason = InsertFailure | 'notText' | 'folder' | 'pasteFile';

/** 後回しにした参照と、公式コマンドで入れられなかった理由 */
export interface DeferredReference {
  readonly ref: string;
  readonly reason: FallbackReason;
}

/**
 * 後回しにした参照をチャットに届ける
 * - フォルダ・開けないファイル・貼り付けの設定のファイルだけ（公式拡張あり）: 貼り付けで入れる
 * - それ以外、または貼り付けを呼べないとき: コピーして警告を出す
 */
export async function deliverDeferredReferences(deferred: readonly DeferredReference[]): Promise<void> {
  if (deferred.length === 0) return;

  const refs = deferred.map((d) => d.ref);
  const reasons = deferred.map((d) => d.reason);

  if (!isClaudeInstalled()) {
    // フォルダは公式コマンドを呼ぶ前に振り分けるので、拡張がないことをここで理由に足す
    await copyWithWarning(refs, ['notInstalled', ...reasons]);
    return;
  }
  if (reasons.every(canPaste) && refs.every(isSafeToPaste) && (await pasteIntoChat(refs))) return;
  await copyWithWarning(refs, reasons);
}

/** 公式拡張は動いていて、公式コマンドを使わないだけのとき */
function canPaste(reason: FallbackReason): boolean {
  return reason === 'folder' || reason === 'notText' || reason === 'pasteFile';
}

// フォーカスがチャットに移らないと、貼り付けはエディタやターミナルに入る
// ファイル名の改行などがターミナルに入るとコマンドとして動きうるので、制御文字を含むものは貼り付けない
function isSafeToPaste(ref: string): boolean {
  // oxlint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f]/.test(ref);
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
  void vscode.window.showInformationMessage(MESSAGES.pasted(text));
  return true;
}

async function copyWithWarning(refs: readonly string[], reasons: readonly FallbackReason[]): Promise<void> {
  const text = joinReferences(refs);
  await vscode.env.clipboard.writeText(text);

  const why = [...new Set(reasons)].map((r) => REASON_MESSAGES[r]).join('。');
  void vscode.window.showWarningMessage(MESSAGES.copied(why, text));
}
