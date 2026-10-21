import { $createListItemNode, $createListNode, $isListItemNode, $isListNode, type ListItemNode, type ListNode, type ListType } from "@lexical/list";
import {
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $getState,
  $isElementNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $isTextNode,
  $setState,
  type ElementNode,
  type LexicalNode,
  type PointType,
} from "lexical";

import { wasChecked } from "./blockState";
import { listLetters } from "./listStyle";
import { $createToggle, $isToggleContainerNode, $isToggleContentNode, type ToggleContainerNode } from "./ToggleNodes";

/*
 * Notion 식 블록 개요 — 한 범위(문서 · 토글 안 · 콜아웃 안)의 블록을 "순서 + 깊이 + 종류" 줄로 읽고, 고친 뒤 Lexical 노드로 다시 짓는다.
 * Lexical 목록은 한 목록 안 항목이 모두 같은 종류라 들여쓰기 · 내어쓰기를 Lexical 에 맡기면 할 일이 글머리 목록에 들어가 글머리가 된다.
 * Notion 은 블록마다 종류가 따로 있고 깊이만 바뀐다 — 그래서 깊이 · 종류를 줄 단위로 다루고 목록은 짓기만 한다.
 * 항목 · 문단 노드는 그대로 옮겨 써서(키 유지) 커서 · 되돌리기가 이어진다
 */

export interface OutlineEntry {
  /** 내용 있는 목록 항목, 또는 범위 바로 아래 블록(문단 · 제목 · 토글 · 이미지 …) */
  node: LexicalNode;
  depth: number;
  /** 목록 항목이면 종류, 아니면 null */
  listType: ListType | null;
  /** 할 일 체크(할 일이 아니어도 전에 할 일이었으면 그 값) */
  checked: boolean;
  /** 목록 첫 항목이었으면 그 목록의 시작 번호 · "a." 표시 */
  start?: number;
  letters?: boolean;
}

/** 블록 깊이 한계 — 0 ~ 4(5단계) */
export const MAX_DEPTH = 4;

/** 중첩 목록만 담은 항목 */
function isHolder(item: ListItemNode): boolean {
  const children = item.getChildren();
  return children.length > 0 && children.every($isListNode);
}

/** 범위 안 블록을 줄로 읽는다 */
export function $readOutline(scope: ElementNode): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  const walkList = (list: ListNode, depth: number) => {
    let first = true;
    for (const child of list.getChildren()) {
      if (!$isListItemNode(child)) continue;
      const nested = child.getChildren().filter($isListNode);
      if (isHolder(child)) {
        nested.forEach((l) => walkList(l, depth + 1));
        continue;
      }
      const type = list.getListType();
      out.push({
        node: child,
        depth,
        listType: type,
        checked: type === "check" ? child.getChecked() === true : $getState(child, wasChecked),
        start: first ? list.getStart() : undefined,
        letters: first ? $getState(list, listLetters) : undefined,
      });
      first = false;
      nested.forEach((l) => walkList(l, depth + 1));
    }
  };
  for (const node of scope.getChildren()) {
    if ($isListNode(node)) walkList(node, 0);
    else out.push({ node, depth: $isElementNode(node) ? node.getIndent() : 0, listType: null, checked: $getState(node, wasChecked) });
  }
  return out;
}

/** 같은 깊이 형제들을 목록으로 짓는다 — 종류가 바뀌면 새 목록, 더 깊은 줄은 "중첩 담는 항목"에 넣는다 */
function buildSiblings(run: OutlineEntry[], from: number, depth: number, items: ListItemNode[]): { lists: ListNode[]; next: number } {
  const lists: ListNode[] = [];
  let i = from;
  while (i < run.length && run[i].depth >= depth) {
    const e = run[i];
    if (e.depth > depth) {
      const inner = buildSiblings(run, i, depth + 1, items);
      let host = lists.at(-1);
      if (!host) {
        host = $createListNode(inner.lists[0].getListType());
        lists.push(host);
      }
      for (const l of inner.lists) {
        const holder = $createListItemNode();
        holder.append(l);
        host.append(holder);
      }
      i = inner.next;
      continue;
    }
    const type = e.listType as ListType;
    let cur = lists.at(-1);
    if (!cur || cur.getListType() !== type) {
      cur = $createListNode(type, type === "number" && e.start ? e.start : 1);
      if (e.letters) $setState(cur, listLetters, true);
      lists.push(cur);
    }
    const item = e.node as ListItemNode;
    cur.append(item);
    if (type === "check") item.setChecked(e.checked);
    else $setState(item, wasChecked, e.checked);
    items.push(item);
    i += 1;
  }
  return { lists, next: i };
}

