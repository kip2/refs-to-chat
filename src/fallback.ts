// 公式コマンドでチャットに入れられなかった参照を、まとめて貼り付けるかコピーする
// 複数あっても、クリップボードへの書き込みと通知は 1 回にまとめる

import * as vscode from 'vscode';
import { type InsertFailure, isClaudeInstalled, pasteClipboardIntoChat } from './claudeChat';
import { joinReferences } from './reference';

export type FallbackReason = InsertFailure | 'notText' | 'folder';

/** 後回しにした参照と、公式コマンドで入れられなかった理由 */
export interface DeferredReference {
  readonly ref: string;
  readonly reason: FallbackReason;
}

const REASON_MESSAGES: Record<FallbackReason, string> = {
  notInstalled: 'Claude Code拡張が見つかりません',
  failed: 'Claudeへの送信に失敗しました',
  notText: 'テキストとして開けないファイルがあります',
  folder: 'フォルダはチャットに直接入れられません',
};

/**
 * 後回しにした参照をチャットに届ける
 * - フォルダ・開けないファイルだけ（公式拡張あり）: 貼り付けで入れる
 * - それ以外、または貼り付けを呼べないとき: コピーして警告を出す
 */
export async function deliverDeferredReferences(deferred: readonly DeferredReference[]): Promise<void> {
  if (deferred.length === 0) return;

  const refs = deferred.map((d) => d.ref);
  const reasons = deferred.map((d) => d.reason);

  if (!isClaudeInstalled()) {
    // フォルダは公式コマンドを呼ぶ前に振り分けるので、拡張が無いことをここで理由に足す
    await copyWithWarning(refs, ['notInstalled', ...reasons]);
    return;
  }
  if (reasons.every(canPaste) && (await pasteIntoChat(refs))) return;
  await copyWithWarning(refs, reasons);
}

/** 公式拡張は動いていて、種類が合わないだけのとき */
function canPaste(reason: FallbackReason): boolean {
  return reason === 'folder' || reason === 'notText';
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
  void vscode.window.showInformationMessage(
    `チャットに貼り付けました: ${text}（入っていなければ、チャット欄で Ctrl+V を押してください）`,
  );
  return true;
}

async function copyWithWarning(refs: readonly string[], reasons: readonly FallbackReason[]): Promise<void> {
  const text = joinReferences(refs);
  await vscode.env.clipboard.writeText(text);

  const why = [...new Set(reasons)].map((r) => REASON_MESSAGES[r]).join('。');
  void vscode.window.showWarningMessage(`${why}。参照をクリップボードにコピーしました: ${text}`);
}
