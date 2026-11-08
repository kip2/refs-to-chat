// E2E テスト（本物の VS Code・本物の公式拡張）
// 右クリックメニューやコマンドパレットを実際に操作し、チャットの入力欄に参照が入るかを確かめる
//
// 送信はしない
// 入力欄に入ったことを確かめたら、毎回空にする（afterEach）

import * as assert from 'node:assert';
import * as path from 'node:path';
import { fixture, SCREENSHOTS_DIR } from './paths';
import {
  CLAUDE_FOCUS_INPUT,
  CLAUDE_OPEN_IN_NEW_TAB,
  CLAUDE_OPEN_IN_SIDE_BAR,
  FOCUS_FIRST_EDITOR_GROUP,
  MOVE_EDITOR_TO_PREVIOUS_GROUP,
} from './selectors';
import { VSCode } from './vscode';

const CATEGORY = 'Refs to Chat';
const MENU = {
  selection: '選択範囲をClaudeのチャットに追加',
  currentFile: 'このファイルをClaudeのチャットに追加',
  explorer: 'Claudeのチャットに追加',
} as const;
const PALETTE = {
  selection: `${CATEGORY}: ${MENU.selection}`,
  currentFile: `${CATEGORY}: ${MENU.currentFile}`,
} as const;

const APP_JS = fixture('alpha/src/app.js');
const ONLY_IN_BETA = fixture('beta/src/only-in-beta.js');
const ALPHA_SRC = fixture('alpha/src');
const GUIDE_MD = fixture('alpha/docs/guide.md');

const LOGIN_MESSAGE =
  '公式拡張のチャットの入力欄が出てきません。ログインしていない可能性があります。' +
  'npm run test:e2e:setup を実行し、起動した VS Code でログインしてから、もう一度試してください。';

/** コマンドパレットの候補のうち、この拡張のもの */
const ours = (items: string[]) => items.filter((t) => t.startsWith(`${CATEGORY}:`));