/** 줄을 범위의 노드로 다시 짓는다 — 커서는 같은 노드 · 자리로 되돌린다 */
export function $writeOutline(scope: ElementNode, entries: OutlineEntry[]): void {
  const selection = $getSelection();
  const saved = $isRangeSelection(selection) ? [selection.anchor, selection.focus].map((p) => ({ key: p.key, offset: p.offset, type: p.type })) : null;

  const seq: LexicalNode[] = [];
  const items: ListItemNode[] = [];
  let i = 0;
  while (i < entries.length) {
    const e = entries[i];
    if (e.listType === null) {
      if ($isElementNode(e.node)) e.node.setIndent(Math.max(0, e.depth));
      seq.push(e.node);
      i += 1;
      continue;
    }
    let j = i;
    while (j < entries.length && entries[j].listType !== null) j += 1;
    // 맨 앞 줄이 더 깊으면(문단의 자식 목록 등) buildSiblings 가 그만큼 겉을 씌운다
    const { lists } = buildSiblings(entries.slice(i, j), 0, 0, items);
    seq.push(...lists);
    i = j;
  }
  // 항목 안에 남은 옛 중첩 목록(이미 항목은 옮겼다)을 치운다
  for (const item of items) for (const child of item.getChildren()) if ($isListNode(child)) child.remove();
  const keep = new Set(seq.map((n) => n.getKey()));
  for (const child of scope.getChildren()) if (!keep.has(child.getKey())) child.remove();
  for (const node of seq) scope.append(node);
  if (scope.getChildrenSize() === 0) scope.append($createParagraphNode());

  if (!saved) return;
  const next = $getSelection();
  if (!$isRangeSelection(next)) return;
  const restore = (point: PointType, s: { key: string; offset: number; type: "text" | "element" }) => {
    const node = $getNodeByKey(s.key);
    if (!node || !node.isAttached()) return false;
    point.set(s.key, s.offset, s.type);
    return true;
  };
  if (!restore(next.anchor, saved[0]) || !restore(next.focus, saved[1])) {
    // 커서 노드가 사라졌으면 첫 번째로 살아 있는 쪽으로
    const alive = saved.map((s) => $getNodeByKey(s.key)).find((n) => n?.isAttached());
    if (alive && $isElementNode(alive)) alive.selectEnd();
  }
}

/** 노드가 든 개요 블록(내용 있는 목록 항목 또는 범위 바로 아래 블록) */
export function $outlineBlockOf(node: LexicalNode): LexicalNode | null {
  let block: LexicalNode | null = node;
  while (block) {
    if ($isListItemNode(block) && !isHolder(block)) return block;
    const parent: LexicalNode | null = block.getParent();
    if (parent && $isRootOrShadowRoot(parent) && !$isListNode(block)) return block;
    block = parent;
  }
  return null;
}

/** 노드가 든 개요 줄 — 범위 · 줄들 · 몇 번째 */
export function $outlineAt(node: LexicalNode): { scope: ElementNode; entries: OutlineEntry[]; index: number } | null {
  const block = $outlineBlockOf(node);
  if (!block) return null;
  let scope: LexicalNode | null = block.getParent();
  while (scope && !$isRootOrShadowRoot(scope)) scope = scope.getParent();
  if (!$isElementNode(scope)) return null;
  const entries = $readOutline(scope);
  const index = entries.findIndex((e) => e.node.is(block));
  return index < 0 ? null : { scope, entries, index };
}

