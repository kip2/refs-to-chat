// package.json（マニフェスト）とコードの整合性、公式拡張との互換性のテスト
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setup } = require('../helpers/vscode-mock');

const ROOT = path.resolve(__dirname, '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const menus = pkg.contributes.menus;
const declared = pkg.contributes.commands.map((c) => c.command);
const TERMINAL_GUARD = '!config.claudeCode.useTerminal';

describe('package.json の基本項目', () => {
  it('main のファイルが存在する', () => {
    assert.ok(fs.existsSync(path.join(ROOT, pkg.main)));
  });

  it('name / publisher / version が入っている', () => {
    assert.match(pkg.name, /^[a-z0-9-]+$/);
    assert.ok(pkg.publisher);
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  });

  it('VS Code 1.94 以上（公式 Claude 拡張と同じ）', () => {
    assert.equal(pkg.engines.vscode, '^1.94.0');
  });

  it('コマンドにはすべてタイトルがある', () => {
    for (const c of pkg.contributes.commands) assert.ok(c.title, c.command);
  });
});

describe('宣言とコードの一致', () => {
  it('宣言したコマンド = activate で登録するコマンド', () => {
    const { state } = setup();
    assert.deepEqual([...state.registered.keys()].sort(), [...declared].sort());
  });

  it('メニューが参照するコマンドはすべて宣言済み', () => {
    for (const [where, items] of Object.entries(menus)) {
      for (const it of items) assert.ok(declared.includes(it.command), `${where}: ${it.command}`);
    }
  });
});

describe('メニューの表示条件', () => {
  const editor = menus['editor/context'];
  const explorer = menus['explorer/context'];

  it('エディタ: 選択ありは sendSelection、なしは sendCurrentFile（排他）', () => {
    const sel = editor.find((m) => m.command === 'claudeRightClick.sendSelection');
    const cur = editor.find((m) => m.command === 'claudeRightClick.sendCurrentFile');
    assert.match(sel.when, /(^|&& )editorHasSelection/);
    assert.match(cur.when, /!editorHasSelection/);
    assert.doesNotMatch(sel.when, /!editorHasSelection/);
  });

  it('エクスプローラー: フォルダには出さない', () => {
    assert.equal(explorer.length, 1);
    assert.match(explorer[0].when, /!explorerResourceIsFolder/);
  });

  it('右クリックメニューはすべてターミナル版の設定では出さない', () => {
    for (const m of [...editor, ...explorer]) assert.ok(m.when.includes(TERMINAL_GUARD), m.command);
  });

  it('sendFile は引数（URI）が必要なのでコマンドパレットに出さない', () => {
    const p = menus.commandPalette.find((m) => m.command === 'claudeRightClick.sendFile');
    assert.equal(p.when, 'false');
  });

  it('パレットに出すコマンドもターミナル版の設定では出さない', () => {
    for (const m of menus.commandPalette.filter((m) => m.when !== 'false')) {
      assert.equal(m.when, TERMINAL_GUARD, m.command);
    }
  });

  it('右クリックメニューは navigation グループ', () => {
    for (const m of [...editor, ...explorer]) assert.match(m.group, /^navigation/);
  });
});

// 実際にインストールされている公式拡張の package.json を見て、呼ぶコマンドがまだ存在するかを確認する。
// 公式拡張の更新でコマンド名が変わったときに気づくためのテスト。
// 見つからない環境ではスキップ。場所は CLAUDE_EXT_DIR で指定も可能。
function findClaudeExtension() {
  const candidates = [];
  if (process.env.CLAUDE_EXT_DIR) candidates.push(process.env.CLAUDE_EXT_DIR);
  const extRoot = path.join(os.homedir(), '.vscode', 'extensions');
  if (fs.existsSync(extRoot)) {
    const dirs = fs.readdirSync(extRoot).filter((d) => d.startsWith('anthropic.claude-code-')).sort().reverse();
    candidates.push(...dirs.map((d) => path.join(extRoot, d)));
  }
  return candidates.find((d) => fs.existsSync(path.join(d, 'package.json')));
}

describe('公式 Claude Code 拡張との互換性', () => {
  const dir = findClaudeExtension();

  it('呼び出すコマンドが公式拡張に存在する', { skip: !dir && '公式拡張が見つからないためスキップ' }, () => {
    const claude = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const { ext } = setup();
    const ids = claude.contributes.commands.map((c) => c.command);
    assert.ok(ids.includes(ext._internal.CLAUDE_CMD), `${ext._internal.CLAUDE_CMD} が ${dir} に無い`);
    // 拡張IDは大文字小文字を区別しない（公式は publisher が "Anthropic"）
    assert.equal(`${claude.publisher}.${claude.name}`.toLowerCase(), ext._internal.CLAUDE_EXT_ID.toLowerCase());
  });

  it('公式拡張のパレット表示条件がこの拡張と同じ（ターミナル版で無効）', { skip: !dir && '公式拡張が見つからないためスキップ' }, () => {
    const claude = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const entry = (claude.contributes.menus.commandPalette || []).find((m) => m.command === 'claude-vscode.insertAtMention');
    assert.ok(entry, 'commandPalette に insertAtMention が無い');
    assert.equal(entry.when, TERMINAL_GUARD);
  });
});
