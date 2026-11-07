// Claude Right Click
// 公式Claude Code拡張の「Insert @-Mention Reference」(Alt+K) を右クリックから呼ぶだけの拡張。
// Claude Code拡張が無い・失敗した場合は @参照 をクリップボードにコピーする。
// 対象はVS Codeのパネル版のみ（claudeCode.useTerminal = true のときはメニュー自体を出さない）。

const vscode = require('vscode');

const CLAUDE_EXT_ID = 'anthropic.claude-code';
const CLAUDE_CMD = 'claude-vscode.insertAtMention';

// 公式拡張と同じパス形式: 単一フォルダなら "src/app.ts"、
// 複数フォルダ（マルチルート）なら "フォルダ名/src/app.ts"、ワークスペース外なら絶対パス
function relPath(uri) {
  return vscode.workspace.asRelativePath(uri);
}

// @src/app.ts#5-10 形式の参照を組み立てる（フォールバック用）
function buildReference(editor) {
  const path = relPath(editor.document.uri);
  const sel = editor.selection;
  if (!sel || sel.isEmpty) return `@${path}`;
  const start = sel.start.line + 1;
  let end = sel.end.line + 1;
  // 行末まで選んで次行の先頭で止まっている場合は1行減らす
  if (sel.end.character === 0 && sel.end.line > sel.start.line) end -= 1;
  return start === end ? `@${path}#${start}` : `@${path}#${start}-${end}`;
}

async function fallbackCopy(editor, reason) {
  const ref = buildReference(editor);
  await vscode.env.clipboard.writeText(ref);
  vscode.window.showWarningMessage(`${reason} 参照をクリップボードにコピーしました: ${ref}`);
}

async function insertMention(editor) {
  if (!vscode.extensions.getExtension(CLAUDE_EXT_ID)) {
    return fallbackCopy(editor, 'Claude Code拡張が見つかりません。');
  }
  try {
    await vscode.commands.executeCommand(CLAUDE_CMD);
  } catch (err) {
    console.error('[claude-right-click]', err);
    await fallbackCopy(editor, 'Claudeへの送信に失敗しました。');
  }
}

async function sendActiveEditor() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('アクティブなエディタがありません。');
    return;
  }
  await insertMention(editor);
}

// エクスプローラーから（複数選択対応）: ファイルを開いて選択なしの状態で送る
async function sendFiles(clicked, selected) {
  const uris = (selected && selected.length ? selected : [clicked]).filter(Boolean);
  if (!uris.length) return;
  for (const uri of uris) {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, {
        preview: true,
        preserveFocus: false,
        selection: new vscode.Range(0, 0, 0, 0),
      });
      await insertMention(editor);
    } catch (err) {
      // 画像などテキストで開けないファイル
      const path = relPath(uri);
      await vscode.env.clipboard.writeText(`@${path}`);
      vscode.window.showWarningMessage(`テキストとして開けないため参照をコピーしました: @${path}`);
    }
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeRightClick.sendSelection', sendActiveEditor),
    vscode.commands.registerCommand('claudeRightClick.sendCurrentFile', sendActiveEditor),
    vscode.commands.registerCommand('claudeRightClick.sendFile', sendFiles),
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  // テスト用に内部関数も公開（拡張の動作には使わない）
  _internal: { CLAUDE_EXT_ID, CLAUDE_CMD, relPath, buildReference, fallbackCopy, insertMention, sendActiveEditor, sendFiles },
};
