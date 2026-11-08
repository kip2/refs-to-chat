// VS Code 組み込みの Markdown プレビューに読み込まれるスクリプト（package.json の markdown.previewScripts）
// 右クリックしたときの選択範囲を、元のファイルの行が分かる値にして、body の data-vscode-context に入れる
// 右クリックのメニューから呼ばれるコマンドは、この値を引数で受け取る（行に直すのは src/sources/previewLines.ts）
//
// 組み込みのプレビューの作り（公開された約束ではないもの）に頼るのは、このファイルだけにする
// - 各ブロックの data-line 属性（元のファイルの行、0 始まり）
// - meta#vscode-markdown-preview-data の data-settings にある source（元のファイルの URI）
// - 段落やコードブロックの中の改行が、プレビューでも改行の文字のまま残っていること
// 変わると、メニューが出なくなるか、行がずれる（E2E テストで気づける）

(function () {
  'use strict';

  // src/sources/previewLines.ts の PREVIEW_CONTEXT_KEY と同じ名前
  const KEY = 'refsToChatPreviewSelection';
  const CONTEXT_ATTR = 'data-vscode-context';
  const LINE_ATTR = 'data-line';
  const SETTINGS_ID = 'vscode-markdown-preview-data';

  // この要素のすぐ下にある改行は、HTML を整えるためのもので、元のファイルの改行ではない
  const LAYOUT_TAGS = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'UL', 'OL', 'BLOCKQUOTE']);

  /** 元のファイルの URI（取れなければ undefined） */
  function sourceUri() {
    const el = document.getElementById(SETTINGS_ID);
    if (!el) return undefined;
    const settings = JSON.parse(el.getAttribute('data-settings') || '{}');
    return typeof settings.source === 'string' && settings.source ? settings.source : undefined;
  }

  /** node を含む、いちばん内側の data-line のある要素 */
  function closestBlock(node) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el && !el.hasAttribute(LINE_ATTR)) el = el.parentElement;
    return el;
  }

  /**
   * node の行を決めるブロック
   * HTML ブロックは、data-line が中身のない目印の要素に付き、本文はその後ろに並ぶ
   * そこで、data-line のある要素の中になければ、文書の順で前にある最後の data-line の要素を使う
   */
  function blockOf(node) {
    const closest = closestBlock(node);
    if (closest) return closest;
    let previous = null;
    for (const el of document.querySelectorAll(`[${LINE_ATTR}]`)) {
      if (!(el.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
      previous = el;
    }
    return previous;
  }

  /** 元のファイルの改行として数える文字か（整形のための改行は数えない） */
  function isSourceText(text, block) {
    return closestBlock(text) === block && !LAYOUT_TAGS.has(text.parentElement.tagName);
  }

  function countNewlines(s) {
    return s.split('\n').length - 1;
  }

  /**
   * 選択の端（node と offset）を、ブロックの data-line と、ブロックの中でその前にある改行の数で表す
   * ブロックが見つからない（フロントマターなど）ときは、ファイルの 1 行目とする
   */
  function pointOf(node, offset) {
    const block = blockOf(node);
    if (!block) return { line: 0, newlines: 0, code: false };
    const line = Number(block.getAttribute(LINE_ATTR));
    const code = block.tagName === 'CODE';
    // ブロックの外（HTML ブロックの本文）は、ブロックの先頭の行とする
    if (!block.contains(node)) return { line, newlines: 0, code };

    const before = document.createRange();
    before.setStart(block, 0);
    before.setEnd(node, offset);
    let newlines = 0;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (text === node) {
        if (isSourceText(text, block)) newlines += countNewlines(text.data.slice(0, offset));
        break;
      }
      // その位置より後ろの文字に来たら終わり
      if (before.comparePoint(text, text.length) !== 0) break;
      if (isSourceText(text, block)) newlines += countNewlines(text.data);
    }
    return { line, newlines, code };
  }

  /**
   * 選択の終わりの位置
   * トリプルクリックなどでは、選択が次のブロックの先頭（何も選んでいない位置）で終わる
   * そのときは、選んだ最後の文字の位置に戻す
   */
  function endOf(range) {
    if (range.endOffset > 0 || range.endContainer === range.startContainer) return [range.endContainer, range.endOffset];
    let last = null;
    const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (range.comparePoint(text, 0) > 0) break;
      if (text === range.endContainer || text.length === 0 || !range.intersectsNode(text)) continue;
      // ブロックの間の整形のための空白は、選んだ文字に数えない
      if (!/\S/.test(text.data) && (!closestBlock(text) || LAYOUT_TAGS.has(text.parentElement.tagName))) continue;
      last = text;
    }
    return last ? [last, last.length] : [range.endContainer, range.endOffset];
  }

  /** 今の選択範囲の値（選択がなければ undefined） */
  function selectionValue() {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return undefined;
    const source = sourceUri();
    if (!source) return undefined;
    const range = selection.getRangeAt(0);
    const [endNode, endOffset] = endOf(range);
    return { source, start: pointOf(range.startContainer, range.startOffset), end: pointOf(endNode, endOffset) };
  }

  /**
   * 右クリックのたびに、値を入れ直す
   * VS Code は、この処理のあとで data-vscode-context を読み、メニューの表示とコマンドの引数に使う
   * 途中で失敗しても前の値が残らないよう、先に消してから計算する
   */
  function update() {
    const body = document.body;
    let context = {};
    try {
      context = JSON.parse(body.getAttribute(CONTEXT_ATTR) || '{}');
    } catch {
      context = {};
    }
    delete context[KEY];
    try {
      const value = selectionValue();
      if (value) context[KEY] = value;
    } catch (err) {
      console.error('[refs-to-chat]', err);
    }
    if (Object.keys(context).length > 0) body.setAttribute(CONTEXT_ATTR, JSON.stringify(context));
    else body.removeAttribute(CONTEXT_ATTR);
  }

  // キャプチャで受け取り、VS Code が値を読むより先に入れる
  document.addEventListener('contextmenu', update, true);
})();
