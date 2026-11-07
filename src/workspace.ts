// パスの変換、フォルダの判定、参照を作るためにファイルを開く・閉じる処理

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

export interface OpenedForMention {
  readonly editor: vscode.TextEditor;
  /** 選択を元に戻し、この拡張が開いたタブなら閉じる */
  finish(): Promise<void>;
}

/**
 * 公式コマンドが参照を作れるよう、ファイルをアクティブなエディタにして、選択を空にする
 * 公式コマンドはアクティブなエディタから参照を作り、選択範囲があると行番号を付けるため
 * 画像など、開けなければ undefined
 */
export async function openForMention(
  uri: vscode.Uri,
  viewColumn?: vscode.ViewColumn,
): Promise<OpenedForMention | undefined> {
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    // ユーザーが選んでいたグループに開く
    // 2 つ目以降のファイルは、チャットを開いたあとなので、指定しないとチャットのグループに開いてしまう
    const group = groupOf(viewColumn);
    // ドキュメント自身の URI で調べる
    // Windows でパスの大文字小文字が違っても、同じファイルなら同じドキュメントが返る
    const hadTab = group.tabs.some((tab) => isTabOf(tab, document.uri));

    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: group.viewColumn,
      // プレビューで開くと、ユーザーがプレビューで開いていた別のタブを置き換えて消してしまう
      preview: false,
      preserveFocus: false,
    });

    // カーソルは動かさず、選択だけを空にする
    const original = editor.selections;
    const cursor = editor.selection.active;
    editor.selection = new vscode.Selection(cursor, cursor);

    return {
      editor,
      finish: async () => {
        if (hadTab) {
          // チャットを開いたときに元のエディタが作り直されていることがあるので、今見えているものに戻す
          const live = vscode.window.visibleTextEditors.find((e) => e.document === document) ?? editor;
          live.selections = original;
          return;
        }
        await closeTabs(group.tabs.filter((tab) => isTabOf(tab, document.uri)));
      },
    };
  } catch (err) {
    console.error(LOG_PREFIX, err);
    return undefined;
  }
}

function isTabOf(tab: vscode.Tab, uri: vscode.Uri): boolean {
  return tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString();
}

// 閉じられなくても、参照を届ける処理は続ける
async function closeTabs(tabs: vscode.Tab[]): Promise<void> {
  if (tabs.length === 0) return;
  try {
    await vscode.window.tabGroups.close(tabs, true);
  } catch (err) {
    console.error(LOG_PREFIX, err);
  }
}

/** そのグループ（なければ、今のグループ） */
function groupOf(viewColumn: vscode.ViewColumn | undefined): vscode.TabGroup {
  return (
    vscode.window.tabGroups.all.find((g) => g.viewColumn === viewColumn) ?? vscode.window.tabGroups.activeTabGroup
  );
}
