// VS Code API の最小限のモック
// 拡張（out/*.js）が使う部分だけを再現し、呼び出しを記録する
// 拡張が CommonJS の require('vscode') でモックを読むことを前提にしている

import * as path from 'path';
import Module = require('module');

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
}

/** 本物と同じく、selection は selections の先頭 */
export class MockEditor {
  selections: Range[];
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
}

/** VS Code の TabInputText（テキストエディタのタブ） */
export class TabInputText {
  constructor(readonly uri: MockUri) {}
}

interface MockTab {
  input: TabInputText;
}

type Handler = (...args: unknown[]) => unknown;

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
  shown: { fsPath: string; options: { preview?: boolean; preserveFocus?: boolean } }[];
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
}

export function createVscodeMock(opts: MockOptions = {}) {
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
  };
  const hasTabIn = (tabs: MockTab[], u: MockUri) => tabs.some((t) => t.input.uri.toString() === u.toString());

  const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };
  const is = (pred: PathPredicate | undefined, p: string) => Boolean(pred?.(p));
  // 本物の通知は、ユーザーが閉じるまで解決しない
  // うっかり await すると、テストが止まって気づける
  const pending = () => new Promise<undefined>(() => {});

  const vscode = {
    Range,
    Position,
    Selection,
    FileType,
    TabInputText,
    workspace: {
      workspaceFolders: folders,
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
        return { uri: uri(p), fileName: p };
      },
    },
    window: {
      activeTextEditor: undefined as MockEditor | undefined,
      // 本物と同じく、今のエディタグループに開く（別のグループにだけあるときは、今のグループに新しいタブができる）
      async showTextDocument(doc: MockDocument, options: MockState['shown'][number]['options']) {
        state.shown.push({ fsPath: doc.uri.fsPath, options });
        if (is(opts.showFails, doc.uri.fsPath)) throw new Error('Could not open editor');
        const key = doc.uri.fsPath;
        if (!hasTabIn(state.tabs, doc.uri)) state.tabs.push({ input: new TabInputText(doc.uri) });
        let editor = state.editors.get(key);
        if (!editor) {
          editor = new MockEditor(doc, opts.selections?.[key]);
          state.editors.set(key, editor);
        }
        vscode.window.activeTextEditor = editor;
        return editor;
      },
      tabGroups: {
        get all() {
          return [{ tabs: state.tabs }, { tabs: state.otherTabs }];
        },
        get activeTabGroup() {
          return { tabs: state.tabs };
        },
        async close(tabs: MockTab | MockTab[], preserveFocus?: boolean) {
          state.closePreserveFocus.push(preserveFocus);
          if (opts.closeFails) throw new Error('Could not close tab');
          for (const tab of Array.isArray(tabs) ? tabs : [tabs]) {
            state.tabs = state.tabs.filter((t) => t !== tab);
            state.otherTabs = state.otherTabs.filter((t) => t !== tab);
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
        return opts.onExecute?.(id, ...args);
      },
    },
    extensions: {
      getExtension: (id: string) =>
        opts.claudeInstalled === false || id !== 'anthropic.claude-code' ? undefined : { id },
    },
    env: {
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
  const context = { subscriptions: [] as { dispose(): unknown }[] };
  ext.activate(context as never);
  const run = (id: string, ...args: unknown[]) => {
    const handler = state.registered.get(id);
    if (!handler) throw new Error(`command '${id}' is not registered`);
    return handler(...args) as Promise<void>;
  };
  return { vscode, state, ext, context, run };
}
