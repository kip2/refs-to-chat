import * as vscode from 'vscode';
import { LOG_PREFIX } from './constants';

/**
 * 参照に使うパス（公式拡張と同じ形式）
 * 単一フォルダ: `src/app.ts` / マルチルート: `フォルダ名/src/app.ts` / ワークスペースの外: 絶対パス
 */
export function workspacePath(uri: vscode.Uri): string {
  // 第 2 引数を省くと、マルチルートのときだけフォルダ名が付く（公式と同じ）
  return vscode.workspace.asRelativePath(uri);
}

export async function isFolder(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.Directory) !== 0;
  } catch {
    return false; // 調べられなければファイルとして扱う
  }
}

/**
 * 選択なしで開いてアクティブにする
 * 公式コマンドがアクティブなエディタから参照を作るため
 * 画像など、開けなければ undefined
 */
export async function openAsActiveEditor(uri: vscode.Uri): Promise<vscode.TextEditor | undefined> {
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    return await vscode.window.showTextDocument(document, {
      preview: true,
      preserveFocus: false,
      selection: new vscode.Range(0, 0, 0, 0),
    });
  } catch (err) {
    console.error(LOG_PREFIX, err);
    return undefined;
  }
}
