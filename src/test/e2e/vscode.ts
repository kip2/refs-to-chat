// E2E テスト用に、本物の VS Code を Playwright で動かす
// 画面の部品の探し方は selectors.ts にまとめてある
//
// 大事な約束: チャットに送信しない（トークンを使わない）
// - Enter キーは一度も押さない
// - コマンドパレットなどの候補も、Enter ではなくクリックで選ぶ
// - チャットの入力欄に入ったことを確かめたら、clearChat で空にする

import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
import { _electron, type ElectronApplication, type Locator, type Page } from 'playwright-core';
import { EXTENSIONS_DIR, USER_DATA_DIR, USER_SETTINGS, WORKSPACE } from './paths';
import * as S from './selectors';

// VS Code の中（ターミナルや拡張）から実行すると引き継がれ、テスト用の VS Code が Node.js として起動してしまう
delete process.env.ELECTRON_RUN_AS_NODE;

/**
 * E2E で使う VS Code の版
 * selectors.ts はこの版の画面で調べたので、固定する（VSCODE_TEST_VERSION で変えられる）
 */
const VSCODE_VERSION = '1.145.2';

/** 拡張が起動しきるまで待つ時間（起動を知らせる画面の変化がないので、時間で待つ） */
const STARTUP_MS = 3000;
/** settings.json を書き換えてから、VS Code が読み直すまで待つ時間 */
const SETTINGS_RELOAD_MS = 1500;
/** コマンドパレットに文字を入れてから、候補が出るまで待つ上限 */
const QUICK_INPUT_TIMEOUT_MS = 10_000;
/** 状態によって出たり出なかったりする候補を、出てくるまで待つ上限 */
const LISTED_TIMEOUT_MS = 2000;
/** コマンドパレットなどを開き直す回数の上限 */
const QUICK_INPUT_ATTEMPTS = 3;

/** E2E 用の VS Code の実行ファイル（初回だけダウンロードする） */
export function vscodeExecutable(): Promise<string> {
  return downloadAndUnzipVSCode(process.env.VSCODE_TEST_VERSION || VSCODE_VERSION);
}

/** E2E 用のフォルダを指定して、VS Code の CLI（code コマンド）を動かす */
export function runCli(executable: string, args: string[]): void {
  const [cli, ...defaults] = resolveCliArgsFromVSCodeExecutablePath(executable);
  // 既定で付くフォルダの指定は、E2E 用のものに差し替える
  const rest = defaults.filter((a) => !a.startsWith('--extensions-dir') && !a.startsWith('--user-data-dir'));
  const all = [...rest, '--user-data-dir', USER_DATA_DIR, '--extensions-dir', EXTENSIONS_DIR, ...args];
  let result: cp.SpawnSyncReturns<string>;
  if (process.platform === 'win32') {
    // Windows の code.cmd はシェル経由でないと動かないので、引数を引用符で囲んで 1 つのコマンドにする
    // cmd は引用符の中でも % を展開するので、" と % を含む引数は受け付けない
    // 末尾の \ は閉じの引用符をエスケープしてしまうので、これも受け付けない
    const bad = [cli, ...all].find((a) => /["%]|\\$/.test(a));
    if (bad) throw new Error(`" や % を含むパス、\\ で終わるパスでは動かせません: ${bad}`);
    result = cp.spawnSync([cli, ...all].map((a) => `"${a}"`).join(' '), { shell: true, encoding: 'utf8' });
  } else {
    result = cp.spawnSync(cli, all, { encoding: 'utf8' });
  }
  if (result.status !== 0) {
    throw new Error(`code コマンドが失敗しました: ${cli} ${all.join(' ')}\n${result.stdout}\n${result.stderr}`);
  }
}

/** E2E 用のユーザー設定 */
const BASE_SETTINGS: Record<string, unknown> = {
  // テストのファイルは読み取り専用にする（キー操作がエディタに入っても、書き換わらない）
  'files.readonlyInclude': { '**/src/test/fixtures/**': true },
  // Enter だけでは送信しない（Ctrl+Enter で送信）
  // テストは Enter を押さないが、念のため
  'claudeCode.useCtrlEnterToSend': true,
  // チャットはエディタのタブで開く（サイドバーで開くと、この設定が自動で変わる）
  'claudeCode.preferredLocation': 'panel',
  'claudeCode.hideOnboarding': true,
  // エクスプローラーでクリックしても、開かずに選ぶだけにする
  // 開くと、タブが開かないことを確かめられない
  'workbench.list.openMode': 'doubleClick',
  // テストのじゃまになる通知や画面を出さない
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'git.openRepositoryInParentFolders': 'never',
  'security.workspace.trust.enabled': false,
  'update.mode': 'none',
  'extensions.autoUpdate': false,
  'extensions.autoCheckUpdates': false,
  'telemetry.telemetryLevel': 'off',
};

/** テストの中で変える設定（前の実行が途中で止まっても残らないよう、起動前に消す） */
const SETTINGS_CHANGED_BY_TESTS = ['claudeCode.useTerminal', 'refsToChat.explorerClipboard'];

/**
 * settings.json を読む
 * 読めないときは止める（安全のための設定を消してしまわないように）
 */
function readSettings(): Record<string, unknown> {
  if (!fs.existsSync(USER_SETTINGS)) return {};
  const text = fs.readFileSync(USER_SETTINGS, 'utf8');
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`E2E 用の settings.json を読めません（コメントや末尾のカンマを消してください）: ${USER_SETTINGS}`);
  }
}

