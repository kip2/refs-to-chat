// 統合テスト専用の偽の公式拡張（Claude Code）
// 拡張の ID を anthropic.claude-code に合わせ、Refs to Chat が呼ぶ公開コマンドだけを用意する
// 本物のチャットはなく、コマンドが呼ばれた瞬間の状態を記録する
// テストは、この拡張の exports（activate が返すもの）から記録を読む
'use strict';

const vscode = require('vscode');

// チャットの置き場所
// editorTab: 右のグループのタブに開く（本物と同じく Webview で、入力欄だけを置く）
// 貼り付けはこの入力欄に入るので、テストのファイルは汚れない
// sidebar: サイドバーにある想定で、focus してもエディタは動かない
// 貼り付け先がないので、このモードでは貼り付けの経路を試さない
const CHAT_MODES = ['editorTab', 'sidebar'];

const CHAT_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
<style>textarea { width: 90%; height: 6em; }</style>
</head>
<body>
<textarea id="input" autofocus></textarea>
<script>
  const vscode = acquireVsCodeApi();
  const input = document.getElementById('input');
  const report = () => vscode.postMessage({ type: 'text', value: input.value });
  input.addEventListener('input', report);
  window.addEventListener('message', (e) => {
    if (e.data.type === 'focus') input.focus();
  });
  window.addEventListener('focus', () => input.focus());
</script>
</body>
</html>`;

function activate(context) {
  const state = {
    calls: [],
    chatMode: 'editorTab',
    failInsert: false,
    failFocus: false,
    /** @type {vscode.WebviewPanel | undefined} */
    panel: undefined,
    chatText: '',
  };

  /** 呼ばれた瞬間のアクティブなエディタと選択範囲 */
  function snapshot(id) {
    const editor = vscode.window.activeTextEditor;
    const s = editor?.selection;
    return {
      id,
      editor: editor
        ? {
            uri: editor.document.uri.toString(),
            selection: [s.start.line, s.start.character, s.end.line, s.end.character],
          }
        : undefined,
    };
  }

  async function showChat() {
    if (state.chatMode !== 'editorTab') return;
    if (state.panel) {
      state.panel.reveal(vscode.ViewColumn.Two, false);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'fakeClaudeChat',
        'Fake Claude Chat',
        { viewColumn: vscode.ViewColumn.Two, preserveFocus: false },
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
      );
      panel.webview.onDidReceiveMessage((msg) => {
        if (msg.type === 'text') state.chatText = msg.value;
      });
      // 閉じたのが今のパネルのときだけ、記録を消す
      panel.onDidDispose(() => {
        if (state.panel !== panel) return;
        state.panel = undefined;
        state.chatText = '';
      });
      panel.webview.html = CHAT_HTML;
      state.panel = panel;
    }
    await state.panel.webview.postMessage({ type: 'focus' });
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('claude-vscode.focus', async () => {
      state.calls.push(snapshot('focus'));
      if (state.failFocus) throw new Error('偽の公式拡張: focus を失敗させた');
      await showChat();
    }),
    vscode.commands.registerCommand('claude-vscode.insertAtMention', async () => {
      state.calls.push(snapshot('insert'));
      if (state.failInsert) throw new Error('偽の公式拡張: insertAtMention を失敗させた');
      // 本物も、参照を入れたあとチャットにフォーカスを移す
      await showChat();
    }),
  );

  return {
    /** 呼ばれた順の記録 */
    get calls() {
      return state.calls;
    },
    setChatMode(mode) {
      if (!CHAT_MODES.includes(mode)) throw new Error(`知らないチャットの置き場所: ${mode}`);
      state.chatMode = mode;
    },
    setFail({ insert = false, focus = false } = {}) {
      state.failInsert = insert;
      state.failFocus = focus;
    },
    /** チャットの入力欄の中身 */
    chatText() {
      return state.chatText;
    },
    isChatOpen() {
      return state.panel !== undefined;
    },
    /** テストごとに初期状態に戻す（チャットも閉じる） */
    reset() {
      state.calls = [];
      state.chatMode = 'editorTab';
      state.failInsert = false;
      state.failFocus = false;
      const panel = state.panel;
      state.panel = undefined;
      state.chatText = '';
      panel?.dispose();
    },
  };
}

function deactivate() {}

module.exports = { activate, deactivate };
