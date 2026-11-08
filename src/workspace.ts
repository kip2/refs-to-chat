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

/**
 * ファイルの各行（タブは開かない）
 * 開けなければ undefined
 */
export async function readLines(uri: vscode.Uri): Promise<string[] | undefined> {
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    return Array.from({ length: document.lineCount }, (_, i) => document.lineAt(i).text);
  } catch (err) {
    console.error(LOG_PREFIX, err);
    return undefined;
  }
}

export interface OpenedForMention {
  readonly editor: vscode.TextEditor;
  /** 選択を元に戻し、この拡張が開いたタブなら閉じる */
  finish(): Promise<void>;
}

/** 行の範囲（0 始まりで、last の行も含む） */
export interface Lines {
  readonly first: number;
  readonly last: number;
}

/**
 * 公式コマンドが参照を作れるよう、ファイルをアクティブなエディタにして、選択を整える
 * 公式コマンドはアクティブなエディタから参照を作り、選択範囲があると行番号を付けるため
 * lines を渡すとその行を選び、渡さなければ選択を空にする
 * 画像など、開けなければ undefined
 */
export async function openForMention(
  uri: vscode.Uri,
  viewColumn?: vscode.ViewColumn,
  lines?: Lines,
): Promise<OpenedForMention | undefined> {
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    // ユーザーが選んでいたグループに開く
    // 2 つ目以降のファイルは、チャットを開いたあとなので、指定しないとチャットのグループに開いてしまう
    const group = groupOf(viewColumn);
    // ドキュメント自身の URI で調べる
    // Windows でパスの大文字小文字が違っても、同じファイルなら同じドキュメントが返る
    const hadTab = group.tabs.some((tab) => isTabOf(tab, document.uri));
    // そのグループで前面にあったタブ
    // ファイルのタブが裏にあったときは、入れたあとで、これを前面に戻す
    const front = group.activeTab;
    const wasFront = front !== undefined && isTabOf(front, document.uri);

    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: group.viewColumn,
      // 仮のタブ（斜体）で開くと、ユーザーが仮のタブで開いていた別のファイルを置き換えて消してしまう
      preview: false,
      preserveFocus: false,
    });

    const original = editor.selections;
    editor.selection = lines ? selectLines(document, lines) : emptyAtCursor(editor);

    return {
      editor,
      finish: async () => {
        if (hadTab) {
          // チャットを開いたときに元のエディタが作り直されていることがあるので、今見えているものに戻す
          // 同じファイルをほかのグループでも開いていることがあるので、開いたグループのものを選ぶ
          const live =
            vscode.window.visibleTextEditors.find(
              (e) => e.document === document && e.viewColumn === group.viewColumn,
            ) ?? editor;
          live.selections = original;
          if (front && !wasFront) await showPreviousTab(group.viewColumn);
          return;
        }
        // 開いたときに受け取ったグループは、VS Code の版によっては、あとから増えたタブが入らない（1.100 で確かめた）
        // 閉じるときに、グループを取り直す
        const live = groupOf(group.viewColumn);
        await closeTabs(live.tabs.filter((tab) => isTabOf(tab, document.uri)));
      },
    };
  } catch (err) {
    console.error(LOG_PREFIX, err);
    return undefined;
  }
}

/** カーソルは動かさず、選択だけを空にする */
function emptyAtCursor(editor: vscode.TextEditor): vscode.Selection {
  const cursor = editor.selection.active;
  return new vscode.Selection(cursor, cursor);
}

/** first の行の先頭から、last の行の末尾まで */
function selectLines(document: vscode.TextDocument, lines: Lines): vscode.Selection {
  const end = document.lineAt(lines.last).range.end;
  return new vscode.Selection(new vscode.Position(lines.first, 0), end);
}

/**
 * そのファイルを表示しているエディタグループ（なければ fallback）
 * すでに表示しているグループで開けば、新しいタブを作らずに済む
 */
export function columnShowing(uri: vscode.Uri, fallback: vscode.ViewColumn): vscode.ViewColumn {
  const visible = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString());
  return visible?.viewColumn ?? fallback;
}

/**
 * そのグループで、ひとつ前に前面にあったタブを、もう一度前面に出す
 * Markdown のプレビュー（Webview のタブ）は API で前面に出せないので、VS Code の「グループ内で直前に使ったエディタを開く」を使う
 * そのグループにフォーカスが移る（プレビューから右クリックしたときは、プレビューに戻る）
 * 出せなくても、参照を届ける処理は続ける
 */
async function showPreviousTab(viewColumn: vscode.ViewColumn): Promise<void> {
  const focusCommand = FOCUS_GROUP_COMMANDS[viewColumn - 1];
  if (!focusCommand) return;
  try {
    await vscode.commands.executeCommand(focusCommand);
    await vscode.commands.executeCommand(OPEN_PREVIOUS_IN_GROUP_COMMAND);
  } catch (err) {
    console.error(LOG_PREFIX, err);
  }
}

/** エディタグループにフォーカスを移すコマンド（1〜8 番目のグループ） */
const FOCUS_GROUP_COMMANDS = [
  'workbench.action.focusFirstEditorGroup',
  'workbench.action.focusSecondEditorGroup',
  'workbench.action.focusThirdEditorGroup',
  'workbench.action.focusFourthEditorGroup',
  'workbench.action.focusFifthEditorGroup',
  'workbench.action.focusSixthEditorGroup',
  'workbench.action.focusSeventhEditorGroup',
  'workbench.action.focusEighthEditorGroup',
];

/** 今のグループで、直前に使ったエディタを開く */
const OPEN_PREVIOUS_IN_GROUP_COMMAND = 'workbench.action.openPreviousRecentlyUsedEditorInGroup';

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
