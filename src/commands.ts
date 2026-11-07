// 右クリックメニューから呼ばれる、2 つのコマンドの処理

import * as vscode from 'vscode';
import { insertMentionFor } from './claudeChat';
import { explorerFileMode } from './config';
import { type DeferredReference, deliverDeferredReferences } from './fallback';
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
    await deliverDeferredReferences([{ ref, reason: failure }]);
  }
}

/**
 * エクスプローラーの右クリック（ファイル・フォルダ、複数選択可）
 * 引数は (右クリックしたもの, 選択中の一覧)
 * コマンドパレットから呼ぶと両方 undefined のことがある
 */
export async function addExplorerItemsToChat(
  clicked?: vscode.Uri,
  selected?: readonly (vscode.Uri | undefined)[],
): Promise<void> {
  const uris = (selected?.length ? selected : [clicked]).filter((u): u is vscode.Uri => u != null);
  const mode = explorerFileMode();

  // 公式コマンドで入れないものは、最後にまとめて貼り付けかコピーで届ける
  const deferred: DeferredReference[] = [];

  for (const uri of uris) {
    if (await isFolder(uri)) {
      deferred.push({ ref: folderReference(workspacePath(uri)), reason: 'folder' });
      continue;
    }

    // 貼り付けの設定なら、ファイルも開かずにフォルダと同じく貼り付けで入れる
    if (mode === 'paste') {
      deferred.push({ ref: fileReference(workspacePath(uri)), reason: 'pasteFile' });
      continue;
    }

    const opened = await openForMention(uri);
    if (!opened) {
      deferred.push({ ref: fileReference(workspacePath(uri)), reason: 'notText' });
      continue;
    }

    const failure = await insertMentionFor(opened.editor);
    if (failure) deferred.push({ ref: fileReference(workspacePath(uri)), reason: failure });

    // 参照を作るためだけに開いたタブは閉じ、もともと開いていたものは選択を戻す
    await opened.finish();
  }

  await deliverDeferredReferences(deferred);
}
