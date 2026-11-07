// ESLint の設定
// 型情報を使うおすすめのルール一式（recommendedTypeChecked）だけを使い、増やしすぎない

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // コンパイル結果、依存、テスト用の VS Code、統合テスト用のサンプル、この設定ファイル自身
    ignores: ['out/', 'node_modules/', '.vscode-test/', 'src/test/fixtures/', 'eslint.config.mjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // TypeScript の import x = require('...') は使ってよい（mocha や module など、export = の型のため）
      '@typescript-eslint/no-require-imports': ['error', { allowAsImport: true }],
      // await 忘れの Promise を見つける
      // VS Code の API は Promise ではなく Thenable を返すので、checkThenables を付けないと見逃す
      // node:test の describe / it は Promise を返すが、待たなくてよい
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          checkThenables: true,
          allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['describe', 'it'] }],
        },
      ],
    },
  },
);
