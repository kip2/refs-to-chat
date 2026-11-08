// Refs to Chat: 右クリックから、選択範囲・ファイル・フォルダの参照を Claude のチャットに入れる
// パネル版だけが対象（claudeCode.useTerminal = true のときはメニューを出さない）
// 各ファイルの役目は docs/ARCHITECTURE.md の 4 章を参照

import * as vscode from 'vscode';
import { addToChat } from './addToChat';
import { COMMANDS } from './constants';
import { editorSource } from './sources/editor';
import { explorerSource } from './sources/explorer';
import { markdownPreviewSource } from './sources/markdownPreview';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.sendSelection, addToChat(editorSource)),
    vscode.commands.registerCommand(COMMANDS.sendCurrentFile, addToChat(editorSource)),
    vscode.commands.registerCommand(COMMANDS.sendFile, addToChat(explorerSource)),
    vscode.commands.registerCommand(COMMANDS.sendPreviewSelection, addToChat(markdownPreviewSource)),
  );
}

export function deactivate(): void {}
