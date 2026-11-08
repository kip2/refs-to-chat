// VS Code API の最小限のモック
// 拡張（out/*.js）が使う部分だけを再現し、呼び出しを記録する
// 拡張が CommonJS の require('vscode') でモックを読むことを前提にしている

import * as path from 'node:path';
import Module = require('node:module');

// 型だけを使う
// 実行時には読み込まないので、モックより先に本物が読み込まれることはない
type Extension = typeof import('../../extension');

export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}

export class Range {
  readonly start: Position;
  readonly end: Position;
  constructor(startLine: number, startChar: number, endLine: number, endChar: number) {
    this.start = new Position(startLine, startChar);
    this.end = new Position(endLine, endChar);
  }
  get isEmpty(): boolean {
    return this.start.line === this.end.line && this.start.character === this.end.character;
  }
}

/** VS Code の Selection と同じく、start <= end に並べ替え、anchor と active も持つ */
export class Selection extends Range {
  constructor(
    readonly anchor: Position,
    readonly active: Position,
  ) {
    const anchorFirst =
      anchor.line < active.line || (anchor.line === active.line && anchor.character <= active.character);
    const [s, e] = anchorFirst ? [anchor, active] : [active, anchor];
    super(s.line, s.character, e.line, e.character);
  }
}

export function makeSelection(aLine: number, aChar: number, bLine: number, bChar: number): Selection {
  return new Selection(new Position(aLine, aChar), new Position(bLine, bChar));
}

const emptySelection = () => makeSelection(0, 0, 0, 0);

export interface MockUri {
  scheme: string;
  fsPath: string;
  path: string;
  toString(): string;
}

export function uri(fsPath: string): MockUri {
  return { scheme: 'file', fsPath, path: fsPath, toString: () => `file://${fsPath}` };
}

interface MockDocument {
  uri: MockUri;
  fileName: string;
  /** ドキュメントの版（変わるたびに 1 つ進む） */
  version?: number;
  lineCount?: number;
  lineAt?(line: number): { text: string; range: Range };
}

/** 本物と同じく、selection は selections の先頭 */
export class MockEditor {
  selections: Range[];
  /** どのエディタグループにあるか（1: 今のグループ、2: 別のグループ） */
  viewColumn = 1;
  constructor(
    readonly document: MockDocument,
    selection: Range = emptySelection(),
  ) {
    this.selections = [selection];
  }
  get selection(): Range {
    return this.selections[0];
  }
  set selection(s: Range) {
    this.selections = [s];
  }
}

export function makeEditor(fsPath: string, selection?: Range): MockEditor {
  return new MockEditor({ uri: uri(fsPath), fileName: fsPath }, selection);
}

type PathPredicate = (fsPath: string) => boolean;

export interface MockOptions {
  /** ワークスペースフォルダの絶対パス（2 つ以上でマルチルート） */
  workspaceFolders?: string[];
  claudeInstalled?: boolean;
  /**
   * Remote（WSL など）につないでいるときの名前（例: `wsl`）
   * Remote では、公式拡張がリモート側にあると getExtension で見えない
   */
  remoteName?: string;
  /** 公式拡張がリモート側にある（getExtension では見えないが、コマンドは呼べる）。remoteName と一緒に使う */
  claudeInRemote?: boolean;
  /** getCommands が例外を投げる */
  getCommandsFails?: boolean;
  /**
   * フォーカスがチャットに移らず、貼り付けがファイルに入ってしまう（ファイルの変更が届く）
   * - active: 前面のエディタのファイルに入る
   * - other: 前面ではないファイルに入る
   * - activeThenEdited: 前面のエディタのファイルに入り、そのあとすぐ別の変更も入る
   */
  pasteIntoFile?: 'active' | 'other' | 'activeThenEdited';
  /** undo を呼んでも、何も取り消されない */
  undoDoesNothing?: boolean;
  /** executeCommand の動き（throw で失敗を再現） */
  onExecute?: (id: string, ...args: unknown[]) => unknown;
  /** openTextDocument が失敗するファイル */
  isBinary?: PathPredicate;
  /** workspace.fs.stat でフォルダと答えるパス */
  isFolder?: PathPredicate;
  /** フォルダへのシンボリックリンク（Directory | SymbolicLink） */
  isSymlinkFolder?: PathPredicate;
  /** workspace.fs.stat が失敗するパス */
  statFails?: PathPredicate;
  /** showTextDocument が失敗するファイル */
  showFails?: PathPredicate;
  /** 最初から、今のエディタグループにタブが開いているファイル */
  openTabs?: string[];
  /** 最初から、別のエディタグループにだけタブが開いているファイル */
  otherGroupTabs?: string[];
  /** 開いているファイルの選択範囲（showTextDocument で前面に出したときに、この選択のまま出てくる） */
  selections?: Record<string, Range>;
  /** openTextDocument が返すドキュメントのパス（Windows で大文字小文字だけ違うパスを再現する） */
  documentPath?: (fsPath: string) => string;
  /** tabGroups.close が例外を投げる */
  closeFails?: boolean;
  /** チャットをエディタのタブで開いている（チャットにフォーカスを移すと、アクティブなエディタがなくなる） */
  chatInEditorTab?: boolean;
  /** チャットのタブがあるエディタグループ（chatInEditorTab のとき、チャットを開くとこのグループが今のグループになる） */
  chatColumn?: number;
  /** openTextDocument で開いたファイルの中身（パス → 文字列。なければ空） */
  documentText?: Record<string, string>;
  /** 設定（例: `{ 'refsToChat.explorerClipboard': 'keep' }`） */
  settings?: Record<string, unknown>;
}

