// VS Code の中で、あるフォルダの *.itest.js を mocha で動かす
// 統合テストの実行（公式拡張なし・偽の公式拡張あり）ごとに、index.ts からこれを呼ぶ

import * as fs from 'node:fs';
import * as path from 'node:path';
import Mocha = require('mocha');

export function runItestsIn(dir: string): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', timeout: 20000, color: true });
  fs.readdirSync(dir)
    .filter((f) => f.endsWith('.itest.js'))
    .forEach((f) => mocha.addFile(path.join(dir, f)));

  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures ? reject(new Error(`${failures} 件のテストが失敗しました`)) : resolve()));
  });
}
