// 拡張全体で使う定数。vscode に依存しないので、テストから直接読み込める。

/**
 * この拡張のコマンド ID。package.json の contributes.commands と一致させる（manifest.test.js で確認）。
 * 0.0.1 で公開済みのため、ユーザーのキーボードショートカットを壊さないよう変えない。
 */
export const COMMANDS = {
  /** エディタで範囲を選んで右クリック */
  sendSelection: 'rightClickMention.sendSelection',
  /** エディタで何も選ばずに右クリック */
  sendCurrentFile: 'rightClickMention.sendCurrentFile',
  /** エクスプローラーでファイル・フォルダを右クリック */
  sendFile: 'rightClickMention.sendFile',
} as const;

/** 公式 Claude Code 拡張。使うのはコマンドパレットに出ている公開コマンドだけ */
export const CLAUDE = {
  extensionId: 'anthropic.claude-code',
  /** Claude Code: Insert @-Mention Reference（Alt+K）。アクティブなエディタの参照をチャットに入れる */
  insertMentionCommand: 'claude-vscode.insertAtMention',
  /** Claude Code: Focus input。チャットの入力欄にフォーカスを移す */
  focusInputCommand: 'claude-vscode.focus',
} as const;

/** VS Code 標準の貼り付け。フォーカスのある場所にクリップボードの中身を貼る */
export const PASTE_COMMAND = 'editor.action.clipboardPasteAction';

/** チャットの入力欄にフォーカスが移るまで待つ時間（ミリ秒） */
export const FOCUS_WAIT_MS = 150;

/** console.error に付ける目印 */
export const LOG_PREFIX = '[right-click-mention]';
