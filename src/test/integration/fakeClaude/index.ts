// 偽の公式拡張ありの統合テスト（VS Code の中で実行される）

import { runItestsIn } from '../mochaRunner';

export function run(): Promise<void> {
  return runItestsIn(__dirname);
}
