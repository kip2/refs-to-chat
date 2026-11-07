// 統合テストの起動スクリプト
// テスト用の VS Code を（初回だけ）ダウンロードし、マルチルートのワークスペースを開いて
// suite/ 以下の *.itest.js を本物の VS Code API の上で実行する
// 他の拡張（公式 Claude 拡張を含む）は無効にするので、フォールバック経路を確かめるテストになる

import * as path from 'path';
import { runTests } from '@vscode/test-electron';

// VS Code の中（ターミナルや拡張）から実行すると ELECTRON_RUN_AS_NODE=1 が引き継がれ、
// テスト用の VS Code が Node.js として起動してしまう
// テスト用の VS Code には渡さない
delete process.env.ELECTRON_RUN_AS_NODE;

// このファイルは out/test/integration/ にコンパイルされる
const ROOT = path.resolve(__dirname, '../../..');

async function main(): Promise<void> {
  await runTests({
    version: process.env.VSCODE_TEST_VERSION || 'stable',
    extensionDevelopmentPath: ROOT,
    extensionTestsPath: path.resolve(__dirname, 'suite/index.js'),
    launchArgs: [
      path.join(ROOT, 'src/test/fixtures/multi-root/multi-root.code-workspace'),
      '--disable-extensions',
      '--disable-workspace-trust',
    ],
  });
}

main().catch((err) => {
  console.error('統合テストに失敗しました:', err);
  process.exit(1);
});
