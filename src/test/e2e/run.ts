// E2E テストの起動スクリプト（npm run test:e2e）
// 本物の VS Code に、本物の公式拡張とこの拡張の VSIX を入れて、画面を操作して確かめる
// 手元の PC で動かすためのもの
// 公式拡張へのログインが要るので、CI では動かさない
//
// VSIX は、この前に npm の pretest:e2e で作っておく（作るときに out/ を作り直すため）
// 1. 準備（npm run test:e2e:setup）が済んでいるか、テストのファイルに変更や余分なものがないかを確かめる
// 2. VSIX を E2E 用のフォルダに入れる
// 3. *.e2e.js を mocha で動かす
// 4. テストのファイル（フィクスチャ）が変わっていないか確かめる

import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Mocha = require('mocha');
import { CLAUDE_EXTENSION_ID, EXTENSIONS_DIR, FIXTURES, ROOT, VSIX } from './paths';
import { runCli, vscodeExecutable, writeBaseSettings } from './vscode';

/** 名前を変える前の、この拡張の ID（E2E 用のフォルダに残っていると、新旧 2 つが同時に動く） */
const OLD_EXTENSION_IDS = ['kip2.right-click-mention'];

/**
 * フィクスチャにあってはいけないもの
 * E2E は本物の公式拡張を自分のアカウントで動かすので、フックや MCP の設定などが紛れ込むと、そのまま動いてしまう
 */
const FORBIDDEN_IN_FIXTURES = new Set(['.claude', '.mcp.json', 'CLAUDE.md', 'CLAUDE.local.md', '.vscode']);

function installedExtensions(): string[] {
  return fs.existsSync(EXTENSIONS_DIR) ? fs.readdirSync(EXTENSIONS_DIR).map((name) => name.toLowerCase()) : [];
}

function isSetUp(): boolean {
  return installedExtensions().some((name) => name.startsWith(`${CLAUDE_EXTENSION_ID}-`));
}

/**
 * フィクスチャの git の状態（変更があれば、その一覧）
 * git で無視しているファイルも数える
 */
function fixtureStatus(): string {
  const result = cp.spawnSync('git', ['status', '--porcelain', '--ignored', '--', FIXTURES], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`git status に失敗しました: ${result.stderr || String(result.error)}`);
  return result.stdout;
}

/** フィクスチャの中で、あってはいけない名前のもの */
function forbiddenInFixtures(dir = FIXTURES): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (FORBIDDEN_IN_FIXTURES.has(entry.name)) return [full];
    return entry.isDirectory() ? forbiddenInFixtures(full) : [];
  });
}

async function main(): Promise<void> {
  if (!isSetUp()) {
    console.error('E2E テストの準備ができていません。先に npm run test:e2e:setup を実行してください。');
    process.exit(1);
  }
  if (!fs.existsSync(VSIX)) {
    console.error(`VSIX がありません: ${VSIX}（npm run test:e2e で動かしてください）`);
    process.exit(1);
  }

  const before = fixtureStatus();
  if (before) {
    console.error(`テストのファイル（${FIXTURES}）に、変更か余分なファイルがあります。元に戻してから動かしてください。\n${before}`);
    process.exit(1);
  }
  const forbidden = forbiddenInFixtures();
  if (forbidden.length > 0) {
    console.error(`テストのファイルの中に、あってはいけないものがあります。中身を確かめてください。\n${forbidden.join('\n')}`);
    process.exit(1);
  }

  const executable = await vscodeExecutable();
  for (const id of OLD_EXTENSION_IDS) {
    if (installedExtensions().some((name) => name.startsWith(`${id}-`))) runCli(executable, ['--uninstall-extension', id]);
  }
  runCli(executable, ['--install-extension', VSIX, '--force']);
  writeBaseSettings();

  // E2E_GREP にテスト名の一部（正規表現）を入れると、そのテストだけを流す
  const grep = process.env.E2E_GREP;
  const mocha = new Mocha({ ui: 'bdd', timeout: 120_000, color: true, ...(grep ? { grep: new RegExp(grep) } : {}) });
  fs.readdirSync(__dirname)
    .filter((f) => f.endsWith('.e2e.js'))
    .forEach((f) => mocha.addFile(path.join(__dirname, f)));
  const failures = await new Promise<number>((resolve) => mocha.run(resolve));

  const after = fixtureStatus();
  if (after !== before) {
    console.error(`テストのファイル（${FIXTURES}）が書き換わりました。git diff で確かめて、元に戻してください。\n${after}`);
    process.exit(1);
  }
  if (failures) {
    console.error(`${failures} 件の E2E テストが失敗しました`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('E2E テストに失敗しました:', err);
  process.exit(1);
});
