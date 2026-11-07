// VS Code の中で実行されるテストランナー（mocha）
'use strict';

const fs = require('fs');
const path = require('path');
const Mocha = require('mocha');

exports.run = function run() {
  const mocha = new Mocha({ ui: 'bdd', timeout: 20000, color: true });
  fs.readdirSync(__dirname)
    .filter((f) => f.endsWith('.itest.js'))
    .forEach((f) => mocha.addFile(path.join(__dirname, f)));

  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures ? reject(new Error(`${failures} 件のテストが失敗しました`)) : resolve()));
  });
};
