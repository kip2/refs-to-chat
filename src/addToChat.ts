// 右クリックのコマンドの本体
// 入口（sources/）が集めた Target を、chooseDelivery が決めた入れ方でチャットに入れる
// 公式コマンドで入れなかったものは、最後にまとめて貼り付けかコピーで届ける（delivery/pending.ts）

import * as vscode from 'vscode';
import { insertMentionFor } from './claude/chat';
import { chooseDelivery, type Delivery } from './delivery/choose';
import { openAndInsert } from './delivery/open';
import { deliverPendingReferences, type PendingReference } from './delivery/pending';
import { fileReference, folderReference, linesReference } from './reference';
import type { Source } from './sources/source';
import { type Target, uriOf } from './target';
import { columnShowing, workspacePath } from './workspace';

/** 入口から、右クリックで呼ばれるコマンドを作る */
export function addToChat<Args extends unknown[]>(source: Source<Args>): (...args: Args) => Promise<void> {
  return async (...args) => {
    // チャットを開くと今のグループが変わるので、最初にユーザーが選んでいたグループを覚えておく
    const startColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
    const collected = await source.collect(...args);
    if ('notice' in collected) {
      void vscode.window.showInformationMessage(collected.notice);
      return;
    }
    // 設定は 1 回だけ読み、途中で変わっても同じ入れ方で最後まで送る
    const clipboard = source.clipboard();

    const pending: PendingReference[] = [];
    for (const target of collected.targets) {
      const notAdded = await add(target, chooseDelivery(target, clipboard), startColumn);
      if (notAdded) pending.push(notAdded);
    }
    await deliverPendingReferences(pending);
  };
}

/**
 * 1 つの Target を、決めた入れ方で入れる
 * 公式コマンドで入れなかったら、まとめて届ける分として返す
 */
async function add(
  target: Target,
  delivery: Delivery,
  startColumn: vscode.ViewColumn,
): Promise<PendingReference | undefined> {
  switch (delivery.how) {
    case 'paste':
      return { ref: referenceOf(target), reason: 'paste' };
    case 'insert': {
      if (target.kind !== 'editor') return { ref: referenceOf(target), reason: 'paste' };
      const failure = await insertMentionFor(target.editor);
      // 参照は、入れられなかったときに作る（選択範囲は公式コマンドを呼んだあとのもの）
      return failure ? { ref: referenceOf(target), reason: failure } : undefined;
    }
    case 'open': {
      const uri = uriOf(target);
      const column = delivery.column === 'showing' ? columnShowing(uri, startColumn) : startColumn;
      const lines = target.kind === 'lines' ? target : undefined;
      const failure = await openAndInsert(uri, column, lines);
      if (!failure) return undefined;
      // 開けなかったもの（画像など）は貼り付けで、公式コマンドで入れられなかったものはコピーで届ける
      return { ref: referenceOf(target), reason: failure === 'notText' ? 'paste' : failure };
    }
  }
}

/** チャットに入れる参照の文字列（@src/app.ts#5-10 など） */
function referenceOf(target: Target): string {
  const path = workspacePath(uriOf(target));
  switch (target.kind) {
    case 'editor':
      return fileReference(path, target.editor.selection);
    case 'file':
      return fileReference(path);
    case 'folder':
      return folderReference(path);
    case 'lines':
      return linesReference(path, target.first, target.last);
  }
}
