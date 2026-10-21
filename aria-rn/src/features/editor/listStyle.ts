import { $isListItemNode, $isListNode, type ListNode } from "@lexical/list";
import { $dfs } from "@lexical/utils";
import { $getState, createState, type LexicalEditor } from "lexical";

/** "a. " 로 만든 목록 — 번호 대신 a. b. c. 로 센다(Notion 과 같다) */
export const listLetters = createState("lexListLetters", { parse: (v) => v === true });

const BULLETS = ["disc", "circle", "square"];
const NUMBERS = ["decimal", "lower-alpha", "lower-roman"];

/** 같은 종류 목록 조상 수(자기 포함) — Notion 은 기호 · 번호 모양을 전체 깊이가 아니라 이 수로 돌린다 */
function $sameTypeDepth(list: ListNode): number {
  let depth = 1;
  let parent = list.getParent();
  while ($isListItemNode(parent)) {
    const outer = parent.getParent();
    if (!$isListNode(outer)) break;
    if (outer.getListType() === list.getListType()) depth += 1;
    parent = outer.getParent();
  }
  return depth;
}

/**
 * 목록 기호 · 번호 모양 — 같은 종류 목록 깊이로 • ◦ ▪ / 1. a. i. 를 돈다(할 일 아래 번호 목록은 다시 1.).
 * "a. " 목록은 a. b. c. 로. Lexical 테마 클래스는 전체 깊이로 정해져 인라인 스타일로 덮는다
 */
export function registerListStyles(editor: LexicalEditor): () => void {
  return editor.registerUpdateListener(({ editorState }) => {
    editorState.read(() => {
      for (const { node } of $dfs()) {
        if (!$isListNode(node) || node.getListType() === "check") continue;
        const element = editor.getElementByKey(node.getKey());
        if (!element) continue;
        const cycle = node.getListType() === "bullet" ? BULLETS : NUMBERS;
        const style = $getState(node, listLetters) ? "lower-alpha" : cycle[($sameTypeDepth(node) - 1) % cycle.length];
        if (element.style.listStyleType !== style) element.style.listStyleType = style;
      }
    });
  });
}
