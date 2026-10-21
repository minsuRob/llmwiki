import { $createListItemNode, $createListNode, $isListItemNode, $isListNode, type ListItemNode, type ListNode, type ListType } from "@lexical/list";
import { $findMatchingParent, $getSelection, $getState, $isRangeSelection, $setState, createState, type ElementNode, type LexicalNode } from "lexical";

/**
 * 할 일이 아니게 된 항목의 체크 값 — Lexical 은 할 일이 아닌 목록에서 체크 값을 지우니 따로 담아 둔다.
 * 다시 할 일로 바꾸면 되살린다
 */
const wasChecked = createState("lexWasChecked", { parse: (v) => v === true });

/** 커서가 든 목록 항목(중첩 목록을 담기만 하는 빈 항목은 건너뛴다) */
export function $selectedListItem(): ListItemNode | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  return $findMatchingParent(selection.anchor.getNode(), (n) => $isListItemNode(n) && !$isListNode(n.getFirstChild())) as ListItemNode | null;
}

/**
 * 목록 항목 하나만 다른 종류(글머리 · 번호 · 할 일)로 바꾼다 — Notion 처럼 그 블록만 바뀌고 앞뒤 항목은 그대로.
 * Lexical 목록은 한 목록 안 항목이 모두 같은 종류라, 목록을 [앞 | 이 항목 | 뒤] 셋으로 나눈다.
 * 중첩 목록이면 각 조각을 바깥 목록의 "중첩 담는 항목"에 하나씩 담아 깊이를 지킨다
 */
export function $setListItemType(item: ListItemNode, type: ListType, checked?: boolean): void {
  const list = item.getParent();
  if (!$isListNode(list)) return;
  // 체크 값은 "[] " · "[x] " 처럼 정해 줄 때만 바꾼다 — 할 일 → 글머리 → 할 일로 돌아와도 체크가 남는다(Notion 과 같다)
  if (list.getListType() === "check" && type !== "check") $setState(item, wasChecked, item.getChecked() === true);
  const applyChecked = () => {
    if (type !== "check") return;
    item.setChecked(checked ?? $getState(item, wasChecked));
  };
  if (list.getListType() === type) {
    if (checked !== undefined) item.setChecked(checked);
    return;
  }
  // 하나뿐이면 목록 종류만 바꾸면 된다
  if (list.getChildrenSize() === 1) {
    list.setListType(type);
    applyChecked();
    $mergeWithNeighbours(list);
    return;
  }
  const host = list.getParent();
  const nested = $isListItemNode(host);
  const wrap = (l: ListNode): LexicalNode => {
    if (!nested) return l;
    const holder = $createListItemNode();
    holder.append(l);
    return holder;
  };
  const following = item.getNextSiblings();
  const mid = $createListNode(type);
  mid.append(item);
  applyChecked();
  let anchor: LexicalNode = nested ? (host as ListItemNode) : list;
  const midNode = wrap(mid);
  anchor.insertAfter(midNode);
  anchor = midNode;
  if (following.length > 0) {
    const rest = $createListNode(list.getListType());
    rest.append(...following);
    anchor.insertAfter(wrap(rest));
  }
  // 이 항목이 맨 앞이었으면 원래 목록은 비었다 — 지운다
  if (list.getChildrenSize() === 0) {
    if (nested && (host as ListItemNode).getChildrenSize() === 1) (host as ListItemNode).remove();
    else list.remove();
  }
  $mergeWithNeighbours(mid);
}

/**
 * 목록 항목 하나를 목록 밖 블록(문단 · 제목 · 인용 · 코드)으로 바꾼다 — 앞뒤 항목은 제자리 · 제 깊이에 남는다.
 * 안쪽 목록부터 바깥으로 올라가며 "이 항목 뒤"를 같은 모양의 새 목록으로 떼어 내고, 그 사이에 블록을 넣는다.
 * 블록은 원래 깊이만큼 들여 쓴다
 */
export function $listItemToBlock(item: ListItemNode, block: ElementNode): void {
  const depth = item.getIndent();
  // 안쪽 → 바깥 목록과, 각 목록 안에서 이 항목(또는 이 항목을 품은 중첩 항목)의 위치
  const levels: { list: ListNode; at: LexicalNode }[] = [];
  let at: LexicalNode = item;
  while ($isListNode(at.getParent())) {
    const list = at.getParent() as ListNode;
    levels.push({ list, at });
    const holder = list.getParent();
    if (!$isListItemNode(holder)) break;
    at = holder;
  }
  if (levels.length === 0) return;
  // 뒤쪽 조각 — 안쪽부터 만들어 한 단계 바깥 조각의 첫 항목(중첩 담는 항목)으로 넣는다
  let tail: ListNode | null = null;
  for (const { list, at: node } of levels) {
    const following = node.getNextSiblings();
    const children: LexicalNode[] = [];
    if (tail) {
      const holder = $createListItemNode();
      holder.append(tail);
      children.push(holder);
    }
    children.push(...following);
    tail = null;
    if (children.length > 0) {
      tail = $createListNode(list.getListType());
      tail.append(...children);
    }
  }
  const top = levels[levels.length - 1].list;
  const wasEmpty = item.getChildrenSize() === 0;
  // 먼저 블록 · 뒤 조각을 제자리에 넣고 나서 항목을 지운다 — 항목이 마지막이면 Lexical 이 빈 목록까지 지워
  // 그 뒤에는 목록 옆에 넣을 수 없다(전에는 여기서 오류가 났다)
  top.insertAfter(block);
  if (tail) block.insertAfter(tail);
  const holders = levels.map(({ list }) => list.getParent());
  block.append(...item.getChildren());
  item.remove();
  // 비어 버린 목록 · 중첩 담는 항목을 안쪽부터 치운다(Lexical 이 목록만 지우고 빈 담는 항목을 남길 수 있다)
  levels.forEach(({ list }, i) => {
    if (list.isAttached() && list.getChildrenSize() === 0) list.remove();
    const holder = holders[i];
    if ($isListItemNode(holder) && holder.isAttached() && holder.getChildrenSize() === 0) holder.remove();
  });
  if (depth > 0) block.setIndent(depth);
  if (wasEmpty) block.selectStart();
}

/** 바로 앞 · 뒤에 같은 종류 목록이 있으면 하나로 합친다(번호가 1 부터 다시 시작하지 않게) — 중첩이면 담는 항목째로 본다 */
function $mergeWithNeighbours(list: ListNode): void {
  const host = list.getParent();
  const nested = $isListItemNode(host);
  const containerOf = (l: ListNode): LexicalNode => (nested ? (l.getParent() as LexicalNode) : l);
  const listIn = (n: LexicalNode | null): ListNode | null => {
    if (!n) return null;
    if (nested) return $isListItemNode(n) && n.getChildrenSize() === 1 && $isListNode(n.getFirstChild()) ? (n.getFirstChild() as ListNode) : null;
    return $isListNode(n) ? n : null;
  };
  let current = list;
  const prev = listIn(containerOf(current).getPreviousSibling());
  if (prev && prev.getListType() === current.getListType()) {
    prev.append(...current.getChildren());
    containerOf(current).remove();
    current = prev;
  }
  const next = listIn(containerOf(current).getNextSibling());
  if (next && next.getListType() === current.getListType()) {
    current.append(...next.getChildren());
    containerOf(next).remove();
  }
}
