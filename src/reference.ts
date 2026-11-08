// Claude のチャットに入れる参照の文字列（@src/app.ts#5-10 など）を作る
// vscode に依存しないので、テストから直接読み込める

interface Position {
  readonly line: number;
  readonly character: number;
}

/**
 * 行の範囲
 * vscode.Selection をそのまま渡せる
 */
export interface LineSelection {
  readonly isEmpty: boolean;
  readonly start: Position;
  readonly end: Position;
}

/**
 * ファイルの参照を作る
 * - 選択なし: `@src/app.ts`
 * - 1 行:     `@src/app.ts#8`
 * - 複数行:   `@src/app.ts#5-10`（行番号は 1 始まり）
 */
export function fileReference(path: string, selection?: LineSelection): string {
  if (!selection || selection.isEmpty) return `@${path}`;

  // 行末まで選ぶと、選択は次の行の先頭（0 文字目）で終わる
  // その次の行は含めない
  const endsAtNextLineStart = selection.end.character === 0 && selection.end.line > selection.start.line;
  const last = selection.end.line - (endsAtNextLineStart ? 1 : 0);

  return linesReference(path, selection.start.line, last);
}

/**
 * 行の範囲の参照を作る（first と last は 0 始まりで、last の行も含む）
 * - 1 行:   `@src/app.ts#8`
 * - 複数行: `@src/app.ts#5-10`
 */
export function linesReference(path: string, first: number, last: number): string {
  return first === last ? `@${path}#${first + 1}` : `@${path}#${first + 1}-${last + 1}`;
}

/**
 * フォルダの参照を作る
 * 末尾に / を付けてファイルと区別する（`@src/components/`）
 */
export function folderReference(path: string): string {
  return path.endsWith('/') ? `@${path}` : `@${path}/`;
}

/** 複数の参照を、チャットにそのまま貼れる形（空白区切り）にする */
export function joinReferences(refs: readonly string[]): string {
  return refs.join(' ');
}
