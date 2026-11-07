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
      // プレビューで開くと、ユーザーがプレビューで開いていた別のタブを置き換えて消してしまう
      preview: false,
      preserveFocus: false,
      selection: new vscode.Range(0, 0, 0, 0),
    });
  } catch (err) {
    console.error(LOG_PREFIX, err);
    return undefined;
  }
}

function tabsOf(uri: vscode.Uri): vscode.Tab[] {
  const key = uri.toString();
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === key);
}

/** そのファイルのタブがどこかに開いているか */
export function isOpenInTab(uri: vscode.Uri): boolean {
  return tabsOf(uri).length > 0;
}

/**
 * そのファイルのタブを閉じる
 * 閉じられなくても、参照を届ける処理は続ける
 */
export async function closeTabs(uri: vscode.Uri): Promise<void> {
  const tabs = tabsOf(uri);
  if (tabs.length === 0) return;
  try {
    await vscode.window.tabGroups.close(tabs, true);
  } catch (err) {
    console.error(LOG_PREFIX, err);
  }
}
