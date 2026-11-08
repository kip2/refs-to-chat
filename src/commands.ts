// 右クリックメニューから呼ばれる、2 つのコマンドの処理

import * as vscode from 'vscode';
import { insertMentionFor } from './claudeChat';
import { explorerClipboard } from './config';
import { deliverPendingReferences, type PendingReference } from './delivery';
import { MESSAGES } from './messages';
import { fileReference, folderReference } from './reference';
import { isFolder, openForMention, workspacePath } from './workspace';

/** エディタの右クリック（選択範囲あり・なし共通） */
export async function addActiveEditorToChat(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage(MESSAGES.noEditor);
    return;
  }

  const failure = await insertMentionFor(editor);
  if (failure) {
    const ref = fileReference(workspacePath(editor.document.uri), editor.selection);
    await deliverPendingReferences([{ ref, reason: failure }]);
  }
}

/**
 * エクスプローラーの右クリック（ファイル・フォルダ、複数選択可）
 * 引数は (右クリックしたもの, 選択中の一覧)
 * コマンドパレットやキーボードショートカットから呼ぶと、両方 undefined のことがある
 */
export async function addExplorerItemsToChat(
  clicked?: vscode.Uri,
  selected?: readonly (vscode.Uri | undefined)[],
): Promise<void> {
  const uris = (selected?.length ? selected : [clicked]).filter((u): u is vscode.Uri => u != null);
  if (uris.length === 0) {
    void vscode.window.showInformationMessage(MESSAGES.noTarget);
    return;
  }

  // 設定は 1 回だけ読み、途中で変わっても同じ入れ方で最後まで送る
  const clipboard = explorerClipboard();
  // チャットを開くと今のグループが変わるので、最初にユーザーが選んでいたグループを覚えておく
  const column = vscode.window.tabGroups.activeTabGroup.viewColumn;

  // 公式コマンドで入れないものは、最後にまとめて貼り付けかコピーで届ける
  const pending: PendingReference[] = [];

  for (const uri of uris) {
    if (await isFolder(uri)) {
      pending.push({ ref: folderReference(workspacePath(uri)), reason: 'folder' });
    } else if (clipboard === 'use') {
      pending.push({ ref: fileReference(workspacePath(uri)), reason: 'pasteFile' });
    } else {
      const notAdded = await addFileByOpening(uri, column);
      if (notAdded) pending.push(notAdded);
    }
  }

  await deliverPendingReferences(pending);
}

/**
 * 設定 keep のとき: ファイルを一瞬開いて、公式コマンドで入れる
 * 入れられなかったら、まとめて届ける分として返す
 */
async function addFileByOpening(uri: vscode.Uri, column: vscode.ViewColumn): Promise<PendingReference | undefined> {
  const opened = await openForMention(uri, column);
  if (!opened) return { ref: fileReference(workspacePath(uri)), reason: 'notText' };

  const failure = await insertMentionFor(opened.editor);
  // 参照を作るためだけに開いたタブは閉じ、もともと開いていたものは選択を戻す
  await opened.finish();
  return failure ? { ref: fileReference(workspacePath(uri)), reason: failure } : undefined;
}
