// 拡張全体で使う定数

/** コマンド ID */
export const COMMANDS = {
  sendSelection: 'refsToChat.sendSelection',
  sendCurrentFile: 'refsToChat.sendCurrentFile',
  sendFile: 'refsToChat.sendFile',
  sendPreviewSelection: 'refsToChat.sendPreviewSelection',
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

/**
 * チャットの入力欄にフォーカスが移るまで待つ時間（ミリ秒）
 * 短いと、移りきる前の場所（エディタなど）に貼り付けてしまう
 * 待たされても気にならない 1 秒未満で、なるべく長くしている
 */
export const FOCUS_WAIT_MS = 800;

/**
 * 貼り付けたあと、ファイルに入ってしまっていないかを見張る時間（ミリ秒）
 * ファイルの変更は、貼り付けのコマンドが終わったあとに届くことがある
 */
export const PASTE_CHECK_MS = 150;

export const LOG_PREFIX = '[refs-to-chat]';

/** 設定（package.json の contributes.configuration と一致させる） */
export const SETTINGS = {
  section: 'refsToChat',
  /** エクスプローラーから送るファイルで、クリップボードを使うか */
  explorerClipboard: 'explorerClipboard',
  /** Markdown のプレビューの右クリックメニューに出すか（package.json の when で使うだけ） */
  markdownPreview: 'markdownPreview',
  /** Markdown のプレビューで選んだところを送るときに、クリップボードを使うか */
  previewClipboard: 'previewClipboard',
} as const;
