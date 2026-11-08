// チャットに入れるもの（Target）の型
// 右クリックの入口（sources/）がこの形に直し、入れ方（delivery/）はこの形だけを見る

import type * as vscode from 'vscode';

/**
 * チャットに入れるもの
 * - editor: 前面のエディタ（選択範囲があれば、その行）
 *   公式コマンドがエディタから直接参照を作る
 * - file: ファイル
 * - folder: フォルダ
 * - lines: ファイルの行の範囲（first と last は 0 始まりで、last の行も含む）
 */
export type Target =
  | { readonly kind: 'editor'; readonly editor: vscode.TextEditor }
  | { readonly kind: 'file'; readonly uri: vscode.Uri }
  | { readonly kind: 'folder'; readonly uri: vscode.Uri }
  | { readonly kind: 'lines'; readonly uri: vscode.Uri; readonly first: number; readonly last: number };

/** Target の URI（editor ならそのドキュメントの URI） */
export function uriOf(target: Target): vscode.Uri {
  return target.kind === 'editor' ? target.editor.document.uri : target.uri;
}
