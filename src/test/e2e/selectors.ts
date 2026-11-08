// E2E テストで使う、画面の部品の探し方（セレクタ）と、コマンドパレットでのコマンドの名前
// VS Code や公式拡張の画面が変わると壊れやすいので、ここ 1 か所にまとめる
// どれも、実際の画面（VS Code 1.145・公式拡張 2.1）を開いて調べたもの
// クラス名に付く、ビルドごとに変わる文字（messageInput_cKsPxg など）は使わない

/** VS Code の画面全体（起動しきったら現れる） */
export const WORKBENCH = '.monaco-workbench';

/** 左のサイドバーの見出し（クリックしても何も実行されず、フォーカスだけが移る） */
export const SIDEBAR_TITLE = '.part.sidebar.left .composite.title';

/** コマンドパレット・Quick Open の入力欄と、候補の行と、行の名前 */
export const QUICK_INPUT_BOX = '.quick-input-widget .quick-input-box input';
export const QUICK_INPUT_ROW = '.quick-input-widget .quick-input-list .monaco-list-row';
export const QUICK_INPUT_LABEL = '.label-name';

/** 右クリックメニューと、その項目（メニューバー用の隠れたメニューもあるので、見えているものに絞る） */
export const CONTEXT_MENU = '.context-view .monaco-menu:visible';
export const CONTEXT_MENU_ITEM = '.context-view .monaco-menu:visible .action-label';

/** 前面のエディタグループの、テキストのエディタの本文と、フォーカスがあるエディタ */
export const ACTIVE_EDITOR_TEXT = '.editor-group-container.active .monaco-editor .view-lines';
export const ACTIVE_EDITOR_FOCUSED = '.editor-group-container.active .monaco-editor.focused';

/** エディタのタブ（チャットやプレビューのタブも含む） */
export const ANY_TAB = '.editor-group-container .tab';

/** 右のサイドバー（閉じているときは見えない） */
export const SECONDARY_SIDE_BAR = '.part.auxiliarybar';

/** エディタのタブ（data-resource-name はファイル名だけ） */
export const tabByName = (name: string) => `.editor-group-container .tab[data-resource-name="${name}"]`;
export const activeTabByName = (name: string) => `${tabByName(name)}.active`;

/** そのファイルのタブがあるエディタグループで、前面にあるタブ（aria-label の先頭がタブの名前。プレビューは「Preview guide.md」） */
export const frontTabInGroupOf = (name: string) =>
  `.editor-group-container:has(.tab[data-resource-name="${name}"]) .tab.active`;

/** そのファイルのタブが前面にあるエディタグループの、テキストのエディタの本文 */
export const editorTextByName = (name: string) =>
  `.editor-group-container:has(.tab.active[data-resource-name="${name}"]) .monaco-editor .view-lines`;

/** エクスプローラーの行（aria-label にフルパスが入っている）と、開閉の矢印 */
export const explorerRowByPath = (fullPath: string) =>
  `.explorer-folders-view .monaco-list-row:has(.monaco-icon-label[aria-label="${fullPath.replace(/\\/g, '\\\\')}"])`;
export const EXPLORER_TWISTIE = '.monaco-tl-twistie';

/**
 * 公式拡張のチャットの入力欄（Webview の中）
 * div[contenteditable] に role="textbox" と aria-label="Message input" が付いている
 */
export const CHAT_INPUT = '[role="textbox"][aria-label="Message input"]';

/** 公式拡張のコマンドの、コマンドパレットでの名前 */
export const CLAUDE_FOCUS_INPUT = 'Claude Code: Focus input';
export const CLAUDE_OPEN_IN_SIDE_BAR = 'Claude Code: Open in Side Bar';
export const CLAUDE_OPEN_IN_NEW_TAB = 'Claude Code: Open in New Tab';

/** VS Code のコマンドの、コマンドパレットでの名前 */
export const CLOSE_ALL_EDITORS = 'View: Close All Editors';
export const FOCUS_ACTIVE_EDITOR_GROUP = 'View: Focus Active Editor Group';
export const FOCUS_FIRST_EDITOR_GROUP = 'View: Focus First Editor Group';
export const MOVE_EDITOR_TO_PREVIOUS_GROUP = 'View: Move Editor into Previous Group';
export const SHOW_EXPLORER = 'View: Show Explorer';
export const HIDE_SECONDARY_SIDE_BAR = 'View: Hide Secondary Side Bar';
export const CLEAR_NOTIFICATIONS = 'Notifications: Clear All Notifications';
export const REOPEN_WITH_TEXT_EDITOR = 'View: Reopen Editor with Text Editor';

/**
 * 組み込みの Markdown プレビューの中にある、プレビューの設定の要素
 * これがある Webview の中身を、プレビューとして扱う
 */
export const MARKDOWN_PREVIEW_DATA = '#vscode-markdown-preview-data';

/** 組み込みの Markdown 拡張のコマンドの、コマンドパレットでの名前 */
export const MARKDOWN_OPEN_PREVIEW = 'Markdown: Open Preview';
export const MARKDOWN_OPEN_PREVIEW_TO_SIDE = 'Markdown: Open Preview to the Side';
