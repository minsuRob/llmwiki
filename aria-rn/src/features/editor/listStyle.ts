import { $isListItemNode, $isListNode, type ListItemNode, type ListNode } from "@lexical/list";
import { $dfs } from "@lexical/utils";
import { $getState, createState, type LexicalEditor } from "lexical";

/** "a. " 로 만든 목록 — 번호 대신 a. b. c. 로 센다(Notion 과 같다) */
export const listLetters = createState("lexListLetters", { parse: (v) => v === true });

const BULLETS = ["•", "◦", "▪"];
const NUMBERS: ((n: number) => string)[] = [String, toLetters, toRoman];
const ATTR = "data-lex-marker";

function toLetters(n: number): string {
  let out = "";
  for (let v = n; v > 0; v = Math.floor((v - 1) / 26)) out = String.fromCharCode(97 + ((v - 1) % 26)) + out;
  return out;
}

function toRoman(n: number): string {
  const table: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  let v = n;
  for (const [k, r] of table) for (; v >= k; v -= k) out += r;
  return out;
}

/** 목록을 담은 "중첩 담는 항목" 바로 앞의 내용 항목(부모 항목) — 다른 종류 자식 목록을 담는 항목은 건너뛴다 */
function $parentItem(list: ListNode): ListItemNode | null {
  const holder = list.getParent();
  if (!$isListItemNode(holder)) return null;
  for (let prev = holder.getPreviousSibling(); prev; prev = prev.getPreviousSibling()) {
    if (!$isListItemNode(prev)) return null;
    if (!prev.getChildren().some($isListNode)) return prev;
  }
  return null;
}

/** 같은 깊이 바로 앞 블록이 목록이면 그 목록 */
function $previousList(list: ListNode): ListNode | null {
  const holder = list.getParent();
  const prev = ($isListItemNode(holder) ? holder : list).getPreviousSibling();
  if ($isListNode(prev)) return prev;
  if ($isListItemNode(prev) && prev.getChildrenSize() === 1 && $isListNode(prev.getFirstChild())) return prev.getFirstChild() as ListNode;
  return null;
}

/**
 * 기호 · 번호 모양 순번(Notion 실측) — 부모 항목이 같은 종류일 때만 한 칸 넘어간다(글머리 아래 할 일 아래 글머리는 다시 •).
 * 번호는 같은 깊이 바로 앞이 다른 종류 목록이면 다시 1. 부터(번호 · 모양 모두)
 */
function $styleIndex(list: ListNode, cache: Map<string, number>): number {
  const key = list.getKey();
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let index = 0;
  const type = list.getListType();
  const prev = type === "number" ? $previousList(list) : null;
  if (prev && prev.getListType() === type) index = $styleIndex(prev, cache);
  else if (!prev) {
    const parent = $parentItem(list)?.getParent();
    if ($isListNode(parent) && parent.getListType() === type) index = $styleIndex(parent, cache) + 1;
  }
  cache.set(key, index);
  return index;
}

/**
 * 목록 기호 · 번호 — 항목마다 data-lex-marker 로 달고 CSS 가 24px 칸 가운데 그린다(Notion 과 같은 자리).
 * 부모 항목이 같은 종류면 • ◦ ▪ / 1. a. i. 로 넘어간다(할 일 아래 번호 목록은 다시 1.). "a. " 목록은 a. b. c.
 */
export function registerListStyles(editor: LexicalEditor): () => void {
  return editor.registerUpdateListener(({ editorState }) => {
    editorState.read(() => {
      const cache = new Map<string, number>();
      for (const { node } of $dfs()) {
        if (!$isListItemNode(node)) continue;
        const element = editor.getElementByKey(node.getKey());
        const list = node.getParent();
        if (!element || !$isListNode(list)) continue;
        const holder = node.getChildren().some($isListNode);
        let marker: string | null = null;
        if (!holder && list.getListType() === "bullet") marker = BULLETS[$styleIndex(list, cache) % BULLETS.length];
        if (!holder && list.getListType() === "number") {
          const format = $getState(list, listLetters) ? toLetters : NUMBERS[$styleIndex(list, cache) % NUMBERS.length];
          marker = `${format(node.getValue())}.`;
        }
        if (marker === null) element.removeAttribute(ATTR);
        else if (element.getAttribute(ATTR) !== marker) element.setAttribute(ATTR, marker);
      }
    });
  });
}
