// 統合テストの起動スクリプト
// テスト用の VS Code を初回だけダウンロードし、マルチルートのワークスペースを開いてテストを動かす
// 次の 2 回に分けて、別々の VS Code で動かす
// 1. 公式拡張なし（suite/）: ほかの拡張をすべて無効にし、クリップボードにコピーする経路を確かめる
// 2. 偽の公式拡張あり（fakeClaude/）: 公式コマンドを呼ぶ経路を、本物の VS Code の上で確かめる

import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

// VS Code の中（ターミナルや拡張）から実行すると ELECTRON_RUN_AS_NODE=1 が引き継がれる
// テスト用の VS Code が Node.js として起動してしまう
// テスト用の VS Code には渡さない
delete process.env.ELECTRON_RUN_AS_NODE;

// このファイルは out/test/integration/ にコンパイルされる
const ROOT = path.resolve(__dirname, '../../..');
const WORKSPACE = path.join(ROOT, 'src/test/fixtures/multi-root/multi-root.code-workspace');
const FAKE_CLAUDE = path.join(ROOT, 'src/test/fixtures/fake-claude-code');

interface Run {
  name: string;
  extensions: string[];
  tests: string;
}

const RUNS: Run[] = [
  { name: '公式拡張なし', extensions: [ROOT], tests: 'suite/index.js' },
  // 開発中の拡張は --disable-extensions でも読み込まれるので、偽の公式拡張だけが入った状態になる
  { name: '偽の公式拡張あり', extensions: [ROOT, FAKE_CLAUDE], tests: 'fakeClaude/index.js' },
];

async function main(): Promise<void> {
  // 引数で 1 つだけ選べる（例: node runTest.js fakeClaude）
  const only = process.argv[2];
  for (const run of RUNS.filter((r) => !only || r.tests.startsWith(only))) {
    console.log(`\n=== 統合テスト: ${run.name} ===`);
    await runTests({
      version: process.env.VSCODE_TEST_VERSION || 'stable',
      extensionDevelopmentPath: run.extensions,
      extensionTestsPath: path.resolve(__dirname, run.tests),
      launchArgs: [WORKSPACE, '--disable-extensions', '--disable-workspace-trust'],
    });
  }
}

main().catch((err) => {
  console.error('統合テストに失敗しました:', err);
  process.exit(1);
});
