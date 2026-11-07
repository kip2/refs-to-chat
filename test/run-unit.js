// test/unit 以下の *.test.js を node:test で実行する（Windows / 古いNodeでもグロブ不要）
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'unit');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).map((f) => path.join(dir, f));
const extra = process.argv.slice(2); // 例: --test-reporter=spec
const r = spawnSync(process.execPath, ['--test', ...extra, ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
