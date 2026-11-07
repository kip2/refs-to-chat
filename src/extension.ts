// Right Click Mention: 右クリックから、選択範囲・ファイル・フォルダの参照を Claude のチャットに入れる
// パネル版だけが対象（claudeCode.useTerminal = true のときはメニューを出さない）
// 各ファイルの役目は docs/ARCHITECTURE.md の 4 章を参照

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
