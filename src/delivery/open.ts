// ファイルを一瞬開いて（行があれば選んで）、公式コマンドで入れる
// 設定 keep のときのエクスプローラーのファイルと、Markdown のプレビューの行で使う

import type * as vscode from 'vscode';
import { type InsertFailure, insertMentionFor } from '../claude/chat';
import { type Lines, openForMention } from '../workspace';

/**
 * 入れられたら undefined、だめなら理由
 * - notText: テキストとして開けなかった（画像など）
 * - notInstalled / failed: 公式コマンドで入れられなかった
 */
export async function openAndInsert(
  uri: vscode.Uri,
  column: vscode.ViewColumn,
  lines?: Lines,
): Promise<'notText' | InsertFailure | undefined> {
  const opened = await openForMention(uri, column, lines);
  if (!opened) return 'notText';

  const failure = await insertMentionFor(opened.editor);
  // 参照を作るためだけに開いたタブは閉じ、もともと開いていたものは選択と前面のタブを戻す
  await opened.finish();
  return failure;
}
