// 画面に出す文
// vscode に依存しないので、テストから直接読み込める

/** 公式コマンドでチャットに入れられなかった理由 */
export const REASON_MESSAGES = {
  notInstalled: '公式の Claude Code 拡張（anthropic.claude-code）が見つかりません',
  failed: 'Claudeのチャットに追加できませんでした',
  notText: 'テキストとして開けないファイルがあります',
  folder: 'フォルダはチャットに直接入れられません',
} as const;

export const MESSAGES = {
  noEditor: '開いているファイルがありません',
  pasted: (text: string) => `チャットに貼り付けました: ${text}（入っていなければ、チャットの入力欄で Ctrl+V を押してください）`,
  copied: (why: string, text: string) => `${why}。参照をクリップボードにコピーしました: ${text}`,
} as const;
