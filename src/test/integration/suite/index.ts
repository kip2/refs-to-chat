// VS Code の中で実行されるテストランナー（mocha）

import * as fs from 'fs';
import * as path from 'path';
import Mocha = require('mocha');

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', timeout: 20000, color: true });
  fs.readdirSync(__dirname)
    .filter((f) => f.endsWith('.itest.js'))
    .forEach((f) => mocha.addFile(path.join(__dirname, f)));

  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures ? reject(new Error(`${failures} 件のテストが失敗しました`)) : resolve()));
  });
}
