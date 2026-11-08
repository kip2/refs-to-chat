// E2E テストで使うフォルダとファイルの場所
// 普段の VS Code とは別の、E2E 専用のユーザーデータと拡張のフォルダを使う（.vscode-test/e2e/、git には入れない）
// ただし、公式拡張のログインは PC 全体で共通（~/.claude）なので、E2E も自分のアカウントで動く

import * as path from 'node:path';

// このファイルは out/test/e2e/ にコンパイルされる
export const ROOT = path.resolve(__dirname, '../../..');
export const E2E_DIR = path.join(ROOT, '.vscode-test', 'e2e');
export const USER_DATA_DIR = path.join(E2E_DIR, 'user-data');
export const EXTENSIONS_DIR = path.join(E2E_DIR, 'extensions');
export const USER_SETTINGS = path.join(USER_DATA_DIR, 'User', 'settings.json');
export const VSIX = path.join(E2E_DIR, 'refs-to-chat.vsix');
/** 失敗したテストの画面 */
export const SCREENSHOTS_DIR = path.join(E2E_DIR, 'screenshots');

export const FIXTURES = path.join(ROOT, 'src', 'test', 'fixtures', 'multi-root');
export const WORKSPACE = path.join(FIXTURES, 'multi-root.code-workspace');

/** フィクスチャのファイルのフルパス（例: fixture('alpha/src/app.js')） */
export const fixture = (rel: string) => path.join(FIXTURES, ...rel.split('/'));

export const CLAUDE_EXTENSION_ID = 'anthropic.claude-code';