/** VS Code の TabInputText（テキストエディタのタブ） */
export class TabInputText {
  constructor(readonly uri: MockUri) {}
}

interface MockTab {
  input: TabInputText;
}

type Handler = (...args: unknown[]) => unknown;
type DocChangeListener = (e: { document: MockDocument; contentChanges: { text: string }[] }) => void;

// 公式拡張のコマンド（getCommands で返す）
const CMD_FOCUS = 'claude-vscode.focus';
const CMD_INSERT = 'claude-vscode.insertAtMention';

export interface MockState {
  /** executeCommand に渡された ID */
  executed: string[];
  clipboard: string;
  clipboardWrites: string[];
  warnings: string[];
  infos: string[];
  /** コマンド ID → ハンドラ */
  registered: Map<string, Handler>;
  /** openTextDocument に渡されたパス */
  opened: string[];
  /** showTextDocument に渡されたもの */
  shown: { fsPath: string; options: { preview?: boolean; preserveFocus?: boolean; viewColumn?: number; selection?: Range } }[];
  /** 今のエディタグループのタブ */
  tabs: MockTab[];
  /** 別のエディタグループのタブ */
  otherTabs: MockTab[];
  /** tabGroups.close で閉じたファイルのパス */
  closed: string[];
  /** tabGroups.close に渡された preserveFocus */
  closePreserveFocus: (boolean | undefined)[];
  /** パス → そのファイルのエディタ（もう一度前面に出すと同じエディタが出てくる） */
  editors: Map<string, MockEditor>;
  /** 今のエディタグループ（1 か 2） */
  activeColumn: number;
  /** グループごとの、前面にあるタブ（最初は、そのグループの最後のタブ） */
  front: Map<number, MockTab | undefined>;
  /** コマンドの呼び出し（cmd:）とエディタの表示（show:）の順番 */
  log: string[];
}