describe('E2E: 本物の VS Code と公式拡張', function () {
  let code: VSCode | undefined;

  /** before で起動しているので、テストの中では必ずある */
  const vs = (): VSCode => {
    assert.ok(code, 'VS Code が起動していない');
    return code;
  };

  /** チャットの入力欄に、その文字が入るまで待って確かめる */
  async function expectInChat(expected: string): Promise<string> {
    const text = await vs().waitForChatText((t) => t.includes(expected));
    assert.ok(text.includes(expected), `チャットの入力欄に ${expected} が入っていない（入力欄: ${JSON.stringify(text)}）`);
    return text;
  }

  before(async function () {
    code = await VSCode.launch();
    // ログインしているか（チャットの入力欄が出るか）を、最初に確かめる
    await code.runCommand(CLAUDE_FOCUS_INPUT);
    if (!(await code.waitForChatInput())) throw new Error(LOGIN_MESSAGE);
    await code.clearChat();
  });

  beforeEach(async function () {
    // 前のテストで使ったチャットが、フォーカスを取り返し終わるのを待ってから、画面を操作する
    await vs().waitForChatToSettle();
    await vs().setSetting('refsToChat.explorerClipboard', undefined);
    await vs().setSetting('refsToChat.previewClipboard', undefined);
    await vs().setSetting('refsToChat.markdownPreview', undefined);
    // チャットを閉じた状態から始める（エディタのタブのチャットも、サイドバーのチャットも閉じる）
    await vs().closeAllEditors();
    await vs().hideSecondarySideBar();
    await vs().clearNotifications();
  });

  afterEach(async function () {
    if (!code) return;
    try {
      if (this.currentTest?.state === 'failed') {
        const name = this.currentTest.title.replace(/[^\p{L}\p{N}-]+/gu, '_').slice(0, 60);
        await code.page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${name}.png`) }).catch(() => undefined);
      }
      await code.closeMenu().catch(() => undefined);
    } finally {
      // 失敗したときも、入力欄は必ず空にする
      await code.clearChat();
    }
  });

  after(async function () {
    if (!code) return;
    // どれかが失敗しても、残りの後片付けは続ける（入力欄を空にするのが一番大事なので先に）
    try {
      await code.clearChat().catch((err: unknown) => console.error('チャットの入力欄を空にできませんでした', err));
      await code.setSetting('refsToChat.explorerClipboard', undefined).catch(() => undefined);
      await code.setSetting('refsToChat.previewClipboard', undefined).catch(() => undefined);
      await code.setSetting('refsToChat.markdownPreview', undefined).catch(() => undefined);
      await code.setSetting('claudeCode.useTerminal', undefined).catch(() => undefined);
    } finally {
      await code.close();
    }
  });

  describe('エディタから追加する', function () {
    it('数行を選んで右クリック → 行番号付きで入る（チャットが閉じていても開いて入る）', async function () {
      await vs().openFile(APP_JS);
      await vs().selectLines(2, 3);
      const items = await vs().rightClickEditor();
      assert.ok(items.includes(MENU.selection), `メニューに「${MENU.selection}」がない: ${items.join(', ')}`);
      assert.ok(!items.includes(MENU.currentFile));
      await vs().clickMenuItem(MENU.selection);
      await expectInChat('@alpha/src/app.js#2-3');
    });

    it('何も選ばずに右クリック → 行番号なしで入る', async function () {
      await vs().openFile(APP_JS);
      const items = await vs().rightClickEditor();
      assert.ok(items.includes(MENU.currentFile), `メニューに「${MENU.currentFile}」がない: ${items.join(', ')}`);
      assert.ok(!items.includes(MENU.selection));
      await vs().clickMenuItem(MENU.currentFile);
      const text = await expectInChat('@alpha/src/app.js');
      assert.match(text, /@alpha\/src\/app\.js(?!#)/);
    });

    // 行番号は公式拡張が付ける
    // 今の公式拡張は、選択が終わる行まで含める（その行の文字を選んでいなくても）
    it('選択が次の行の先頭で終わる → 行番号は、選択が終わる行まで（公式拡張の今の動き）', async function () {
      await vs().openFile(APP_JS);
      await vs().selectLines(2, 3, true);
      await vs().rightClickEditor();
      await vs().clickMenuItem(MENU.selection);
      await expectInChat('@alpha/src/app.js#2-4');
    });

    it('コマンドパレットで「このファイルを…」→ 行番号なしで入る', async function () {
      await vs().openFile(APP_JS);
      await vs().runCommand(PALETTE.currentFile);
      const text = await expectInChat('@alpha/src/app.js');
      assert.match(text, /@alpha\/src\/app\.js(?!#)/);
    });

    it('範囲を選んでからコマンドパレットで「選択範囲を…」→ 行番号付きで入る', async function () {
      await vs().openFile(APP_JS);
      await vs().selectLines(2, 3);
      await vs().runCommand(PALETTE.selection);
      await expectInChat('@alpha/src/app.js#2-3');
    });

    it('チャットをエディタのタブで開いた状態でも、行番号付きで入る', async function () {
      await vs().runCommand(CLAUDE_OPEN_IN_NEW_TAB);
      assert.ok(await vs().waitForChatInput(), 'チャットが開かない');
      await vs().openFile(APP_JS);
      await vs().selectLines(2, 3);
      await vs().rightClickEditor();
      await vs().clickMenuItem(MENU.selection);
      await expectInChat('@alpha/src/app.js#2-3');
    });
  });

  describe('コマンドパレットに出す・出さない', function () {
    // 下の「出ない」のテストが、たまたま通っていないかを確かめる
    it('テキストのファイルが前面にあれば出る', async function () {
      await vs().openFile(APP_JS);
      assert.deepStrictEqual(ours(await vs().paletteItems(CATEGORY)).sort(), [PALETTE.currentFile, PALETTE.selection].sort());
    });

    it('ファイルを 1 つも開いていなければ出ない', async function () {
      assert.deepStrictEqual(ours(await vs().paletteItems(CATEGORY)), []);
    });

    it('チャットだけをエディタのタブで開いていると出ない', async function () {
      await vs().runCommand(CLAUDE_OPEN_IN_NEW_TAB);
      assert.ok(await vs().waitForChatInput(), 'チャットが開かない');
      assert.deepStrictEqual(ours(await vs().paletteItems(CATEGORY)), []);
    });

    it('ファイルを開いていても、チャットのタブが前面なら出ない', async function () {
      await vs().openFile(APP_JS);
      await vs().runCommand(CLAUDE_OPEN_IN_NEW_TAB);
      assert.ok(await vs().waitForChatInput(), 'チャットが開かない');
      assert.deepStrictEqual(ours(await vs().paletteItems(CATEGORY)), []);
    });
  });

  describe('エクスプローラーから追加する（初期設定 use）', function () {
    it('開いていないファイル → 貼り付けで入る。タブは開かない', async function () {
      const items = await vs().rightClickExplorer([APP_JS]);
      assert.ok(items.includes(MENU.explorer), `メニューに「${MENU.explorer}」がない: ${items.join(', ')}`);
      await vs().clickMenuItem(MENU.explorer);
      await expectInChat('@alpha/src/app.js');
      assert.strictEqual(await vs().tabCount('app.js'), 0, 'ファイルのタブが開いた');
    });

    it('ファイル 2 つとフォルダ 1 つ → 選んだ順に 1 回で貼り付けられる', async function () {
      await vs().rightClickExplorer([APP_JS, ALPHA_SRC, ONLY_IN_BETA]);
      await vs().clickMenuItem(MENU.explorer);
      await expectInChat('@alpha/src/app.js @alpha/src/ @beta/src/only-in-beta.js');
    });
  });

  describe('エクスプローラーから追加する（設定 keep）', function () {
    beforeEach(async function () {
      await vs().setSetting('refsToChat.explorerClipboard', 'keep');
    });

    it('開いていないファイル → 入り、一瞬開いたタブは閉じる', async function () {
      await vs().rightClickExplorer([APP_JS]);
      await vs().clickMenuItem(MENU.explorer);
      await expectInChat('@alpha/src/app.js');
      // タブを閉じるのは、公式コマンドを呼んだあと
      assert.strictEqual(await vs().waitForTabCount('app.js', 0), 0, 'タブが残っている');
    });

    it('開いているファイル（範囲を選んでおく）→ 行番号なしで入り、タブは残る', async function () {
      await vs().openFile(APP_JS);
      await vs().selectLines(2, 3);
      await vs().rightClickExplorer([APP_JS]);
      await vs().clickMenuItem(MENU.explorer);
      const text = await expectInChat('@alpha/src/app.js');
      assert.match(text, /@alpha\/src\/app\.js(?!#)/);
      assert.strictEqual(await vs().tabCount('app.js'), 1, 'もともと開いていたタブが閉じた');
    });

    it('フォルダ → 貼り付けで入る', async function () {
      await vs().rightClickExplorer([ALPHA_SRC]);
      await vs().clickMenuItem(MENU.explorer);
      await expectInChat('@alpha/src/');
    });
  });

  // GUIDE_MD の行: 3〜5 が段落、7〜8 がリスト、10〜13 がコードブロック（10 と 13 は ```）
  // プレビューは開き方で webviewId が違うので、Ctrl+Shift+V と、横に開くものの両方で確かめる
  describe('Markdown のプレビューから追加する', function () {
    it('Ctrl+Shift+V のプレビューで、段落の 2 行目の途中だけを選ぶ → その行の参照が貼り付けで入る', async function () {
      await vs().openFile(GUIDE_MD);
      await vs().openMarkdownPreview('shortcut');
      const items = await vs().rightClickPreview(['p', 0, 30], ['p', 0, 40]);
      assert.ok(items.includes(MENU.selection), `メニューに「${MENU.selection}」がない: ${items.join(', ')}`);
      await vs().clickMenuItem(MENU.selection);
      const text = await expectInChat('@alpha/docs/guide.md#4');
      assert.match(text, /@alpha\/docs\/guide\.md#4(?![-\d])/);
    });

    it('横に開いたプレビューで、リストからコードブロックの中まで選ぶ → 範囲の参照が入る', async function () {
      await vs().openFile(GUIDE_MD);
      await vs().openMarkdownPreview('side');
      await vs().rightClickPreview(['li', 1, 0], ['code', 0, 15]);
      await vs().clickMenuItem(MENU.selection);
      await expectInChat('@alpha/docs/guide.md#8-12');
    });

    it('設定 refsToChat.markdownPreview を false にする → 選んでいても、メニューに出ない', async function () {
      await vs().setSetting('refsToChat.markdownPreview', false);
      await vs().openFile(GUIDE_MD);
      await vs().openMarkdownPreview('palette');
      const items = await vs().rightClickPreview(['p', 0, 30], ['p', 0, 40]);
      await vs().closeMenu();
      assert.ok(!items.includes(MENU.selection), items.join(', '));
      // 何かしらのメニューは出ている（右クリックが効いていないだけで通ってしまわないように）
      assert.ok(items.length > 0, '右クリックメニューが出ていない');
    });

    it('何も選ばずに右クリック → メニューに出ない', async function () {
      await vs().openFile(GUIDE_MD);
      await vs().openMarkdownPreview('palette');
      const items = await vs().rightClickPreview(['p', 0, 3]);
      await vs().closeMenu();
      assert.ok(!items.includes(MENU.selection), items.join(', '));
    });
  });

  describe('Markdown のプレビューから追加する（設定 keep）', function () {
    beforeEach(async function () {
      await vs().setSetting('refsToChat.previewClipboard', 'keep');
    });

    it('Ctrl+Shift+V のプレビュー → 元のファイルを一瞬開いて入れ、開いたタブは閉じる', async function () {
      await vs().openFile(GUIDE_MD);
      await vs().openMarkdownPreview('shortcut');
      const tabs = await vs().tabCount('guide.md');
      await vs().rightClickPreview(['p', 0, 30], ['p', 0, 40]);
      await vs().clickMenuItem(MENU.selection);
      const text = await expectInChat('@alpha/docs/guide.md#4');
      assert.match(text, /@alpha\/docs\/guide\.md#4(?![-\d])/);
      assert.strictEqual(await vs().waitForTabCount('guide.md', tabs), tabs, 'タブの数が元に戻らない');
    });

    it('横に開いたプレビュー → 横に表示している元のファイルで入れ、タブは増えない', async function () {
      await vs().openFile(GUIDE_MD);
      await vs().openMarkdownPreview('side');
      const tabs = await vs().tabCount('guide.md');
      await vs().rightClickPreview(['li', 1, 0], ['code', 0, 15]);
      await vs().clickMenuItem(MENU.selection);
      await expectInChat('@alpha/docs/guide.md#8-12');
      assert.strictEqual(await vs().waitForTabCount('guide.md', tabs), tabs, 'タブの数が変わった');
    });

    // 左: md（裏）と app.js（前面）、右: プレビューとチャットのタブ
    // md を右のグループに一瞬開くことになる。VS Code 1.100 では、開いたタブが閉じずに残っていた
    it('チャットのタブがプレビューと同じグループにあり、元のファイルは左の裏にある → 右に一瞬開いたタブを閉じる', async function () {
      await vs().openFile(GUIDE_MD);
      await vs().openMarkdownPreview('side');
      await vs().runCommand(CLAUDE_OPEN_IN_NEW_TAB);
      assert.ok(await vs().waitForChatInput(), 'チャットが開かない');
      await vs().waitForChatToSettle();
      await vs().runCommand(MOVE_EDITOR_TO_PREVIOUS_GROUP);
      await vs().runCommand(FOCUS_FIRST_EDITOR_GROUP);
      await vs().openFile(APP_JS);
      await vs().clickTab('Preview guide.md');
      const tabs = await vs().tabCount('guide.md');
      await vs().rightClickPreview(['p', 0, 30], ['p', 0, 40]);
      await vs().clickMenuItem(MENU.selection);
      await expectInChat('@alpha/docs/guide.md#4');
      assert.strictEqual(await vs().waitForTabCount('guide.md', tabs), tabs, '右に開いた md のタブが残っている');
    });

    // md のタブが同じグループの裏に回る（前面にあったプレビューを、入れたあとで前面に戻す）
    it('同じグループに別のタブで開いたプレビュー → 入れたあと、プレビューが前面に戻る', async function () {
      await vs().openFile(GUIDE_MD);
      await vs().openMarkdownPreview('palette');
      const before = await vs().frontTabName('guide.md');
      assert.strictEqual(before, 'Preview guide.md', 'プレビューが前面にない（テストの前提が崩れている）');
      await vs().rightClickPreview(['p', 0, 30], ['p', 0, 40]);
      await vs().clickMenuItem(MENU.selection);
      await expectInChat('@alpha/docs/guide.md#4');
      const after = await vs().waitForFrontTabName('guide.md', before);
      assert.strictEqual(after, before, `前面のタブが戻らない（前: ${before}）`);
    });
  });

  describe('ターミナル版の設定（claudeCode.useTerminal）', function () {
    afterEach(async function () {
      await vs().setSetting('claudeCode.useTerminal', undefined);
    });

    it('true にすると、右クリックメニューにもコマンドパレットにも出ない', async function () {
      await vs().setSetting('claudeCode.useTerminal', true);
      await vs().openFile(APP_JS);
      const editorItems = await vs().rightClickEditor();
      await vs().closeMenu();
      assert.ok(!editorItems.includes(MENU.currentFile) && !editorItems.includes(MENU.selection), editorItems.join(', '));
      const explorerItems = await vs().rightClickExplorer([APP_JS]);
      await vs().closeMenu();
      assert.ok(!explorerItems.includes(MENU.explorer), explorerItems.join(', '));
      assert.deepStrictEqual(ours(await vs().paletteItems(CATEGORY)), []);
    });
  });

  // チャットの置き場所を変えるので、最後に動かす
  describe('チャットをサイドバーに出したとき', function () {
    beforeEach(async function () {
      await vs().runCommand(CLAUDE_OPEN_IN_SIDE_BAR);
      assert.ok(await vs().waitForChatInput(), 'チャットが開かない');
      await vs().clearChat();
    });

    after(async function () {
      // サイドバーで開くと、公式拡張の設定 preferredLocation が sidebar に変わるので戻す
      await vs().setSetting('claudeCode.preferredLocation', 'panel');
      await vs().hideSecondarySideBar();
    });

    it('数行を選んで右クリック → 行番号付きで入る', async function () {
      await vs().openFile(APP_JS);
      await vs().selectLines(2, 3);
      await vs().rightClickEditor();
      await vs().clickMenuItem(MENU.selection);
      await expectInChat('@alpha/src/app.js#2-3');
    });

    it('エクスプローラーのファイル（初期設定 use）→ 貼り付けで入る', async function () {
      await vs().rightClickExplorer([APP_JS]);
      await vs().clickMenuItem(MENU.explorer);
      await expectInChat('@alpha/src/app.js');
    });
  });
});
