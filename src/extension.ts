// Right Click Mention
// 右クリックメニューから、選択範囲・ファイル・フォルダの参照（@src/app.ts#5-10 など）を
// 公式 Claude Code 拡張のチャットに入れる。
// 対象は VS Code のパネル版のみ（claudeCode.useTerminal = true のときはメニュー自体を出さない）。
//
// ファイルの役目:
//   extension.ts  … コマンドの登録（このファイル）
//   commands.ts   … 2 つのコマンドの処理
//   claudeChat.ts … 公式拡張とのやり取り
//   fallback.ts   … 公式コマンドで入れられなかったときの貼り付け・コピー
//   workspace.ts  … パスの変換、フォルダの判定、ファイルを開く
//   reference.ts  … 参照の文字列を作る（vscode に依存しない）
//   constants.ts  … コマンド ID などの定数（vscode に依存しない）

import * as vscode from 'vscode';
import { addActiveEditorToChat, addExplorerItemsToChat } from './commands';
import { COMMANDS } from './constants';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.sendSelection, addActiveEditorToChat),
    vscode.commands.registerCommand(COMMANDS.sendCurrentFile, addActiveEditorToChat),
    vscode.commands.registerCommand(COMMANDS.sendFile, addExplorerItemsToChat),
  );
}

export function deactivate(): void {}
