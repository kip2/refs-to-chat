// 拡張全体で使う定数

/** コマンド ID */
export const COMMANDS = {
  sendSelection: 'rightClickMention.sendSelection',
  sendCurrentFile: 'rightClickMention.sendCurrentFile',
  sendFile: 'rightClickMention.sendFile',
} as const;

/**
 * 公式 Claude Code 拡張
 * 使うのはコマンドパレットに出ている公開コマンドだけ
 */
export const CLAUDE = {
  extensionId: 'anthropic.claude-code',
  /**
   * 「Insert @-Mention Reference」（Alt+K）
   * アクティブなエディタの参照をチャットに入れる
   */
  insertMentionCommand: 'claude-vscode.insertAtMention',
  /**
   * 「Focus input」
   * チャットの入力欄にフォーカスを移す
   */
  focusInputCommand: 'claude-vscode.focus',
} as const;

/** VS Code 標準の貼り付け */
export const PASTE_COMMAND = 'editor.action.clipboardPasteAction';

/** チャットの入力欄にフォーカスが移るまで待つ時間（ミリ秒） */
export const FOCUS_WAIT_MS = 150;

export const LOG_PREFIX = '[right-click-mention]';
