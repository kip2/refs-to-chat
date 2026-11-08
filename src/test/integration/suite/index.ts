// 公式拡張なしの統合テスト（VS Code の中で実行される）

import { runItestsIn } from '../mochaRunner';

export function run(): Promise<void> {
  return runItestsIn(__dirname);
}
