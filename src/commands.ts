// 右クリックメニューから呼ばれる、2 つのコマンドの処理

import * as vscode from 'vscode';
import { insertActiveEditorMention } from './claudeChat';
import { type DeferredReference, deliverDeferredReferences } from './fallback';
import { fileReference, folderReference } from './reference';
import { isFolder, openAsActiveEditor, workspacePath } from './workspace';

/** エディタの右クリック（選択範囲あり・なし共通） */
export async function addActiveEditorToChat(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('アクティブなエディタがありません。');
    return;
  }

  const failure = await insertActiveEditorMention();
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

  // ファイルはその場で公式コマンドで入れ、入れられないものは最後にまとめて届ける
  const deferred: DeferredReference[] = [];

  for (const uri of uris) {
    if (await isFolder(uri)) {
      deferred.push({ ref: folderReference(workspacePath(uri)), reason: 'folder' });
      continue;
    }

    const editor = await openAsActiveEditor(uri);
    if (!editor) {
      deferred.push({ ref: fileReference(workspacePath(uri)), reason: 'notText' });
      continue;
    }

    const failure = await insertActiveEditorMention();
    if (failure) deferred.push({ ref: fileReference(workspacePath(editor.document.uri)), reason: failure });
  }

  await deliverDeferredReferences(deferred);
}