export function createVscodeMock(opts: MockOptions = {}) {
  if (opts.claudeInRemote && !opts.remoteName) throw new Error('claudeInRemote は remoteName と一緒に使う');
  // 公式拡張が、この拡張と同じ場所にあるか（リモート側にあるときは見えない）
  const claudeHere = opts.claudeInstalled !== false && !opts.claudeInRemote;
  // 公式コマンドを呼べるか（同じ場所か、リモート側にある）
  const claudeReachable = claudeHere || opts.claudeInRemote === true;
  const docChangeListeners = new Set<DocChangeListener>();
  let pastedDocument: MockDocument | undefined;
  const folders = (opts.workspaceFolders ?? ['/ws/project']).map((p, i) => ({
    uri: uri(p),
    name: path.posix.basename(p),
    index: i,
  }));

  const toTab = (p: string): MockTab => ({ input: new TabInputText(uri(p)) });
  const state: MockState = {
    executed: [],
    clipboard: '',
    clipboardWrites: [],
    warnings: [],
    infos: [],
    registered: new Map(),
    opened: [],
    shown: [],
    tabs: (opts.openTabs ?? []).map(toTab),
    otherTabs: (opts.otherGroupTabs ?? []).map(toTab),
    closed: [],
    closePreserveFocus: [],
    editors: new Map(),
    activeColumn: 1,
    log: [],
    front: new Map(),
  };
  state.front.set(1, state.tabs[state.tabs.length - 1]);
  state.front.set(2, state.otherTabs[state.otherTabs.length - 1]);
  // グループごとに、前面に出た順（最後が今の前面）。最初は、タブの並び順に使ったものとする
  const used = new Map<number, MockTab[]>([
    [1, [...state.tabs]],
    [2, [...state.otherTabs]],
  ]);
  const setFront = (column: number, tab: MockTab | undefined) => {
    state.front.set(column, tab);
    if (!tab) return;
    used.set(column, [...(used.get(column) ?? []).filter((t) => t !== tab), tab]);
  };
  const FOCUS_GROUP = ['workbench.action.focusFirstEditorGroup', 'workbench.action.focusSecondEditorGroup'];
  const tabsOfColumn = (column: number) => (column === 2 ? state.otherTabs : state.tabs);
  const groupOf = (column: number) => ({ viewColumn: column, tabs: tabsOfColumn(column), activeTab: state.front.get(column) });
  const hasTabIn = (tabs: MockTab[], u: MockUri) => tabs.some((t) => t.input.uri.toString() === u.toString());

  const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };
  const is = (pred: PathPredicate | undefined, p: string) => Boolean(pred?.(p));
  // 本物の通知は、ユーザーが閉じるまで解決しない
  // うっかり await すると、テストが止まって気づける
  const pending = () => new Promise<undefined>(() => {});
  let active: MockEditor | undefined;

  const vscode = {
    Range,
    Position,
    Selection,
    FileType,
    TabInputText,
    // file:// の URI だけを読む（パスはそのまま fsPath にする）
    Uri: {
      parse(value: string, strict?: boolean): MockUri {
        const m = /^file:\/\/(.*)$/.exec(value);
        if (!m) {
          if (strict) throw new Error(`[UriError]: Scheme is missing: ${value}`);
          return uri(value);
        }
        return uri(decodeURIComponent(m[1]));
      },
    },
    workspace: {
      workspaceFolders: folders,
      onDidChangeTextDocument(listener: DocChangeListener) {
        docChangeListeners.add(listener);
        return { dispose: () => docChangeListeners.delete(listener) };
      },
      // 本物と同じく、設定されていなければ初期値を返す
      getConfiguration(section: string) {
        return {
          get<T>(key: string, defaultValue: T): T {
            const value = opts.settings?.[`${section}.${key}`];
            return value === undefined ? defaultValue : (value as T);
          },
        };
      },
      fs: {
        async stat(u: MockUri) {
          if (is(opts.statFails, u.fsPath)) throw new Error('EntryNotFound (FileSystemError)');
          let type = FileType.File;
          if (is(opts.isFolder, u.fsPath)) type = FileType.Directory;
          if (is(opts.isSymlinkFolder, u.fsPath)) type = FileType.Directory | FileType.SymbolicLink;
          return { type, ctime: 0, mtime: 0, size: 0 };
        },
      },
      // asRelativePath の再現
      // 第 2 引数を省くと、フォルダが 2 つ以上のときだけ true
      asRelativePath(target: string | MockUri, includeWorkspaceFolder?: boolean): string {
        const p = typeof target === 'string' ? target : target.fsPath;
        const folder = [...folders]
          .sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length)
          .find((f) => p === f.uri.fsPath || p.startsWith(f.uri.fsPath + '/'));
        if (!folder) return p;
        const rel = path.posix.relative(folder.uri.fsPath, p);
        const include = includeWorkspaceFolder ?? folders.length > 1;
        return include ? `${folder.name}/${rel}` : rel;
      },
      async openTextDocument(u: MockUri): Promise<MockDocument> {
        state.opened.push(u.fsPath);
        if (is(opts.isBinary, u.fsPath)) throw new Error('File seems to be binary and cannot be opened as text');
        const p = opts.documentPath?.(u.fsPath) ?? u.fsPath;
        const lines = (opts.documentText?.[u.fsPath] ?? '').split('\n');
        return { uri: uri(p), fileName: p, lineCount: lines.length, lineAt: (i: number) => ({ text: lines[i], range: new Range(i, 0, i, lines[i].length) }) };
      },
    },
    window: {
      // テストが直接入れたエディタも覚えておき、同じファイルをもう一度前面に出したら同じエディタを返す
      get activeTextEditor(): MockEditor | undefined {
        return active;
      },
      set activeTextEditor(editor: MockEditor | undefined) {
        active = editor;
        if (editor && !state.editors.has(editor.document.uri.fsPath)) state.editors.set(editor.document.uri.fsPath, editor);
      },
      get visibleTextEditors(): MockEditor[] {
        return [...state.editors.values()];
      },
      // 本物と同じく、指定がなければ今のエディタグループに開く
      // 別のグループにだけあるときも、開いた先のグループに新しいタブができる
      async showTextDocument(doc: MockDocument, options: MockState['shown'][number]['options']) {
        state.shown.push({ fsPath: doc.uri.fsPath, options });
        if (is(opts.showFails, doc.uri.fsPath)) throw new Error('Could not open editor');
        const key = doc.uri.fsPath;
        const column = options.viewColumn ?? state.activeColumn;
        state.log.push(`show:${key}@${column}`);
        const tabs = tabsOfColumn(column);
        if (!hasTabIn(tabs, doc.uri)) tabs.push({ input: new TabInputText(doc.uri) });
        setFront(
          column,
          tabs.find((t) => t.input.uri.toString() === doc.uri.toString()),
        );
        let editor = state.editors.get(key);
        if (!editor) {
          editor = new MockEditor(doc, opts.selections?.[key]);
          state.editors.set(key, editor);
        }
        if (options.selection) editor.selection = options.selection;
        editor.viewColumn = column;
        state.activeColumn = column;
        vscode.window.activeTextEditor = editor;
        return editor;
      },
      tabGroups: {
        get all() {
          return [groupOf(1), groupOf(2)];
        },
        get activeTabGroup() {
          return groupOf(state.activeColumn);
        },
        async close(tabs: MockTab | MockTab[], preserveFocus?: boolean) {
          state.closePreserveFocus.push(preserveFocus);
          if (opts.closeFails) throw new Error('Could not close tab');
          for (const tab of Array.isArray(tabs) ? tabs : [tabs]) {
            state.tabs = state.tabs.filter((t) => t !== tab);
            state.otherTabs = state.otherTabs.filter((t) => t !== tab);
            for (const [column, front] of state.front) if (front === tab) state.front.set(column, undefined);
            state.closed.push(tab.input.uri.fsPath);
          }
          return true;
        },
      },
      showWarningMessage: (m: string) => {
        state.warnings.push(m);
        return pending();
      },
      showInformationMessage: (m: string) => {
        state.infos.push(m);
        return pending();
      },
    },
    commands: {
      registerCommand(id: string, handler: Handler) {
        if (state.registered.has(id)) throw new Error(`command '${id}' already exists`);
        state.registered.set(id, handler);
        return { dispose: () => state.registered.delete(id) };
      },
      async executeCommand(id: string, ...args: unknown[]) {
        state.executed.push(id);
        state.log.push(`cmd:${id}`);
        // 公式の「@メンションを入れる」は、エディタから参照を作ってから、チャットにフォーカスを移す
        // テストの onExecute は「参照を作る時点」なので、フォーカスを移す前に呼ぶ
        // 公式拡張がどこにもないときは、公式コマンドは見つからない
        if (id.startsWith('claude-vscode.') && !claudeReachable) throw new Error(`command '${id}' not found`);
        const result = opts.onExecute?.(id, ...args);
        if (id === 'editor.action.clipboardPasteAction' && opts.pasteIntoFile) {
          const active = vscode.window.activeTextEditor?.document;
          const target: MockDocument =
            opts.pasteIntoFile === 'other' || !active ? { uri: uri('/ws/project/other.js'), fileName: 'other.js' } : active;
          target.version = (target.version ?? 1) + 1;
          pastedDocument = target;
          for (const listener of docChangeListeners) listener({ document: target, contentChanges: [{ text: state.clipboard }] });
          if (opts.pasteIntoFile === 'activeThenEdited') target.version += 1;
        }
        if (id === 'undo' && pastedDocument && !opts.undoDoesNothing) {
          pastedDocument.version = (pastedDocument.version ?? 1) + 1;
        }
        // エディタグループにフォーカスを移す（1 番目と 2 番目だけ）
        if (FOCUS_GROUP.includes(id)) state.activeColumn = FOCUS_GROUP.indexOf(id) + 1;
        // 今のグループで、直前に前面にあったタブを前面に出す
        if (id === 'workbench.action.openPreviousRecentlyUsedEditorInGroup') {
          const order = used.get(state.activeColumn) ?? [];
          if (order.length >= 2) setFront(state.activeColumn, order[order.length - 2]);
        }
        // チャットをエディタのタブで開いていると、チャットに移ったときにアクティブなエディタがなくなる
        // 今のグループも、チャットのタブがあるグループに移る
        const movesToChat = id === 'claude-vscode.focus' || id === 'claude-vscode.insertAtMention';
        if (movesToChat && opts.chatInEditorTab) {
          vscode.window.activeTextEditor = undefined;
          state.activeColumn = opts.chatColumn ?? state.activeColumn;
        }
        return result;
      },
      // 公式拡張がどこかにあれば、その（呼んだあとの）コマンドが登録されている
      // 本物では、公式拡張が起動してコマンドを登録するまでは出てこない
      // この拡張は公式コマンドを呼んだあとにしか調べないので、モックでは区別しない
      async getCommands() {
        if (opts.getCommandsFails) throw new Error('getCommands failed');
        return [...state.registered.keys(), ...(claudeReachable ? [CMD_FOCUS, CMD_INSERT] : [])];
      },
    },
    extensions: {
      getExtension: (id: string) =>
        claudeHere && id === 'anthropic.claude-code' ? { id } : undefined,
    },
    env: {
      remoteName: opts.remoteName,
      clipboard: {
        async writeText(t: string) {
          state.clipboard = t;
          state.clipboardWrites.push(t);
        },
      },
    },
  };

  return { vscode, state };
}

