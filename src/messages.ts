// 画面に出す文
// vscode に依存しないので、テストから直接読み込める

/** 公式コマンドで入れない理由（警告に出す） */
export const REASON_MESSAGES = {
  notInstalled: '公式の Claude Code 拡張（anthropic.claude-code）が見つかりません',
  failed: 'Claudeのチャットに追加できませんでした',
  notText: 'テキストとして開けないファイルがあります',
  folder: 'フォルダはチャットに直接入れられません',
  pasteFile: 'チャットに貼り付けられませんでした',
} as const;

// 貼り付けの通知に参照を並べる上限
// 多いと通知が長くなって読めないので、超えたら件数だけにする
const PASTED_LIST_LIMIT = 3;

export const MESSAGES = {
  noEditor: '開いているファイルがありません',
  noTarget: '追加するファイルやフォルダがありません',
  pasted: (refs: readonly string[]) => {
    const what = refs.length > PASTED_LIST_LIMIT ? `${refs.length} 件` : refs.join(' ');
    return `チャットに貼り付けました: ${what}（入っていなければ、チャットの入力欄で Ctrl+V を押してください）`;
  },
  copied: (why: string, text: string) => `${why}。参照をクリップボードにコピーしました: ${text}`,
} as const;
