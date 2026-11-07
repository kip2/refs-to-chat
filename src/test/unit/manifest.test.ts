// package.json（マニフェスト）とコードの整合性、公式拡張との互換性のテスト

import * as fs from 'fs';
import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as os from 'os';
import * as path from 'path';
import { CLAUDE, COMMANDS } from '../../constants';
import { setup } from '../helpers/vscodeMock';

interface MenuItem {
  command: string;
  when?: string;
  group?: string;
}

interface Manifest {
  name: string;
  displayName: string;
  publisher: string;
  version: string;
  main: string;
  engines: { vscode: string };
  capabilities: { untrustedWorkspaces: { supported: boolean } };
  contributes: {
    commands: { command: string; title: string; category?: string }[];
    menus: Record<string, MenuItem[]>;
  };
}

// このファイルは out/test/unit/ にコンパイルされる
const ROOT = path.resolve(__dirname, '../../..');
const readManifest = (dir: string): Manifest => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));

const pkg = readManifest(ROOT);
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

  it('コマンドにはすべて category があり、パレットで拡張名が前に付く', () => {
    for (const c of pkg.contributes.commands) assert.equal(c.category, pkg.displayName, c.command);
  });
});

describe('宣言とコードの一致', () => {
  it('宣言したコマンド = activate で登録するコマンド', () => {
    const { state } = setup();
    assert.deepEqual([...state.registered.keys()].sort(), [...declared].sort());
  });

  it('宣言したコマンド = constants.ts の COMMANDS', () => {
    assert.deepEqual(Object.values(COMMANDS).sort(), [...declared].sort());
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
  const palette = menus.commandPalette;

  /** メニューの中から、そのコマンドの when を取り出す（無ければテストを失敗させる） */
  function whenOf(items: MenuItem[], command: string): string {
    const item = items.find((m) => m.command === command);
    assert.ok(item?.when, `${command} の when が無い`);
    return item.when;
  }

  it('エディタ: 選択ありは sendSelection、なしは sendCurrentFile（排他）', () => {
    const sel = whenOf(editor, COMMANDS.sendSelection);
    const cur = whenOf(editor, COMMANDS.sendCurrentFile);
    assert.match(sel, /(^|&& )editorHasSelection/);
    assert.match(cur, /!editorHasSelection/);
    assert.doesNotMatch(sel, /!editorHasSelection/);
  });

  it('エクスプローラー: ファイルにもフォルダにも出す', () => {
    assert.equal(explorer.length, 1);
    assert.doesNotMatch(whenOf(explorer, COMMANDS.sendFile), /explorerResourceIsFolder/);
  });

  it('制限モード（信頼していないワークスペース）では動かない', () => {
    assert.equal(pkg.capabilities.untrustedWorkspaces.supported, false);
  });

  it('右クリックメニューはすべてターミナル版の設定では出さない', () => {
    for (const m of [...editor, ...explorer]) assert.ok(m.when?.includes(TERMINAL_GUARD), m.command);
  });

  it('sendFile は引数（URI）が必要なのでコマンドパレットに出さない', () => {
    assert.equal(whenOf(palette, COMMANDS.sendFile), 'false');
  });

  it('パレットに出すコマンドもターミナル版の設定では出さない', () => {
    for (const m of palette.filter((m) => m.when !== 'false')) {
      assert.equal(m.when, TERMINAL_GUARD, m.command);
    }
  });

  it('右クリックメニューは navigation グループ', () => {
    for (const m of [...editor, ...explorer]) assert.match(m.group ?? '', /^navigation/);
  });
});

// インストール済みの公式拡張に、呼ぶコマンドがまだあるか確かめる（名前が変わったら気づける）
// 見つからなければスキップ
// 場所は CLAUDE_EXT_DIR で指定できる
function findClaudeExtension(): string | undefined {
  const candidates: string[] = [];
  if (process.env.CLAUDE_EXT_DIR) candidates.push(process.env.CLAUDE_EXT_DIR);
  const extRoot = path.join(os.homedir(), '.vscode', 'extensions');
  if (fs.existsSync(extRoot)) {
    // バージョン番号として新しい順に並べる（文字列順だと 2.0.9 が 2.0.10 より新しく見える）
    const dirs = fs
      .readdirSync(extRoot)
      .filter((d) => d.startsWith('anthropic.claude-code-'))
      .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
    candidates.push(...dirs.map((d) => path.join(extRoot, d)));
  }
  return candidates.find((d) => fs.existsSync(path.join(d, 'package.json')));
}

describe('公式 Claude Code 拡張との互換性', () => {
  const dir = findClaudeExtension();

  const skip = !dir && '公式拡張が見つからないためスキップ';

  it('呼び出すコマンドが公式拡張に存在する', { skip }, () => {
    assert.ok(dir);
    const claude = readManifest(dir);
    const ids = claude.contributes.commands.map((c) => c.command);
    for (const cmd of [CLAUDE.insertMentionCommand, CLAUDE.focusInputCommand]) {
      assert.ok(ids.includes(cmd), `${cmd} が ${dir} に無い`);
    }
    // 拡張IDは大文字小文字を区別しない（公式は publisher が "Anthropic"）
    assert.equal(`${claude.publisher}.${claude.name}`.toLowerCase(), CLAUDE.extensionId.toLowerCase());
  });

  it('公式拡張のパレット表示条件がこの拡張と同じ（ターミナル版で無効）', { skip }, () => {
    assert.ok(dir);
    const claude = readManifest(dir);
    const palette = claude.contributes.menus.commandPalette ?? [];
    const entry = palette.find((m) => m.command === CLAUDE.insertMentionCommand);
    assert.ok(entry, 'commandPalette に insertAtMention が無い');
    assert.equal(entry.when, TERMINAL_GUARD);
  });
});