export type VscodeMock = ReturnType<typeof createVscodeMock>['vscode'];

// このファイルは out/test/helpers/ にコンパイルされる
const OUT_DIR = path.resolve(__dirname, '../..');
const EXT_PATH = path.join(OUT_DIR, 'extension.js');

// Module._load は型定義にない Node の内部関数
const NodeModule = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };

/**
 * モックを差し込んで out/extension.js を毎回まっさらに読み込む
 * out/ の各ファイルが 'vscode' を読むので、テストごとにモックを替えられるよう out/ のキャッシュを消す
 * テスト自身（out/test/）は消さない
 */
export function loadExtension(vscode: VscodeMock): Extension {
  const testDir = path.join(OUT_DIR, 'test') + path.sep;
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(OUT_DIR + path.sep) && !key.startsWith(testDir)) delete require.cache[key];
  }
  const origLoad = NodeModule._load;
  NodeModule._load = function (this: unknown, request: string, ...rest: unknown[]) {
    if (request === 'vscode') return vscode;
    return origLoad.call(this, request, ...rest);
  };
  try {
    // モックを差し込んだ状態で読み込むため、import ではなく実行時に require する
    return require(EXT_PATH) as Extension;
  } finally {
    NodeModule._load = origLoad;
  }
}

/** モック + 拡張 + activate 済みのセットを作る */
export function setup(opts?: MockOptions) {
  const { vscode, state } = createVscodeMock(opts);
  const ext = loadExtension(vscode);
  // 貼り付けの前後の待ち時間はテストでは待たない
  // 拡張は呼ぶたびに constants から読むので、読み込んだあとに書き換えれば効く
  const constants = require(path.join(OUT_DIR, 'constants.js')) as { FOCUS_WAIT_MS: number; PASTE_CHECK_MS: number };
  constants.FOCUS_WAIT_MS = 0;
  constants.PASTE_CHECK_MS = 0;
  const context = { subscriptions: [] as { dispose(): unknown }[] };
  ext.activate(context as never);
  const run = (id: string, ...args: unknown[]) => {
    const handler = state.registered.get(id);
    if (!handler) throw new Error(`command '${id}' is not registered`);
    return handler(...args) as Promise<void>;
  };
  return { vscode, state, ext, context, run };
}
