// VS Code API の最小限のモック。src/extension.ts（コンパイル後の out/extension.js）が使う部分だけを再現し、呼び出しを記録する。
'use strict';

const path = require('path');
const Module = require('module');

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  constructor(startLine, startChar, endLine, endChar) {
    this.start = new Position(startLine, startChar);
    this.end = new Position(endLine, endChar);
  }
  get isEmpty() {
    return this.start.line === this.end.line && this.start.character === this.end.character;
  }
}

// VS Code の Selection と同様、start <= end に正規化する
function makeSelection(aLine, aChar, bLine, bChar) {
  const aFirst = aLine < bLine || (aLine === bLine && aChar <= bChar);
  return aFirst ? new Range(aLine, aChar, bLine, bChar) : new Range(bLine, bChar, aLine, aChar);
}

function uri(fsPath) {
  return { scheme: 'file', fsPath, path: fsPath, toString: () => `file://${fsPath}` };
}

function makeEditor(fsPath, selection = new Range(0, 0, 0, 0)) {
  return { document: { uri: uri(fsPath), fileName: fsPath }, selection };
}

/**
 * @param {object} opts
 * @param {string[]} [opts.workspaceFolders] ワークスペースフォルダの絶対パス（2つ以上でマルチルート扱い）
 * @param {boolean}  [opts.claudeInstalled=true]
 * @param {(id:string)=>any} [opts.onExecute] executeCommand の挙動（throw で失敗を再現）
 * @param {(fsPath:string)=>boolean} [opts.isBinary] openTextDocument が失敗するファイル
 */
function createVscodeMock(opts = {}) {
  const folders = (opts.workspaceFolders || ['/ws/project']).map((p, i) => ({
    uri: uri(p),
    name: path.posix.basename(p),
    index: i,
  }));

  const state = {
    executed: [],          // executeCommand に渡されたID
    clipboard: '',
    clipboardWrites: [],
    warnings: [],
    infos: [],
    registered: new Map(), // コマンドID -> ハンドラ
    opened: [],            // openTextDocument したパス
    shown: [],             // showTextDocument の { fsPath, options }
  };

  const vscode = {
    Range,
    Position,
    workspace: {
      workspaceFolders: folders,
      // VS Code の asRelativePath(pathOrUri, includeWorkspaceFolder) の挙動を再現
      // includeWorkspaceFolder 省略時はフォルダが2つ以上のときに true 扱い
      asRelativePath(target, includeWorkspaceFolder) {
        const p = typeof target === 'string' ? target : target.fsPath;
        const folder = [...folders]
          .sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length)
          .find((f) => p === f.uri.fsPath || p.startsWith(f.uri.fsPath + '/'));
        if (!folder) return p;
        const rel = path.posix.relative(folder.uri.fsPath, p);
        const include = includeWorkspaceFolder === undefined ? folders.length > 1 : includeWorkspaceFolder;
        return include ? `${folder.name}/${rel}` : rel;
      },
      async openTextDocument(u) {
        state.opened.push(u.fsPath);
        if (opts.isBinary && opts.isBinary(u.fsPath)) {
          throw new Error('File seems to be binary and cannot be opened as text');
        }
        return { uri: u, fileName: u.fsPath };
      },
      getConfiguration: () => ({ get: (_k, d) => d }),
    },
    window: {
      activeTextEditor: undefined,
      async showTextDocument(doc, options) {
        state.shown.push({ fsPath: doc.uri.fsPath, options });
        const editor = { document: doc, selection: options && options.selection ? options.selection : new Range(0, 0, 0, 0) };
        vscode.window.activeTextEditor = editor;
        return editor;
      },
      showWarningMessage: (m) => { state.warnings.push(m); },
      showInformationMessage: (m) => { state.infos.push(m); },
    },
    commands: {
      registerCommand(id, handler) {
        if (state.registered.has(id)) throw new Error(`command '${id}' already exists`);
        state.registered.set(id, handler);
        return { dispose: () => state.registered.delete(id) };
      },
      async executeCommand(id, ...args) {
        state.executed.push(id);
        if (opts.onExecute) return opts.onExecute(id, ...args);
        return undefined;
      },
    },
    extensions: {
      getExtension: (id) => (opts.claudeInstalled === false || id !== 'anthropic.claude-code' ? undefined : { id }),
    },
    env: {
      clipboard: {
        async writeText(t) { state.clipboard = t; state.clipboardWrites.push(t); },
      },
    },
  };

  return { vscode, state };
}

const EXT_PATH = path.resolve(__dirname, '../../out/extension.js');

/** モックを差し込んで out/extension.js を毎回まっさらに読み込む */
function loadExtension(vscode) {
  const origLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'vscode') return vscode;
    return origLoad.call(this, request, ...rest);
  };
  try {
    delete require.cache[EXT_PATH];
    return require(EXT_PATH);
  } finally {
    Module._load = origLoad;
  }
}

/** モック + 拡張 + activate 済みのセットを作る */
function setup(opts) {
  const { vscode, state } = createVscodeMock(opts);
  const ext = loadExtension(vscode);
  const context = { subscriptions: [] };
  ext.activate(context);
  const run = (id, ...args) => state.registered.get(id)(...args);
  return { vscode, state, ext, context, run };
}

module.exports = { createVscodeMock, loadExtension, setup, makeEditor, makeSelection, Range, uri };
