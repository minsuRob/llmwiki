import { $createListItemNode, $createListNode, $isListItemNode, $isListNode, type ListNode } from "@lexical/list";
import { $isElementNode, type ElementNode, type LexicalNode } from "lexical";

/**
 * 목록을 levels 단계 더 깊게 — 바깥에 "중첩 담는 항목"을 levels 겹 씌운다.
 * Lexical 목록은 들여쓰기 값이 아니라 중첩으로 깊이를 나타내서, 목록째 깊이를 옮길 때 쓴다
 */
export function $nestList(list: ListNode, levels: number): ListNode {
  let out = list;
  for (let i = 0; i < levels; i += 1) {
    const holder = $createListItemNode();
    const wrapper = $createListNode(out.getListType());
    holder.append(out);
    wrapper.append(holder);
    out = wrapper;
  }
  return out;
}

/** 블록을 levels 단계 더 들여 쓴다 — 목록은 중첩으로, 그 밖의 블록은 들여쓰기 값으로(이미지 같은 꾸밈 노드는 그대로) */
export function $indentBlockBy(node: LexicalNode, levels: number): LexicalNode {
  if (levels <= 0) return node;
  if ($isListNode(node)) {
    const placeholder = $createListNode(node.getListType());
    node.replace(placeholder);
    const nested = $nestList(node, levels);
    placeholder.replace(nested);
    return nested;
  }
  if ($isElementNode(node)) node.setIndent(node.getIndent() + levels);
  return node;
}

/** "중첩 담는 항목"만으로 감싼 목록 겹 수 — $nestList 로 들여 쓴 목록의 깊이 */
export function $listWrapDepth(list: ListNode): number {
  let depth = 0;
  let current: ListNode = list;
  for (;;) {
    const first = current.getFirstChild();
    if (current.getChildrenSize() !== 1 || !$isListItemNode(first) || first.getChildrenSize() !== 1 || !$isListNode(first.getFirstChild())) return depth;
    current = first.getFirstChild() as ListNode;
    depth += 1;
  }
}

/** 블록 깊이(Notion 기준) — 문단 · 제목 등은 들여쓰기 값, 목록은 감싼 겹 수(맨 위 목록 = 0) */
export function $blockDepth(node: LexicalNode): number {
  if ($isListNode(node)) return $listWrapDepth(node);
  return $isElementNode(node) ? node.getIndent() : 0;
}

/** 블록을 한 단계 내어 쓴다 — 목록은 바깥 감싼 겹 하나를 벗기고, 그 밖의 블록은 들여쓰기 값을 줄인다 */
export function $outdentBlockOnce(node: LexicalNode): void {
  if ($isListNode(node)) {
    if ($listWrapDepth(node) === 0) return;
    const inner = (node.getFirstChild() as ElementNode).getFirstChild() as ListNode;
    node.replace(inner);
    return;
  }
  if ($isElementNode(node) && node.getIndent() > 0) node.setIndent(node.getIndent() - 1);
}
