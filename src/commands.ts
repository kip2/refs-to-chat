// 右クリックメニューから呼ばれる、2 つのコマンドの処理。

import * as vscode from 'vscode';
import { insertActiveEditorMention, isClaudeInstalled } from './claudeChat';
import { canPaste, copyReferencesWithWarning, type FallbackReason, pasteReferencesIntoChat } from './fallback';
import { fileReference, folderReference } from './reference';
import { isFolder, openAsActiveEditor, workspacePath } from './workspace';

/**
 * エディタの右クリック（選択範囲あり・なし共通）。
 * アクティブなエディタの参照を、公式コマンドでチャットに入れる。
 */
export async function addActiveEditorToChat(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('アクティブなエディタがありません。');
    return;
  }

  const failure = await insertActiveEditorMention();
  if (failure) {
    const ref = fileReference(workspacePath(editor.document.uri), editor.selection);
    await copyReferencesWithWarning([ref], [failure]);
  }
}

/**
 * エクスプローラーの右クリック（ファイル・フォルダ、複数選択可）。
 * - ファイル: 開いてアクティブにし、公式コマンドでチャットに入れる
 * - フォルダ・テキストで開けないファイル: 最後にまとめて、貼り付けでチャットに入れる
 * - 公式拡張が無い・失敗: 最後にまとめて、クリップボードにコピーする
 *
 * VS Code は (右クリックしたもの, 選択中のもの一覧) を渡す。
 * コマンドパレットなどから呼ばれると、どちらも undefined のことがある。
 */
export async function addExplorerItemsToChat(
  clicked?: vscode.Uri,
  selected?: readonly (vscode.Uri | undefined)[],
): Promise<void> {
  const uris = (selected?.length ? selected : [clicked]).filter((u): u is vscode.Uri => u !== undefined);

  // 公式コマンドで入れられなかったものを、理由と一緒に後回しにする
  const deferredRefs: string[] = [];
  const reasons: FallbackReason[] = [];
  const defer = (ref: string, reason: FallbackReason) => {
    deferredRefs.push(ref);
    reasons.push(reason);
  };

  for (const uri of uris) {
    const path = workspacePath(uri);

    if (await isFolder(uri)) {
      defer(folderReference(path), 'folder');
      continue;
    }

    const editor = await openAsActiveEditor(uri);
    if (!editor) {
      defer(fileReference(path), 'notText');
      continue;
    }

    const failure = await insertActiveEditorMention();
    if (failure) defer(fileReference(path), failure);
  }

  if (deferredRefs.length === 0) return;

  // 公式拡張は動いていて、扱えない種類（フォルダなど）だけなら、貼り付けで入れる
  if (isClaudeInstalled() && reasons.every(canPaste) && (await pasteReferencesIntoChat(deferredRefs))) {
    return;
  }
  await copyReferencesWithWarning(deferredRefs, reasons);
}
