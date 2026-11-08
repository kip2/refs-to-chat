// エクスプローラーの右クリック（ファイル・フォルダ、複数選択可）

import type * as vscode from 'vscode';
import { explorerClipboard } from '../config';
import { MESSAGES } from '../messages';
import type { Target } from '../target';
import { isFolder } from '../workspace';
import type { Source } from './source';

/**
 * 引数は (右クリックしたもの, 選択中の一覧)
 * コマンドパレットやキーボードショートカットから呼ぶと、両方 undefined のことがある
 */
type ExplorerArgs = [clicked?: vscode.Uri, selected?: readonly (vscode.Uri | undefined)[]];

export const explorerSource: Source<ExplorerArgs> = {
  async collect(clicked, selected) {
    const uris = (selected?.length ? selected : [clicked]).filter((u): u is vscode.Uri => u != null);
    if (uris.length === 0) return { notice: MESSAGES.noTarget };
    // 選んだ順に並べる
    const targets: Target[] = [];
    for (const uri of uris) targets.push({ kind: (await isFolder(uri)) ? 'folder' : 'file', uri });
    return { targets };
  },
  clipboard: explorerClipboard,
};