/** 安全のための設定は、いつも上書きして書く */
function writeSettings(settings: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(USER_SETTINGS), { recursive: true });
  fs.writeFileSync(USER_SETTINGS, JSON.stringify({ ...settings, ...BASE_SETTINGS }, null, 2));
}

/** 起動前に、E2E 用の設定を書いておく（ほかの設定は残す） */
export function writeBaseSettings(): void {
  const settings = readSettings();
  for (const key of SETTINGS_CHANGED_BY_TESTS) delete settings[key];
  writeSettings(settings);
}

/** 正規表現の中で特別な意味を持つ文字を、そのままの文字として扱う */
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactly = (s: string) => new RegExp(`^${escapeRegExp(s)}$`);

/** Webview の中の入力欄（DOM の型を読み込まないので、使う分だけ書く） */
interface InputElement {
  focus(): void;
  ownerDocument: {
    createRange(): { selectNodeContents(node: unknown): void };
    defaultView: { getSelection(): { removeAllRanges(): void; addRange(range: unknown): void } | null } | null;
    execCommand(command: string): boolean;
  };
}

/**
 * 条件を満たすまで繰り返し確かめる
 * 最後に読んだ値を返す
 */
async function poll<T>(read: () => Promise<T>, ok: (value: T) => boolean, timeoutMs: number): Promise<T> {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!ok(value) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    value = await read();
  }
  return value;
}

export class VSCode {
  private constructor(
    private readonly app: ElectronApplication,
    readonly page: Page,
  ) {}

