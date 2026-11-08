// 統合テストで共通に使う道具（公式拡張なし・偽の公式拡張ありの両方から使う）
// ファイル名が .itest.js ではないので、テストとしては読み込まれない

import * as assert from 'node:assert';
import * as vscode from 'vscode';

export const EXT_ID = 'kip2.refs-to-chat';

export const folders = () => vscode.workspace.workspaceFolders ?? [];

/** ワークスペースのフォルダの中のファイル（例: fileIn('alpha', 'src/app.js')） */
export function fileIn(folderName: string, rel: string): vscode.Uri {
  const folder = folders().find((f) => f.name === folderName);
  assert.ok(folder, `ワークスペースに ${folderName} がない`);
  return vscode.Uri.joinPath(folder.uri, ...rel.split('/'));
}

export async function open(uri: vscode.Uri, options?: vscode.TextDocumentShowOptions): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument(uri);
  return vscode.window.showTextDocument(doc, options);
}

export async function openWithSelection(
  uri: vscode.Uri,
  sl: number,
  sc: number,
  el: number,
  ec: number,
  options?: vscode.TextDocumentShowOptions,
): Promise<vscode.TextEditor> {
  const editor = await open(uri, options);
  editor.selection = new vscode.Selection(sl, sc, el, ec);
  return editor;
}

export function selectionOf(editor: vscode.TextEditor): [number, number, number, number] {
  const s = editor.selection;
  return [s.start.line, s.start.character, s.end.line, s.end.character];
}

export const clipboard = () => vscode.env.clipboard.readText();

/** エクスプローラーのファイルでクリップボードを使うかを設定する（undefined で初期設定に戻す） */
export async function setExplorerClipboard(value: 'use' | 'keep' | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration('refsToChat')
    .update('explorerClipboard', value, vscode.ConfigurationTarget.Global);
}

/** そのファイルのタブがどこかに開いているか */
export function hasTab(uri: vscode.Uri): boolean {
  return vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .some((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === uri.toString());
}

/** 遅れて届くイベント（タブの開閉など）を待つ */
export function settle(ms = 200): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
