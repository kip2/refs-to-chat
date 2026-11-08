// E2E テストの準備（npm run test:e2e:setup）
// 1. E2E 用の VS Code をダウンロードする（初回だけ）
// 2. E2E 専用のフォルダ（.vscode-test/e2e/）に、公式の Claude Code 拡張を入れる
// 3. その VS Code を起動するので、人がチャットを開いてログインし、終わったら閉じる
// 4. もう一度起動して、チャットの入力欄が出るか（ログインできたか）を確かめる

import * as cp from 'node:child_process';
import { CLAUDE_EXTENSION_ID, EXTENSIONS_DIR, USER_DATA_DIR, WORKSPACE } from './paths';
import { CLAUDE_FOCUS_INPUT } from './selectors';
import { runCli, VSCode, vscodeExecutable, writeBaseSettings } from './vscode';

/** これより早く VS Code が終わったら、ウィンドウが開かなかったとみなす */
const TOO_QUICK_MS = 10_000;

async function main(): Promise<void> {
  const executable = await vscodeExecutable();

  console.log(`公式の Claude Code 拡張（${CLAUDE_EXTENSION_ID}）を E2E 用のフォルダに入れます`);
  runCli(executable, ['--install-extension', CLAUDE_EXTENSION_ID, '--force']);
  writeBaseSettings();

  console.log('');
  console.log('E2E 用の VS Code を起動します。次をしてください。');
  console.log('  1. 左のアクティビティバーの Claude のアイコンを押して、チャットを開く');
  console.log('  2. ログインの画面が出たら、案内に従ってログインする（入力欄が出ていれば、ログイン済み）');
  console.log('  3. 何も送信せずに、VS Code を閉じる');
  console.log('');

  const started = Date.now();
  const child = cp.spawn(executable, ['--user-data-dir', USER_DATA_DIR, '--extensions-dir', EXTENSIONS_DIR, WORKSPACE], {
    stdio: 'ignore',
  });
  await new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', () => resolve());
  });
  if (Date.now() - started < TOO_QUICK_MS) {
    console.warn('VS Code がすぐに終わりました。E2E 用の VS Code がすでに開いていれば、閉じてからもう一度実行してください。');
  }

  console.log('ログインできたかを確かめます（何も送信しません）');
  const code = await VSCode.launch();
  try {
    await code.runCommand(CLAUDE_FOCUS_INPUT);
    if (!(await code.waitForChatInput())) {
      console.error('チャットの入力欄が出ませんでした。もう一度 npm run test:e2e:setup を実行して、ログインしてください。');
      process.exitCode = 1;
      return;
    }
  } finally {
    await code.close();
  }
  console.log('準備ができました。npm run test:e2e で E2E テストを動かせます。');
}

main().catch((err) => {
  console.error('E2E テストの準備に失敗しました:', err);
  process.exit(1);
});
