// Right Click Mention
// 公式Claude Code拡張の「Insert @-Mention Reference」(Alt+K) を右クリックから呼ぶだけの拡張。
// Claude Code拡張が無い・失敗した場合は @参照 をクリップボードにコピーする。
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

async function fallbackCopy(editor: vscode.TextEditor, reason: string): Promise<void> {
  const ref = buildReference(editor);
  await vscode.env.clipboard.writeText(ref);
  // 通知は await しない（await するとユーザーが閉じるまで処理が止まる）
  void vscode.window.showWarningMessage(`${reason} 参照をクリップボードにコピーしました: ${ref}`);
}

async function insertMention(editor: vscode.TextEditor): Promise<void> {
  if (!vscode.extensions.getExtension(CLAUDE_EXT_ID)) {
    await fallbackCopy(editor, 'Claude Code拡張が見つかりません。');
    return;
  }
  try {
    await vscode.commands.executeCommand(CLAUDE_CMD);
  } catch (err) {
    console.error('[right-click-mention]', err);
    await fallbackCopy(editor, 'Claudeへの送信に失敗しました。');
  }
}

async function sendActiveEditor(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('アクティブなエディタがありません。');
    return;
  }
  await insertMention(editor);
}

// エクスプローラーから（複数選択対応）: ファイルを開いて選択なしの状態で送る
// VS Code は (右クリックしたファイル, 選択中のファイル一覧) を渡す。
// コマンドパレットなどから呼ばれると、どちらも undefined のことがある。
async function sendFiles(clicked?: vscode.Uri, selected?: (vscode.Uri | undefined)[]): Promise<void> {
  const uris = (selected && selected.length ? selected : [clicked]).filter(
    (u): u is vscode.Uri => Boolean(u),
  );
  if (!uris.length) return;
  for (const uri of uris) {
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch (err) {
      // 画像などテキストで開けないファイル
      console.error('[right-click-mention]', err);
      const path = relPath(uri);
      await vscode.env.clipboard.writeText(`@${path}`);
      void vscode.window.showWarningMessage(`テキストとして開けないため参照をコピーしました: @${path}`);
      continue;
    }
    const editor = await vscode.window.showTextDocument(doc, {
      preview: true,
      preserveFocus: false,
      selection: new vscode.Range(0, 0, 0, 0),
    });
    await insertMention(editor);
  }
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
  relPath,
  buildReference,
  fallbackCopy,
  insertMention,
  sendActiveEditor,
  sendFiles,
};