/** i 줄과 그 자식들 끝(다음 형제 · 윗줄 자리) */
export function subtreeEnd(entries: OutlineEntry[], i: number): number {
  let j = i + 1;
  while (j < entries.length && entries[j].depth > entries[i].depth) j += 1;
  return j;
}

/** 바로 앞 형제(같은 깊이) 줄 번호, 없으면 -1 */
export function previousSibling(entries: OutlineEntry[], i: number): number {
  const d = entries[i].depth;
  let k = i - 1;
  while (k >= 0 && entries[k].depth > d) k -= 1;
  return k >= 0 && entries[k].depth === d ? k : -1;
}

/** 뒤에 같은 깊이 형제가 있는지 — 없으면 부모의 마지막 자식 */
export function hasNextSibling(entries: OutlineEntry[], i: number): boolean {
  const j = subtreeEnd(entries, i);
  return j < entries.length && entries[j].depth === entries[i].depth;
}

/** 자식을 가질 수 있는 블록 — 글 블록 · 목록 항목 · 토글(Notion 실측: 제목 · 코드 · 구분선 · 이미지 아래로는 들여 쓸 수 없다) */
function canHaveChildren(node: LexicalNode): boolean {
  return $isElementNode(node) && !node.isInline() && !["heading", "code"].includes(node.getType());
}

/**
 * Tab / Shift+Tab(Notion) — 블록과 그 자식이 함께 한 단계 들어가고 나온다. 종류(할 일 · 글머리 …)는 그대로.
 * 들여쓰기는 바로 앞 형제가 있을 때만(그 형제의 마지막 자식으로). 내어쓰면 뒤 형제들은 이 블록의 자식이 된다.
 * 처리했으면 true(블록이 맨 위라 더 못 내어 써도 true — 다른 처리로 넘기지 않는다)
 */
export function $outlineShift(node: LexicalNode, outdent: boolean, until?: LexicalNode): boolean {
  const at = $outlineAt(node);
  if (!at) return false;
  const { scope, entries, index } = at;
  let last = index;
  if (until) {
    const end = $outlineAt(until);
    if (end && end.scope.is(scope)) last = Math.max(index, end.index);
  }
  const from = Math.min(index, last);
  const to = subtreeEnd(entries, last);
  const d = entries[from].depth;
  if (outdent) {
    if (d === 0) return entries.slice(from, to).some((e) => e.depth > 0) ? shiftRange(scope, entries, from, to, -1) : true;
    return shiftRange(scope, entries, from, to, -1);
  }
  const prev = previousSibling(entries, from);
  if (prev < 0 || !canHaveChildren(entries[prev].node)) return true;
  // 바로 앞 형제가 토글이면 토글 안 마지막으로 들어간다(닫혀 있으면 연다)
  const prevNode = entries[prev].node;
  if ($isToggleContainerNode(prevNode)) return $moveIntoToggle(scope, entries, from, to, prevNode);
  if (entries.slice(from, to).some((e) => e.depth + 1 > MAX_DEPTH)) return true;
  return shiftRange(scope, entries, from, to, 1);
}

/** 내용이 빈 문단 하나뿐인 범위(새 토글) — 그 빈 문단은 버리고 채운다 */
function $contentEntries(content: ElementNode): OutlineEntry[] {
  const only = content.getChildrenSize() === 1 ? content.getFirstChild() : null;
  if ($isElementNode(only) && only.getType() === "paragraph" && only.isEmpty()) return [];
  return $readOutline(content);
}

/** from..to 줄(블록과 자식)을 토글 안 맨 끝으로 — 깊이는 토글 안 맨 위(0)부터 */
function $moveIntoToggle(scope: ElementNode, entries: OutlineEntry[], from: number, to: number, toggle: ToggleContainerNode): boolean {
  const content = toggle.getContent();
  if (!content) return true;
  const base = entries[from].depth;
  const moved = entries.slice(from, to).map((e) => ({ ...e, depth: e.depth - base }));
  $writeOutline(content, [...$contentEntries(content), ...moved]);
  entries.splice(from, to - from);
  $writeOutline(scope, entries);
  toggle.setOpen(true);
  return true;
}