  static async launch(): Promise<VSCode> {
    const app = await _electron.launch({
      executablePath: await vscodeExecutable(),
      args: [
        '--user-data-dir',
        USER_DATA_DIR,
        '--extensions-dir',
        EXTENSIONS_DIR,
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-workspace-trust',
        WORKSPACE,
      ],
    });
    try {
      const page = await app.firstWindow();
      await page.waitForSelector(S.WORKBENCH, { timeout: 60_000 });
      await page.waitForTimeout(STARTUP_MS);
      return new VSCode(app, page);
    } catch (err) {
      // 起動しきれなかったときも、VS Code を残さない（残ると、次の起動がそちらに吸い込まれる）
      await app.close().catch(() => undefined);
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.app.close();
  }

  /**
   * ユーザー設定を変える（undefined なら消す）
   * VS Code が読み直すまで少し待つ
   */
  async setSetting(key: string, value: unknown): Promise<void> {
    const settings = readSettings();
    if (value === undefined) delete settings[key];
    else settings[key] = value;
    writeSettings(settings);
    await this.page.waitForTimeout(SETTINGS_RELOAD_MS);
  }

  // ---- コマンドパレット・Quick Open ----

  /** 入力欄を開いて文字を入れ、候補の行が出るまで待つ（候補がないときも「No matching commands」の行が出る） */
  private async openQuickInput(key: string, text: string): Promise<void> {
    // 前の入力欄が開いたままなら閉じる
    // エディタで Escape を押すと選択が消えるので、開いているときだけ押す
    if (await this.page.locator(S.QUICK_INPUT_BOX).isVisible()) await this.page.keyboard.press('Escape');
    const box = this.page.locator(S.QUICK_INPUT_BOX);
    for (let attempt = 0; attempt < QUICK_INPUT_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        // チャットの Webview にフォーカスがあると、キーが VS Code に届かなかったり、開いた入力欄がすぐ閉じたりする
        // サイドバーの見出しをクリックして、フォーカスを VS Code に移してから、もう一度押す
        await this.page.locator(S.SIDEBAR_TITLE).first().click();
      }
      await this.page.keyboard.press(key);
      if (!(await this.stayedOpen(box))) continue;
      // 文字を入れている途中で閉じることもあるので、そのときもやり直す
      const filled = await box
        .fill(text, { timeout: LISTED_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);
      if (filled && (await box.isVisible())) break;
    }
    await box.waitFor({ state: 'visible', timeout: QUICK_INPUT_TIMEOUT_MS });
    await this.page.locator(S.QUICK_INPUT_ROW).first().waitFor({ state: 'visible', timeout: QUICK_INPUT_TIMEOUT_MS });
  }

  /**
   * 入力欄が開き、すぐに閉じなかったか
   * フォーカスがチャットに戻ると、開いた入力欄がすぐ閉じることがある
   */
  private async stayedOpen(box: Locator): Promise<boolean> {
    const opened = await box
      .waitFor({ state: 'visible', timeout: LISTED_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (!opened) return false;
    await this.page.waitForTimeout(300);
    return box.isVisible();
  }

  private quickInputRow(label: string): Locator {
    const name = this.page.locator(S.QUICK_INPUT_LABEL, { hasText: exactly(label) });
    return this.page.locator(S.QUICK_INPUT_ROW).filter({ has: name }).first();
  }

  /** 候補をクリックして、入力欄が閉じるまで待つ */
  private async clickQuickInputRow(row: Locator): Promise<void> {
    await row.click();
    await this.page.locator(S.QUICK_INPUT_BOX).waitFor({ state: 'hidden', timeout: QUICK_INPUT_TIMEOUT_MS });
  }

  /**
   * コマンドパレットの候補の名前（候補を見たら閉じる）
   * 候補はあとから増えることがあるので、続けて 2 回読んで同じになるまで待つ
   */
  async paletteItems(filter: string): Promise<string[]> {
    await this.openQuickInput('F1', `>${filter}`);
    const read = async () =>
      (await this.page.locator(`${S.QUICK_INPUT_ROW} ${S.QUICK_INPUT_LABEL}`).allTextContents()).map((t) => t.trim());
    let previous: string[] = [];
    const items = await poll(
      read,
      (current) => {
        const stable = current.length > 0 && current.join('\n') === previous.join('\n');
        previous = current;
        return stable;
      },
      QUICK_INPUT_TIMEOUT_MS,
    );
    await this.page.keyboard.press('Escape');
    return items;
  }

  /** コマンドパレットからコマンドを実行する（Enter ではなく、名前が完全に一致する候補をクリックする） */
  async runCommand(title: string): Promise<void> {
    await this.openQuickInput('F1', `>${title}`);
    const row = this.quickInputRow(title);
    await row.waitFor({ state: 'visible', timeout: QUICK_INPUT_TIMEOUT_MS });
    await this.clickQuickInputRow(row);
  }

  /** 候補にあるときだけ実行する（状態によって出たり出なかったりするコマンド用） */
  async runCommandIfListed(title: string): Promise<boolean> {
    await this.openQuickInput('F1', `>${title}`);
    const row = this.quickInputRow(title);
    // 候補はあとから出てくることがあるので、少し待つ
    const listed = await row
      .waitFor({ state: 'visible', timeout: LISTED_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (!listed) {
      await this.page.keyboard.press('Escape');
      return false;
    }
    await this.clickQuickInputRow(row);
    return true;
  }

  /**
   * ファイルをフルパスで開く（Quick Open の候補をクリックする）
   * 前に開いたときの選択範囲が戻ってくるので、カーソルを先頭に置いて選択をなくす
   */
  async openFile(fullPath: string): Promise<void> {
    // チャットの Webview にフォーカスがあると、Ctrl+P が VS Code に届かないので、フォーカスを外す
    await this.page.evaluate("document.activeElement?.tagName === 'IFRAME' && document.activeElement.blur()");
    await this.openQuickInput('Control+P', fullPath);
    await this.clickQuickInputRow(this.page.locator(S.QUICK_INPUT_ROW).first());
    const name = path.basename(fullPath);
    await this.page.locator(S.activeTabByName(name)).first().waitFor({ timeout: 10_000 });
    // チャットがフォーカスを取ると「アクティブなグループ」がチャットの方に移ることがあるので、そのファイルのタブがあるグループのエディタをクリックする
    await this.page.locator(S.editorTextByName(name)).first().click();
    await this.page.keyboard.press('Control+Home');
  }

  async closeAllEditors(): Promise<void> {
    await this.runCommand(S.CLOSE_ALL_EDITORS);
  }

  async tabCount(name: string): Promise<number> {
    return this.page.locator(S.tabByName(name)).count();
  }

  /**
   * タブの数が期待どおりになるまで待つ
   * 最後に数えた数を返す
   */
  async waitForTabCount(name: string, expected: number, timeoutMs = 5000): Promise<number> {
    return poll(
      () => this.tabCount(name),
      (n) => n === expected,
      timeoutMs,
    );
  }

  // ---- エディタ ----

  /**
   * 前面のエディタで行を選ぶ
   * 行は 1 から数え、end の行は行末まで選ぶ
   * endAtNextLineStart なら、選択を次の行の先頭で終える
   */
  async selectLines(start: number, end: number, endAtNextLineStart = false): Promise<void> {
    await this.page.locator(S.ACTIVE_EDITOR_TEXT).first().click();
    const k = this.page.keyboard;
    await k.press('Control+Home');
    for (let i = 1; i < start; i++) await k.press('ArrowDown');
    for (let i = start; i < end; i++) await k.press('Shift+ArrowDown');
    if (endAtNextLineStart) {
      await k.press('Shift+ArrowDown');
      await k.press('Shift+Home');
    } else {
      await k.press('Shift+End');
    }
  }

  /**
   * 前面のエディタの右クリックメニューを開き、項目を返す（メニューは開いたまま）
   * マウスで右クリックすると、選択範囲の外を押したときに選択が消える
   * そのため、カーソルの位置にメニューを出すキー（Shift+F10）を使う
   * エディタにフォーカスがあること（openFile や selectLines のあと）が前提
   */
  async rightClickEditor(): Promise<string[]> {
    for (let attempt = 0; attempt < 2; attempt++) {
      // 開いたばかりのチャットが、あとからフォーカスを取ってメニューを閉じてしまうことがある
      // そのときは、選択を残したままエディタにフォーカスを戻して、もう一度開く
      if (attempt > 0) await this.runCommand(S.FOCUS_ACTIVE_EDITOR_GROUP);
      await this.page.locator(S.ACTIVE_EDITOR_FOCUSED).first().waitFor({ timeout: 5000 });
      await this.page.keyboard.press('Shift+F10');
      await this.page.locator(S.CONTEXT_MENU).first().waitFor({ timeout: 5000 }).catch(() => undefined);
      await this.page.waitForTimeout(300);
      if ((await this.page.locator(S.CONTEXT_MENU).count()) > 0) break;
    }
    return this.menuItems();
  }

  // ---- エクスプローラー ----

  /** エクスプローラーで、ファイルやフォルダを（複数なら Ctrl を押しながら）選んで右クリックする */
  async rightClickExplorer(fullPaths: string[]): Promise<string[]> {
    await this.runCommand(S.SHOW_EXPLORER);
    for (const [i, p] of fullPaths.entries()) {
      await this.revealInExplorer(p);
      await this.page.locator(S.explorerRowByPath(p)).click({ modifiers: i === 0 ? [] : ['Control'] });
    }
    await this.page.locator(S.explorerRowByPath(fullPaths[fullPaths.length - 1])).click({ button: 'right' });
    return this.menuItems();
  }

  /** 親のフォルダを上から順に開いて、行を見えるようにする */
  private async revealInExplorer(fullPath: string): Promise<void> {
    const parents: string[] = [];
    for (let p = path.dirname(fullPath); p !== path.dirname(p); p = path.dirname(p)) parents.unshift(p);
    for (const p of parents) {
      const row = this.page.locator(S.explorerRowByPath(p));
      // ワークスペースより上のフォルダは、エクスプローラーにない
      if ((await row.count()) === 0) continue;
      if ((await row.getAttribute('aria-expanded')) === 'false') {
        // 選択を変えないよう、開閉の矢印だけをクリックする
        await row.locator(S.EXPLORER_TWISTIE).click();
        await poll(
          () => row.getAttribute('aria-expanded'),
          (v) => v === 'true',
          5000,
        );
      }
    }
  }

  // ---- 右クリックメニュー ----

  private async menuItems(): Promise<string[]> {
    await this.page.locator(S.CONTEXT_MENU).first().waitFor({ timeout: 5000 });
    const items = await this.page.locator(S.CONTEXT_MENU_ITEM).allTextContents();
    return items.map((t) => t.trim()).filter((t) => t);
  }

  /** 名前が完全に一致する項目をクリックする */
  async clickMenuItem(label: string): Promise<void> {
    await this.page.locator(S.CONTEXT_MENU_ITEM, { hasText: exactly(label) }).first().click();
  }

  /** 右クリックメニューが開いていれば閉じる（エディタの選択を消さないよう、開いているときだけ Escape を押す） */
  async closeMenu(): Promise<void> {
    if ((await this.page.locator(S.CONTEXT_MENU).count()) > 0) await this.page.keyboard.press('Escape');
  }

  // ---- 通知 ----

  async clearNotifications(): Promise<void> {
    await this.runCommand(S.CLEAR_NOTIFICATIONS);
  }

  // ---- 公式拡張のチャット ----

  /**
   * チャットの入力欄（Webview の中）をすべて返す
   * チャットはサイドバーとエディタのタブの両方に開いていることがあるので、1 つとは限らない
   */
  private async chatInputs(): Promise<Locator[]> {
    const inputs: Locator[] = [];
    for (const frame of this.page.frames()) {
      const found = await frame
        .locator(S.CHAT_INPUT)
        .count()
        .catch(() => 0);
      for (let i = 0; i < found; i++) inputs.push(frame.locator(S.CHAT_INPUT).nth(i));
    }
    return inputs;
  }

  /**
   * チャットの入力欄が出るまで待つ
   * 出なければ false
   */
  async waitForChatInput(timeoutMs = 30_000): Promise<boolean> {
    const inputs = await poll(
      () => this.chatInputs(),
      (found) => found.length > 0,
      timeoutMs,
    );
    return inputs.length > 0;
  }

  /**
   * チャットの入力欄の文字
   * いくつかあれば改行でつなぎ、入力欄がなければ空
   */
  async chatText(): Promise<string> {
    const texts: string[] = [];
    for (const input of await this.chatInputs()) {
      const text = (await input.innerText().catch(() => '')).trim();
      if (text) texts.push(text);
    }
    return texts.join('\n');
  }

  /**
   * チャットの入力欄が、条件を満たすまで待つ
   * 最後に読んだ文字を返す
   */
  async waitForChatText(ok: (text: string) => boolean, timeoutMs = 20_000): Promise<string> {
    return poll(() => this.chatText(), ok, timeoutMs);
  }

  /**
   * チャットの入力欄をすべて空にする（送信はしない）
   * キー操作（Ctrl+A・Delete）は使わない
   * フォーカスがエディタにあると、エディタの中身を消してしまうため
   * 入力欄のある Webview の中だけで、全選択して消す
   */
  async clearChat(): Promise<void> {
    for (const input of await this.chatInputs()) {
      if ((await input.innerText().catch(() => '')).trim() === '') continue;
      await input.evaluate((el: InputElement) => {
        const doc = el.ownerDocument;
        el.focus();
        const range = doc.createRange();
        range.selectNodeContents(el);
        const selection = doc.defaultView?.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        doc.execCommand('delete');
      });
    }
    const left = await this.waitForChatText((t) => t === '', 5000);
    if (left !== '') throw new Error(`チャットの入力欄を空にできませんでした: ${left}`);
  }
}
