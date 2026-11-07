// Right Click Mention
// 公式Claude Code拡張の「Insert @-Mention Reference」(Alt+K) を右クリックから呼ぶだけの拡張。
// Claude Code拡張が無い・失敗した場合、フォルダ、テキストで開けないファイルは @参照 をクリップボードにコピーする。
// 対象はVS Codeのパネル版のみ（claudeCode.useTerminal = true のときはメニュー自体を出さない）。

import * as vscode from 'vscode';

const CLAUDE_EXT_ID = 'anthropic.claude-code';
const CLAUDE_CMD = 'claude-vscode.insertAtMention';

// この拡張のコマンド ID（package.json の contributes.commands と一致させる。manifest.test.js で確認）
const COMMANDS = {
  sendSelection: 'rightClickMention.sendSelection',
  sendCurrentFile: 'rightClickMention.sendCurrentFile',
  sendFile: 'rightClickMention.sendFile',
} as const;

// クリップボードにコピーする理由（警告に表示する）
const REASONS = {
  noExtension: 'Claude Code拡張が見つかりません',
  failed: 'Claudeへの送信に失敗しました',
  notText: 'テキストとして開けないファイルがあります',
  folder: 'フォルダはチャットに直接入れられません',
} as const;
type Reason = (typeof REASONS)[keyof typeof REASONS];

// 公式拡張と同じパス形式: 単一フォルダなら "src/app.ts"、
// 複数フォルダ（マルチルート）なら "フォルダ名/src/app.ts"、ワークスペース外なら絶対パス
function relPath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri);
}

// @src/app.ts#5-10 形式の参照を組み立てる（フォールバック用）
function buildReference(editor: vscode.TextEditor): string {
  const path = relPath(editor.document.uri);
  const sel = editor.selection;
  if (!sel || sel.isEmpty) return `@${path}`;
  const start = sel.start.line + 1;
  let end = sel.end.line + 1;
  // 行末まで選んで次行の先頭で止まっている場合は1行減らす
  if (sel.end.character === 0 && sel.end.line > sel.start.line) end -= 1;
  return start === end ? `@${path}#${start}` : `@${path}#${start}-${end}`;
}

// フォルダは末尾に / を付けて、ファイルと区別できるようにする（@src/components/）
function buildFolderReference(uri: vscode.Uri): string {
  const path = relPath(uri);
  return path.endsWith('/') ? `@${path}` : `@${path}/`;
}

// 参照をまとめて 1 回だけクリップボードにコピーし、警告も 1 回だけ出す
async function copyReferences(refs: string[], reasons: Iterable<Reason>): Promise<void> {
  if (!refs.length) return;
  const text = refs.join(' ');
  await vscode.env.clipboard.writeText(text);
  const why = [...new Set(reasons)].join('。');
  // 通知は await しない（await するとユーザーが閉じるまで処理が止まる）
  void vscode.window.showWarningMessage(`${why}。参照をクリップボードにコピーしました: ${text}`);
}

// 公式コマンドを呼ぶ。送れたら undefined、送れなかったらその理由を返す
async function sendToClaude(): Promise<Reason | undefined> {
  if (!vscode.extensions.getExtension(CLAUDE_EXT_ID)) return REASONS.noExtension;
  try {
    await vscode.commands.executeCommand(CLAUDE_CMD);
    return undefined;
  } catch (err) {
    console.error('[right-click-mention]', err);
    return REASONS.failed;
  }
}

async function insertMention(editor: vscode.TextEditor): Promise<void> {
  const reason = await sendToClaude();
  if (reason) await copyReferences([buildReference(editor)], [reason]);
}

async function sendActiveEditor(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('アクティブなエディタがありません。');
    return;
  }
  await insertMention(editor);
}

async function isFolder(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.Directory) !== 0;
  } catch {
    return false; // 調べられないときはファイルとして扱う（開けなければ下でコピーに回る）
  }
}

// エクスプローラーから（複数選択対応）
// - ファイル: 開いて選択なしの状態にし、公式コマンドでチャットに送る
// - フォルダ・テキストで開けないファイル・送れなかったファイル: 参照を集めて最後に 1 回だけコピー
// VS Code は (右クリックしたもの, 選択中のもの一覧) を渡す。
// コマンドパレットなどから呼ばれると、どちらも undefined のことがある。
async function sendFiles(clicked?: vscode.Uri, selected?: (vscode.Uri | undefined)[]): Promise<void> {
  const uris = (selected && selected.length ? selected : [clicked]).filter(
    (u): u is vscode.Uri => Boolean(u),
  );
  const toCopy: string[] = [];
  const reasons: Reason[] = [];

  for (const uri of uris) {
    if (await isFolder(uri)) {
      toCopy.push(buildFolderReference(uri));
      reasons.push(REASONS.folder);
      continue;
    }

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch (err) {
      // 画像などテキストで開けないファイル
      console.error('[right-click-mention]', err);
      toCopy.push(`@${relPath(uri)}`);
      reasons.push(REASONS.notText);
      continue;
    }
    const editor = await vscode.window.showTextDocument(doc, {
      preview: true,
      preserveFocus: false,
      selection: new vscode.Range(0, 0, 0, 0),
    });
    const reason = await sendToClaude();
    if (reason) {
      toCopy.push(buildReference(editor));
      reasons.push(reason);
    }
  }

  await copyReferences(toCopy, reasons);
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.sendSelection, sendActiveEditor),
    vscode.commands.registerCommand(COMMANDS.sendCurrentFile, sendActiveEditor),
    vscode.commands.registerCommand(COMMANDS.sendFile, sendFiles),
  );
}

export function deactivate(): void {}

// テスト用に内部関数も公開（拡張の動作には使わない）
export const _internal = {
  CLAUDE_EXT_ID,
  CLAUDE_CMD,
  REASONS,
  relPath,
  buildReference,
  buildFolderReference,
  copyReferences,
  sendToClaude,
  insertMention,
  sendActiveEditor,
  sendFiles,
};
