import { $createListItemNode, $createListNode, $isListNode, type ListNode } from "@lexical/list";
import { $isElementNode, type LexicalNode } from "lexical";

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
