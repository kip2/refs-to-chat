// 公式コマンドで入れないものを、最後にまとめて貼り付けかコピーで届ける
// 複数あっても、クリップボードへの書き込みと警告は 1 回にまとめる

import * as vscode from 'vscode';
import { type InsertFailure, isClaudeMissing, mayHaveClaude, type PasteResult, pasteClipboardIntoChat } from '../claude/chat';
import { MESSAGES, REASON_MESSAGES } from '../messages';
import { joinReferences } from '../reference';

/**
 * まとめて届ける理由
 * - notInstalled / failed: 公式コマンドで入れられなかった
 * - paste: 貼り付けで入れるもの（フォルダ、設定 use のもの、開けなかったファイル）
 */
export type DeliveryReason = InsertFailure | 'paste';

/** まとめて届ける参照と、その理由 */
export interface PendingReference {
  readonly ref: string;
  readonly reason: DeliveryReason;
}

/** チャットに入れられず、コピーした理由 */
type CopyReason = keyof typeof REASON_MESSAGES;

/**
 * まとめて届ける
 * - ファイル名に改行などが入っているもの: どこにも入れず、警告だけ出す
 * - 公式コマンドで入れられなかったものがある: まとめてコピーして警告を出す
 * - 貼り付けで入れるものだけ: 貼り付ける。貼り付けられなかったら、コピーして警告を出す
 */
export async function deliverPendingReferences(pending: readonly PendingReference[]): Promise<void> {
  const unsafe = pending.filter((p) => !isSafeReference(p.ref));
  if (unsafe.length > 0) void vscode.window.showWarningMessage(MESSAGES.unsafeName(unsafe.length));

  const safe = pending.filter((p) => isSafeReference(p.ref));
  if (safe.length === 0) return;
  const refs = safe.map((p) => p.ref);

  if (!mayHaveClaude()) {
    await copyWithWarning(refs, ['notInstalled']);
    return;
  }
  const failures = safe.map((p) => p.reason).filter(isFailure);
  if (failures.length > 0) {
    await copyWithWarning(refs, failures);
    return;
  }
  const result = await pasteIntoChat(refs);
  if (result === 'pasted') return;
  if (result === 'leftInFile') {
    await copyWithWarning(refs, ['leftInFile']);
    return;
  }
  // Remote では、呼んでみて初めて公式拡張がないと分かる
  await copyWithWarning(refs, [(await isClaudeMissing()) ? 'notInstalled' : 'pasteFailed']);
}

function isFailure(reason: DeliveryReason): reason is InsertFailure {
  return reason === 'notInstalled' || reason === 'failed';
}

// 改行などの制御文字を含む参照は、貼り付けてもコピーしてもいけない
// エディタやターミナルに入ると、コマンドとして動きうるため
// 見えない書式の文字（文字の向きを変えるものなど）や行区切りも、表示を偽装できるので同じく扱う
function isSafeReference(ref: string): boolean {
  return !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(ref);
}

/**
 * コピーしてチャットに貼り付ける
 * 貼り付けられなかったときも、クリップボードには入ったまま
 */
async function pasteIntoChat(refs: readonly string[]): Promise<PasteResult> {
  // 末尾に空白を付ける
  // 続けて貼り付けたときに、前の参照とくっついて 1 つの参照に見えないようにするため
  const text = `${joinReferences(refs)} `;
  await vscode.env.clipboard.writeText(text);
  // 本当に入ったかは分からない（ログインの画面が出ているときなどは入らない）ので、通知は出さない
  // 入っていなくても、参照はクリップボードに残っている
  return pasteClipboardIntoChat(text);
}

async function copyWithWarning(refs: readonly string[], reasons: readonly CopyReason[]): Promise<void> {
  const text = joinReferences(refs);
  await vscode.env.clipboard.writeText(text);

  const why = [...new Set(reasons)].map((r) => REASON_MESSAGES[r]).join('。');
  void vscode.window.showWarningMessage(MESSAGES.copied(why, text));
}
