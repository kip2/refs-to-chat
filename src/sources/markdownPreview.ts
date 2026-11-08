// Markdown のプレビューの右クリック（選択範囲あり）
// 引数は、プレビューのスクリプト（media/markdownPreview.js）が入れた data-vscode-context の中身

import * as vscode from 'vscode';
import { previewClipboard } from '../config';
import { MESSAGES } from '../messages';
import { readLines } from '../workspace';
import { parsePreviewSelection, previewLineRange } from './previewLines';
import type { Source } from './source';

export const markdownPreviewSource: Source<[context?: unknown]> = {
  async collect(context) {
    const selection = parsePreviewSelection(context);
    const uri = selection && parseUri(selection.source);
    const lines = uri && (await readLines(uri));
    const range = selection && lines && previewLineRange(selection, lines);
    if (!uri || !range) return { notice: MESSAGES.noPreviewSelection };
    return { targets: [{ kind: 'lines', uri, first: range.first, last: range.last }] };
  },
  clipboard: previewClipboard,
};

function parseUri(value: string): vscode.Uri | undefined {
  try {
    return vscode.Uri.parse(value, true);
  } catch {
    return undefined;
  }
}
