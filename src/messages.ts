// 画面に出す文
// vscode に依存しないので、テストから直接読み込める

/** チャットに入れられず、クリップボードにコピーした理由（警告に出す） */
export const REASON_MESSAGES = {
  notInstalled: '公式の Claude Code 拡張（anthropic.claude-code）が見つからないか、動いていません',
  failed: 'Claudeのチャットに追加できませんでした',
  pasteFailed: 'チャットに貼り付けられませんでした',
  leftInFile: 'チャットに貼り付けられず、開いているファイルに入ったかもしれません（Ctrl+Z で戻してください）',
} as const;

export const MESSAGES = {
  noEditor: '開いているファイルがありません',
  noTarget: '追加するファイルやフォルダがありません',
  noPreviewSelection:
    'プレビューで選んだところが、元のファイルのどの行か分かりませんでした。プレビューを開き直してから、もう一度試してください',
  copied: (why: string, text: string) => `${why}。参照をクリップボードにコピーしました: ${text}`,
  unsafeName: (count: number) =>
    `ファイル名に改行などの特別な文字が入っているものが ${count} 件あったので、追加もコピーもしませんでした`,
} as const;
