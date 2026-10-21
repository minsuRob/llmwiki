import { $isListItemNode, $isListNode } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import { $getRoot, $getSelection, $isElementNode, $isParagraphNode, $isRangeSelection, type ElementNode, type LexicalNode } from "lexical";
import { useEffect } from "react";

import { $isCalloutNode } from "./CalloutExtension";
import { $isToggleContainerNode, $isToggleContentNode, $isToggleTitleNode } from "./ToggleExtension";

const ATTR = "data-lex-placeholder";

/** 빈 블록에 보일 안내 — 제목 · 목록 · 할 일 · 토글 · 인용 · 콜아웃 안은 늘, 문단은 커서가 있을 때만(Notion 과 같다) */
function placeholderOf(node: ElementNode, focused: boolean): string | null {
  if ($isToggleTitleNode(node)) return "토글";
  // 콜아웃 안 빈 줄은 Notion 처럼 늘 안내
  if ($isParagraphNode(node) && $isCalloutNode(node.getParent())) return "내용 쓰기";
  if ($isHeadingNode(node)) return { h1: "제목 1", h2: "제목 2", h3: "제목 3", h4: "제목 4" }[node.getTag() as "h1" | "h2" | "h3" | "h4"] ?? null;
  if ($isListItemNode(node)) {
    const list = node.getParent();
    return $isListNode(list) && list.getListType() === "check" ? "할 일" : "목록";
  }
  if ($isQuoteNode(node)) return "빈 인용";
  if ($isParagraphNode(node) && focused) return "'/'를 눌러 블록 고르기";
  return null;
}

/** 내용 · 커서가 바뀔 때마다 빈 블록 DOM 에 안내 문구를 단다(CSS ::before 가 그린다) */
export default function PlaceholderPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        const marks = new Map<string, string>();
        editorState.read(() => {
          const root = $getRoot();
          // 문서 전체가 빈 문단 하나면 편집기 자체 안내(ContentEditable placeholder)에 맡긴다
          if (root.getChildrenSize() === 1 && root.getTextContentSize() === 0 && $isParagraphNode(root.getFirstChild())) return;
          const selection = $getSelection();
          const focusedKey = $isRangeSelection(selection) && selection.isCollapsed() ? blockKey(selection.anchor.getNode()) : null;
          const visit = (node: LexicalNode) => {
            if (!$isElementNode(node)) return;
            // 목록 · 토글 · 콜아웃은 안쪽 블록까지 내려가 본다
            if ($isListNode(node) || $isToggleContainerNode(node) || $isToggleContentNode(node) || $isCalloutNode(node)) return node.getChildren().forEach(visit);
            if ($isListItemNode(node) && node.getChildren().some($isListNode)) return node.getChildren().forEach(visit);
            if (node.getTextContentSize() === 0 && node.getChildrenSize() === 0) {
              const text = placeholderOf(node, node.getKey() === focusedKey);
              if (text) marks.set(node.getKey(), text);
            }
          };
          root.getChildren().forEach(visit);
        });
        const rootEl = editor.getRootElement();
        rootEl?.querySelectorAll(`[${ATTR}]`).forEach((el) => {
          if (![...marks.keys()].some((k) => editor.getElementByKey(k) === el)) el.removeAttribute(ATTR);
        });
        marks.forEach((text, key) => editor.getElementByKey(key)?.setAttribute(ATTR, text));
      }),
    [editor],
  );
  return null;
}

/** 커서가 든 가장 가까운 블록(목록 항목 · 문단 · 제목 · 인용)의 키 */
function blockKey(node: LexicalNode): string | null {
  let cur: LexicalNode | null = node;
  while (cur) {
    if ($isElementNode(cur) && !cur.isInline() && !$isListNode(cur)) return cur.getKey();
    cur = cur.getParent();
  }
  return null;
}
