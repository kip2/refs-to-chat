// 統合テストの起動スクリプト。
// テスト用のVS Codeを（初回のみ）ダウンロードし、マルチルートのワークスペースを開いて
// suite/ 以下の *.itest.js を実際の VS Code API 上で実行する。
// 他の拡張（公式 Claude 拡張を含む）は無効にするので、フォールバック経路を確認するテストになる。
'use strict';

const path = require('path');
const { runTests } = require('@vscode/test-electron');

// VS Code の中（ターミナルや拡張）から実行すると ELECTRON_RUN_AS_NODE=1 が引き継がれ、
// テスト用の VS Code が Node.js として起動してしまう。テスト用の VS Code には渡さない。
delete process.env.ELECTRON_RUN_AS_NODE;

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, 'suite/index.js');
  const workspace = path.resolve(__dirname, '../fixtures/multi-root/multi-root.code-workspace');

  await runTests({
    version: process.env.VSCODE_TEST_VERSION || 'stable',
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust'],
  });
}

main().catch((err) => {
  console.error('統合テストに失敗しました:', err);
  process.exit(1);
});
