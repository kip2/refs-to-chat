// VS Code API の最小限のモック
// 拡張（out/*.js）が使う部分だけを再現し、呼び出しを記録する

// 本物の API と同じく Promise を返すために async にしている（中で await しないものもある）
/* eslint-disable @typescript-eslint/require-await */

import * as path from 'path';
import Module = require('module');

// 型だけを使う（実行時には読み込まないので、モックより先に本物の拡張が読み込まれることはない）
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

/** VS Code の Selection と同じく、start <= end に並べ替える */
export function makeSelection(aLine: number, aChar: number, bLine: number, bChar: number): Range {
  const aFirst = aLine < bLine || (aLine === bLine && aChar <= bChar);
  return aFirst ? new Range(aLine, aChar, bLine, bChar) : new Range(bLine, bChar, aLine, aChar);
}

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

interface MockEditor {
  document: MockDocument;
  selection?: Range;
}

export function makeEditor(fsPath: string, selection: Range = new Range(0, 0, 0, 0)): MockEditor {
  return { document: { uri: uri(fsPath), fileName: fsPath }, selection };
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
  /** openTextDocument したパス */
  opened: string[];
  /** showTextDocument に渡されたもの */
  shown: { fsPath: string; options: { preview?: boolean; preserveFocus?: boolean; selection?: Range } }[];
}

export function createVscodeMock(opts: MockOptions = {}) {
  const folders = (opts.workspaceFolders ?? ['/ws/project']).map((p, i) => ({
    uri: uri(p),
    name: path.posix.basename(p),
    index: i,
  }));

  const state: MockState = {
    executed: [],
    clipboard: '',
    clipboardWrites: [],
    warnings: [],
    infos: [],
    registered: new Map(),
    opened: [],
    shown: [],
  };

  const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };
  const is = (pred: PathPredicate | undefined, p: string) => Boolean(pred?.(p));

  const vscode = {
    Range,
    Position,
    FileType,
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
        return { uri: u, fileName: u.fsPath };
      },
    },
    window: {
      activeTextEditor: undefined as MockEditor | undefined,
      async showTextDocument(doc: MockDocument, options: MockState['shown'][number]['options']) {
        state.shown.push({ fsPath: doc.uri.fsPath, options });
        if (is(opts.showFails, doc.uri.fsPath)) throw new Error('Could not open editor');
        const editor: MockEditor = { document: doc, selection: options.selection ?? new Range(0, 0, 0, 0) };
        vscode.window.activeTextEditor = editor;
        return editor;
      },
      // 本物と同じく Thenable を返す（本物はユーザーが閉じるまで解決しない）
      showWarningMessage: (m: string) => {
        state.warnings.push(m);
        return Promise.resolve(undefined);
      },
      showInformationMessage: (m: string) => {
        state.infos.push(m);
        return Promise.resolve(undefined);
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
