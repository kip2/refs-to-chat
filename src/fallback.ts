// 公式コマンドでチャットに入れられなかった参照の扱い。
// - 貼り付けで入れる（フォルダ・テキストで開けないファイル）
// - クリップボードにコピーして、手で貼ってもらう（公式拡張が無い・失敗）
// どちらも、複数あれば 1 回にまとめ、通知も 1 回だけ出す。

import * as vscode from 'vscode';
import { type InsertFailure, pasteClipboardIntoChat } from './claudeChat';
import { joinReferences } from './reference';

/** 公式コマンドでチャットに入れられなかった理由 */
export type FallbackReason = InsertFailure | 'notText' | 'folder';

const REASON_MESSAGES: Record<FallbackReason, string> = {
  notInstalled: 'Claude Code拡張が見つかりません',
  failed: 'Claudeへの送信に失敗しました',
  notText: 'テキストとして開けないファイルがあります',
  folder: 'フォルダはチャットに直接入れられません',
};

/** 貼り付けで入れられる理由（公式拡張は動いていて、公式コマンドが扱えない種類なだけ） */
export function canPaste(reason: FallbackReason): boolean {
  return reason === 'folder' || reason === 'notText';
}

/**
 * 参照をクリップボードにコピーし、チャットの入力欄に貼り付ける。
 * 貼り付けのコマンドを呼べなかったら false（クリップボードには入ったまま）。
 */
export async function pasteReferencesIntoChat(refs: readonly string[]): Promise<boolean> {
  const text = joinReferences(refs);
  await vscode.env.clipboard.writeText(text);
  if (!(await pasteClipboardIntoChat())) return false;

  // 通知は await しない（await すると、ユーザーが閉じるまで処理が止まる）
  void vscode.window.showInformationMessage(
    `チャットに貼り付けました: ${text}（入っていなければ、チャット欄で Ctrl+V を押してください）`,
  );
  return true;
}

/** 参照をクリップボードにコピーし、理由をまとめた警告を出す */
export async function copyReferencesWithWarning(
  refs: readonly string[],
  reasons: readonly FallbackReason[],
): Promise<void> {
  const text = joinReferences(refs);
  await vscode.env.clipboard.writeText(text);

  const why = [...new Set(reasons)].map((r) => REASON_MESSAGES[r]).join('。');
  void vscode.window.showWarningMessage(`${why}。参照をクリップボードにコピーしました: ${text}`);
}
