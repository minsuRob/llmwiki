import { $createListItemNode, $createListNode, $isListItemNode, $isListNode, type ListItemNode, type ListNode, type ListType } from "@lexical/list";
import { $findMatchingParent, $getSelection, $isRangeSelection, type ElementNode, type LexicalNode } from "lexical";

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
export function $setListItemType(item: ListItemNode, type: ListType, checked = false): void {
  const list = item.getParent();
  if (!$isListNode(list)) return;
  if (list.getListType() === type) {
    if (type === "check") item.setChecked(checked);
    return;
  }
  // 하나뿐이면 목록 종류만 바꾸면 된다
  if (list.getChildrenSize() === 1) {
    list.setListType(type);
    item.setChecked(type === "check" ? checked : undefined);
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
  item.setChecked(type === "check" ? checked : undefined);
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
}

/**
 * 목록 항목 하나를 목록 밖 블록(문단 · 제목 · 인용 · 코드)으로 바꾼다 — 앞뒤 항목은 목록으로 남는다.
 * 중첩 항목이면 맨 바깥으로 꺼낸 뒤 원래 깊이만큼 들여 써서 자리를 지킨다
 */
export function $listItemToBlock(item: ListItemNode, block: ElementNode): void {
  const depth = item.getIndent();
  if (depth > 0) item.setIndent(0);
  const list = item.getParent();
  if (!$isListNode(list)) return;
  const following = item.getNextSiblings();
  const wasEmpty = item.getChildrenSize() === 0;
  block.append(...item.getChildren());
  list.insertAfter(block);
  if (following.length > 0) {
    const rest = $createListNode(list.getListType());
    rest.append(...following);
    block.insertAfter(rest);
  }
  item.remove();
  if (list.getChildrenSize() === 0) list.remove();
  if (depth > 0) block.setIndent(depth);
  if (wasEmpty) block.selectStart();
}