/**
 * 토글 안 맨 위 깊이 블록에서 Shift+Tab(Notion) — 블록과 자식은 토글 바로 뒤(토글 깊이)로 나오고,
 * 그 뒤에 있던 토글 안 블록들은 나온 블록의 자식이 된다
 */
export function $outlineExitToggle(node: LexicalNode): boolean {
  const at = $outlineAt(node);
  if (!at || !$isToggleContentNode(at.scope)) return false;
  const { scope, entries, index } = at;
  if (entries[index].depth !== 0) return false;
  const toggle = scope.getParent();
  if (!$isToggleContainerNode(toggle)) return false;
  const outer = $outlineAt(toggle);
  if (!outer) return false;
  const td = outer.entries[outer.index].depth;
  const end = subtreeEnd(entries, index);
  const moved = [
    ...entries.slice(index, end).map((e) => ({ ...e, depth: e.depth + td })),
    ...entries.slice(end).map((e) => ({ ...e, depth: e.depth + td + 1 })),
  ];
  outer.entries.splice(subtreeEnd(outer.entries, outer.index), 0, ...moved);
  $writeOutline(outer.scope, outer.entries);
  $writeOutline(scope, entries.slice(0, index));
  return true;
}

/**
 * 블록 → 토글(Notion: "> " · Cmd+Opt+7) — 글은 토글 제목으로, 자식은 모두(종류가 섞여도) 토글 안으로. 깊이는 그대로
 */
export function $outlineToToggle(node: LexicalNode): ToggleContainerNode | null {
  const at = $outlineAt(node);
  if (!at) return null;
  const { scope, entries, index } = at;
  const e = entries[index];
  const block = e.node;
  if (!$isElementNode(block)) return null;
  const toggle = $createToggle();
  const title = toggle.getTitle();
  const content = toggle.getContent();
  if (!title || !content) return null;
  title.append(...block.getChildren().filter((c) => !$isListNode(c)));
  const end = subtreeEnd(entries, index);
  const children = entries.slice(index + 1, end).map((c) => ({ ...c, depth: c.depth - e.depth - 1 }));
  // 자식을 먼저 (아직 문서 밖) 토글 안으로 옮긴 뒤 바깥을 다시 짓는다
  if (children.length > 0) $writeOutline(content, children);
  entries.splice(index, end - index, { node: toggle, depth: e.depth, listType: null, checked: e.checked });
  $writeOutline(scope, entries);
  return toggle;
}

function shiftRange(scope: ElementNode, entries: OutlineEntry[], from: number, to: number, delta: number): boolean {
  for (let k = from; k < to; k += 1) entries[k].depth = Math.max(0, entries[k].depth + delta);
  $writeOutline(scope, entries);
  return true;
}

/**
 * 빈 목록 항목에서 Enter(Notion) — 부모의 마지막 자식이면 종류 그대로 한 단계 내어 쓰고, 아니면(뒤에 형제가 있거나 맨 위) 같은 깊이 텍스트로
 */
export function $outlineEmptyItemEnter(item: ListItemNode): boolean {
  const at = $outlineAt(item);
  if (!at) return false;
  const { scope, entries, index } = at;
  const e = entries[index];
  if (e.depth > 0 && !hasNextSibling(entries, index)) {
    for (let k = index; k < subtreeEnd(entries, index); k += 1) entries[k].depth -= 1;
    $writeOutline(scope, entries);
    item.selectStart();
    return true;
  }
  // 토글 안 맨 위 깊이의 마지막 블록이면 종류 그대로 토글 밖으로(Notion)
  if (e.depth === 0 && !hasNextSibling(entries, index) && $isToggleContentNode(scope) && $outlineExitToggle(item)) {
    item.selectStart();
    return true;
  }
  const paragraph = $createParagraphNode();
  entries[index] = { node: paragraph, depth: e.depth, listType: null, checked: e.checked };
  if (e.checked) $setState(paragraph, wasChecked, true);
  $writeOutline(scope, entries);
  paragraph.selectStart();
  return true;
}

