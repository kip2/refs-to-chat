// 公式の Claude Code 拡張とのやり取り
// 中身には触れず、公開コマンドを呼ぶだけ

import * as vscode from 'vscode';
import { CLAUDE, FOCUS_WAIT_MS, LOG_PREFIX, PASTE_CHECK_MS, PASTE_COMMAND } from './constants';

export type InsertFailure = 'notInstalled' | 'failed';

/**
 * この拡張と同じ場所（手元の PC か、リモート側）に公式拡張があるか
 * getExtension で見えるのは、同じ場所で動いている拡張だけ
 */
function isClaudeInstalledHere(): boolean {
  return vscode.extensions.getExtension(CLAUDE.extensionId) !== undefined;
}

/**
 * 公式拡張のコマンドを呼んでみる価値があるか
 * Remote（WSL・SSH・Dev Containers）では、公式拡張がリモート側にあり、手元の PC で動くこの拡張からは見えない
 * それでもコマンドは呼べるので、Remote のときは呼んでみるまで分からないものとして扱う
 */
export function mayHaveClaude(): boolean {
  return isClaudeInstalledHere() || vscode.env.remoteName !== undefined;
}

/**
 * 公式コマンドが失敗したとき、公式拡張がどこにもないせいか
 * 呼んだ時点で公式拡張は起動するので、どこかにあれば、そのコマンドが登録されている
 */
export async function isClaudeMissing(): Promise<boolean> {
  if (isClaudeInstalledHere()) return false;
  try {
    const commands = await vscode.commands.getCommands(true);
    return !commands.includes(CLAUDE.focusInputCommand);
  } catch (err) {
    console.error(LOG_PREFIX, err);
    return true;
  }
}

/**
 * エディタの参照（選択範囲があれば行番号付き）をチャットに入れる
 * 入れられたら undefined、だめなら理由
 */
export async function insertMentionFor(editor: vscode.TextEditor): Promise<InsertFailure | undefined> {
  if (!mayHaveClaude()) return 'notInstalled';
  // チャットが閉じていると、公式コマンドは起動を 15 秒待って、入れずに諦めることがある
  // 先にチャットを開いて起動させておく
  await openChat();
  // チャットにフォーカスが移ると、公式コマンドが参照を作る「アクティブなエディタ」がなくなることがある
  // 元のエディタを前面に戻す（選択範囲はそのまま残る）
  await bringToFront(editor);
  try {
    await vscode.commands.executeCommand(CLAUDE.insertMentionCommand);
    return undefined;
  } catch (err) {
    console.error(LOG_PREFIX, err);
    return (await isClaudeMissing()) ? 'notInstalled' : 'failed';
  }
}

async function openChat(): Promise<void> {
  try {
    await vscode.commands.executeCommand(CLAUDE.focusInputCommand);
  } catch (err) {
    // 開けなくても、公式コマンドで入れることは試す
    console.error(LOG_PREFIX, err);
  }
}

async function bringToFront(editor: vscode.TextEditor): Promise<void> {
  // まだ前面にあれば何もしない（チャットがサイドバーにあるときは、たいていこれ）
  if (vscode.window.activeTextEditor?.document === editor.document) return;
  // どのグループか分からないときと、ノートブックのセルは、戻すと別の場所に普通のタブが開いてしまう
  if (editor.viewColumn === undefined || editor.document.uri.scheme === 'vscode-notebook-cell') return;
  try {
    await vscode.window.showTextDocument(editor.document, {
      viewColumn: editor.viewColumn,
      preserveFocus: false,
      selection: editor.selection,
    });
  } catch (err) {
    console.error(LOG_PREFIX, err);
  }
}

/**
 * 貼り付けの結果
 * - pasted: 貼り付けた（本当にチャットに入ったかは分からない）
 * - notPasted: 貼り付けられなかった（ファイルに入ったものは取り消した）
 * - leftInFile: ファイルに入ってしまい、取り消せなかった
 */
export type PasteResult = 'pasted' | 'notPasted' | 'leftInFile';

/** 貼り付けで文字が入ったファイルと、入った直後のファイルの版 */
interface Landed {
  readonly document: vscode.TextDocument;
  readonly version: number;
}

/**
 * クリップボードの中身（text）をチャットの入力欄に貼り付ける
 * フォーカスが移るのを少し待ってから貼る
 * フォーカスがチャットに移らず、ファイルに貼り付けてしまったときは、取り消す
 */
export async function pasteClipboardIntoChat(text: string): Promise<PasteResult> {
  const landed: Landed[] = [];
  // ファイルが変わり、その変更の文字が貼り付けた文字とまったく同じなら、ファイルに入ったとみなす
  const watch = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.contentChanges.some((c) => c.text === text)) landed.push({ document: e.document, version: e.document.version });
  });
  try {
    await vscode.commands.executeCommand(CLAUDE.focusInputCommand);
    await sleep(FOCUS_WAIT_MS);
    await vscode.commands.executeCommand(PASTE_COMMAND);
    await sleep(PASTE_CHECK_MS);
  } catch (err) {
    console.error(LOG_PREFIX, err);
    return 'notPasted';
  } finally {
    watch.dispose();
  }
  if (landed.length === 0) return 'pasted';
  return (await undoPaste(landed)) ? 'notPasted' : 'leftInFile';
}

/**
 * ファイルに入ってしまった貼り付けを、undo で取り消す
 * undo は「フォーカスがあるエディタの、最後の操作」を取り消すので、次の条件を満たすときだけ使う
 * 満たさないときに使うと、ユーザーの操作を取り消してしまうおそれがある
 * - 文字が入ったのが 1 つのファイルだけで、そのファイルが前面のエディタのもの
 * - 入ったあと、そのファイルがほかに変わっていない（版が、入った直後のまま）
 * 取り消せたら true
 */
async function undoPaste(landed: readonly Landed[]): Promise<boolean> {
  const { document, version } = landed[landed.length - 1];
  if (landed.some((l) => l.document !== document)) return false;
  if (vscode.window.activeTextEditor?.document !== document) return false;
  if (document.version !== version) return false;
  try {
    await vscode.commands.executeCommand(UNDO_COMMAND);
    await sleep(PASTE_CHECK_MS);
  } catch (err) {
    console.error(LOG_PREFIX, err);
    return false;
  }
  // 取り消せていれば、ファイルの版が進んでいる
  return document.version !== version;
}

const UNDO_COMMAND = 'undo';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
