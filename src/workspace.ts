// ワークスペースのファイル・フォルダを扱う処理。

import * as vscode from 'vscode';
import { LOG_PREFIX } from './constants';

/**
 * 参照に使うパス。公式拡張と同じ形式になる。
 * - 単一フォルダ:         `src/app.ts`
 * - マルチルート:         `フォルダ名/src/app.ts`
 * - ワークスペースの外:   絶対パス
 */
export function workspacePath(uri: vscode.Uri): string {
  // 第 2 引数は渡さない（公式拡張と同じく、マルチルートのときだけフォルダ名が付く）
  return vscode.workspace.asRelativePath(uri);
}

export async function isFolder(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.Directory) !== 0;
  } catch {
    // 調べられないときはファイルとして扱う（開けなければ、開けないファイルとして扱われる）
    return false;
  }
}

/**
 * ファイルをエディタで開き、選択なし（先頭にカーソル）の状態でアクティブにする。
 * 公式コマンドがアクティブなエディタから参照を作るので、その準備。
 * 画像など、テキストとして開けないときは undefined を返す。
 */
export async function openAsActiveEditor(uri: vscode.Uri): Promise<vscode.TextEditor | undefined> {
  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument(uri);
  } catch (err) {
    console.error(LOG_PREFIX, err);
    return undefined;
  }
  return vscode.window.showTextDocument(document, {
    preview: true,
    preserveFocus: false,
    selection: new vscode.Range(0, 0, 0, 0),
  });
}