/** 목록 항목 → 같은 깊이 블록(문단 등) — 글은 옮기고 자식은 그대로 자식으로 */
export function $outlineItemToBlock(item: ListItemNode, block: ElementNode): boolean {
  const at = $outlineAt(item);
  if (!at) return false;
  const { scope, entries, index } = at;
  const e = entries[index];
  block.append(...item.getChildren().filter((c) => !$isListNode(c)));
  if (e.checked) $setState(block, wasChecked, true);
  entries[index] = { node: block, depth: e.depth, listType: null, checked: e.checked };
  $writeOutline(scope, entries);
  return true;
}

/** 블록 종류만 바꾼다(목록 종류 ↔ 목록 종류) — 깊이 · 자식 · 체크 기억은 그대로 */
export function $outlineSetListType(item: ListItemNode, type: ListType, checked?: boolean): boolean {
  const at = $outlineAt(item);
  if (!at) return false;
  const { scope, entries, index } = at;
  entries[index] = { ...entries[index], listType: type, checked: checked ?? entries[index].checked, start: undefined, letters: undefined };
  $writeOutline(scope, entries);
  return true;
}

/** 블록(문단 · 제목) → 목록 항목, 같은 깊이 */
export function $outlineBlockToItem(block: ElementNode, type: ListType, checked?: boolean): ListItemNode | null {
  const at = $outlineAt(block);
  if (!at) return null;
  const { scope, entries, index } = at;
  const e = entries[index];
  const item = $createListItemNode();
  item.append(...block.getChildren());
  entries[index] = { node: item, depth: e.depth, listType: type, checked: checked ?? e.checked };
  $writeOutline(scope, entries);
  item.selectEnd();
  return item;
}

/**
 * 글 블록 맨 앞 Backspace(Notion) — 깊이가 있고 부모의 마지막 자식이면 한 단계 내어 쓴다.
 * 아니면 바로 위 줄과 합치고, 이 블록의 자식은 한 단계 올라온다. 위 줄이 글을 받을 수 없으면 false
 */
export function $outlineBackspaceBlock(block: ElementNode): boolean {
  const at = $outlineAt(block);
  if (!at) return false;
  const { scope, entries, index } = at;
  const e = entries[index];
  const end = subtreeEnd(entries, index);
  if (e.depth > 0 && !hasNextSibling(entries, index)) {
    for (let k = index; k < end; k += 1) entries[k].depth -= 1;
    $writeOutline(scope, entries);
    block.selectStart();
    return true;
  }
  // 토글 안 첫 블록이면 토글 제목 끝에 붙인다(Notion — 빈 줄을 남기지 않는다)
  const host = scope.getParent();
  let target: LexicalNode | null = index > 0 ? entries[index - 1].node : $isToggleContentNode(scope) && $isToggleContainerNode(host) ? host.getTitle() : null;
  // 바로 위가 펼친 토글이면 그 안 마지막 줄과 합친다(화면에서 바로 위 줄)
  while ($isToggleContainerNode(target) && target.getOpen()) {
    const content = target.getContent();
    const inner = content ? $readOutline(content) : [];
    target = inner.length > 0 ? inner[inner.length - 1].node : target.getTitle();
  }
  if (!$isElementNode(target) || target.isInline() || $isListNode(target)) return false;
  // 글을 받을 수 있는 블록만(목록 항목 · 문단 · 제목 · 인용 · 토글 제목) — 꾸밈 블록이나 토글 · 콜아웃은 기본 처리로
  if (!$isListItemNode(target) && !["paragraph", "heading", "quote", "toggle-title"].includes(target.getType())) return false;
  for (let k = index + 1; k < end; k += 1) entries[k].depth = Math.max(0, entries[k].depth - 1);
  const joint = target.getLastDescendant();
  const size = target.getChildrenSize();
  target.append(...block.getChildren());
  entries.splice(index, 1);
  $writeOutline(scope, entries);
  if ($isTextNode(joint) && joint.isAttached()) joint.select(joint.getTextContentSize(), joint.getTextContentSize());
  else target.select(size, size);
  return true;
}
