// Markdown のプレビューで選んだところを、元のファイルの行の範囲に直す（純粋な計算だけ）
// プレビューの中の値は media/markdownPreview.js が集め、右クリックのメニューからコマンドの引数で届く
// vscode に依存しないので、テストから直接読み込める

/**
 * プレビューのスクリプトが値を入れる data-vscode-context のキー
 * package.json のメニューの when でも、このキーがあるか（選択があるか）を見ている
 */
export const PREVIEW_CONTEXT_KEY = 'refsToChatPreviewSelection';

/** プレビューの中の位置（選択の始まりか終わり） */
export interface PreviewPoint {
  /** その位置を含むブロックの data-line（元のファイルの行、0 始まり） */
  readonly line: number;
  /** ブロックの中で、その位置より前にある改行の数 */
  readonly newlines: number;
  /** ブロックがコードブロックか */
  readonly code: boolean;
}

/** プレビューで選んだところ */
export interface PreviewSelection {
  /** 元のファイルの URI（文字列） */
  readonly source: string;
  readonly start: PreviewPoint;
  readonly end: PreviewPoint;
}

/** 行の範囲（0 始まりで、last の行も含む） */
export interface LineRange {
  readonly first: number;
  readonly last: number;
}

/**
 * コマンドの引数から、プレビューで選んだところを取り出す
 * 引数は data-vscode-context の中身なので、形が違えば undefined
 */
export function parsePreviewSelection(arg: unknown): PreviewSelection | undefined {
  if (!isObject(arg)) return undefined;
  const value = arg[PREVIEW_CONTEXT_KEY];
  if (!isObject(value) || typeof value.source !== 'string' || value.source === '') return undefined;
  const start = parsePoint(value.start);
  const end = parsePoint(value.end);
  if (!start || !end) return undefined;
  return { source: value.source, start, end };
}

function parsePoint(value: unknown): PreviewPoint | undefined {
  if (!isObject(value)) return undefined;
  const { line, newlines, code } = value;
  if (!isCount(line) || !isCount(newlines) || typeof code !== 'boolean') return undefined;
  return { line, newlines, code };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * プレビューで選んだところを、元のファイルの行の範囲にする
 * lines は元のファイルの各行
 * プレビューの行が元のファイルに収まらない（プレビューが古いなど）ときは undefined
 */
export function previewLineRange(selection: PreviewSelection, lines: readonly string[]): LineRange | undefined {
  const a = sourceLine(selection.start, lines);
  const b = sourceLine(selection.end, lines);
  if (a === undefined || b === undefined) return undefined;
  return { first: Math.min(a, b), last: Math.max(a, b) };
}

/** プレビューの中の位置を、元のファイルの行にする */
function sourceLine(point: PreviewPoint, lines: readonly string[]): number | undefined {
  if (point.line >= lines.length) return undefined;
  // フェンス（``` か ~~~）のコードブロックは、data-line がフェンスの行を指すので、中身は次の行から
  // インデントのコードブロックは、data-line が中身の 1 行目を指す
  const fenceOffset = point.code && FENCE.test(lines[point.line]) ? 1 : 0;
  // 改行の数え違いがあっても、ファイルの外は指さない
  return Math.min(point.line + fenceOffset + point.newlines, lines.length - 1);
}

/** フェンスのコードブロックの始まりの行（CommonMark: 3 つまでの空白 + ``` か ~~~ を 3 つ以上） */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
