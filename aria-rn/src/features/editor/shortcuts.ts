import { $isListItemNode, $isListNode, type ListItemNode } from "@lexical/list";
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import { mergeRegister } from "@lexical/utils";
import {
  $copyNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $createParagraphNode,
  COMMAND_PRIORITY_NORMAL,
  FORMAT_TEXT_COMMAND,
  IS_APPLE,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";

import { applyBlock, type BlockKind } from "./blocks";
import { TOGGLE_OPEN_COMMAND } from "./ToggleExtension";

/** Cmd(Mac) · Ctrl(그 밖) */
function isMod(e: KeyboardEvent): boolean {
  return IS_APPLE ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/** Cmd+Opt+숫자 → 블록 바꾸기(Notion 과 같은 번호). Opt 를 누르면 key 가 바뀌니 code(Digit0…)로 본다 */
const TURN_INTO: Record<string, BlockKind> = {
  Digit0: "paragraph",
  Digit1: "h1",
  Digit2: "h2",
  Digit3: "h3",
  Digit4: "check",
  Digit5: "bullet",
  Digit6: "number",
  Digit7: "toggle",
  Digit8: "code",
};

/** 커서가 든 블록 — 목록이면 항목, 아니면 맨 위 블록 */
function $currentBlock(): LexicalNode | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  let node: LexicalNode | null = selection.anchor.getNode();
  while (node) {
    if ($isListItemNode(node)) return node;
    const parent: LexicalNode | null = node.getParent();
    if (parent && $isRootOrShadowRoot(parent)) return node;
    node = parent;
  }
  return null;
}

/** 블록을 자식까지 통째로 복사한다(새 키) */
function $deepCopy<T extends LexicalNode>(node: T): T {
  const copy = $copyNode(node);
  if ($isElementNode(node) && $isElementNode(copy)) {
    copy.append(...node.getChildren().map($deepCopy));
  }
  return copy;
}

/** 같은 깊이의 바로 위 · 아래 형제와 자리를 바꾼다 */
function $moveBlock(block: LexicalNode, dir: -1 | 1): boolean {
  const sibling = dir < 0 ? block.getPreviousSibling() : block.getNextSibling();
  if (!sibling) return false;
  if (dir < 0) sibling.insertBefore(block);
  else sibling.insertAfter(block);
  return true;
}

/**
 * Notion 식 블록 단축키
 * - Cmd+Opt+0~8: 블록 바꾸기(0 텍스트 · 1~3 제목 · 4 할 일 · 5 글머리 · 6 번호 · 7 토글 · 8 코드), Cmd+Shift+0: 텍스트
 * - Cmd+Enter: 할 일 체크 켜고 끄기 · 토글 펼치고 접기
 * - Cmd+D: 블록 복제
 * - Cmd+Shift+↑/↓: 블록 위 · 아래로 옮기기
 * - Cmd+Shift+X: 취소선(Cmd+Shift+S 와 같다)
 * - 빈 제목 · 빈 인용에서 Enter: 문단으로 바꾼다(새 줄을 만들지 않는다)
 */
export function registerBlockShortcuts(editor: LexicalEditor): () => void {
  return mergeRegister(
    editor.registerCommand(
      KEY_DOWN_COMMAND,
      (e) => {
        if (!isMod(e)) return false;

        // Cmd+Shift+0 도 텍스트로(Notion 에서 확인)
        if (!e.altKey && e.shiftKey && e.code === "Digit0") {
          e.preventDefault();
          applyBlock(editor, "paragraph");
          return true;
        }

        if (e.altKey && !e.shiftKey && TURN_INTO[e.code]) {
          e.preventDefault();
          applyBlock(editor, TURN_INTO[e.code]);
          return true;
        }

        if (!e.altKey && !e.shiftKey && e.key === "Enter") {
          let handled = false;
          editor.update(() => {
            const block = $currentBlock();
            const list = block?.getParent();
            if ($isListItemNode(block) && $isListNode(list) && list.getListType() === "check") {
              (block as ListItemNode).toggleChecked();
              handled = true;
            }
          });
          if (!handled) handled = editor.dispatchCommand(TOGGLE_OPEN_COMMAND, undefined);
          if (handled) e.preventDefault();
          return handled;
        }

        if (!e.altKey && e.shiftKey && e.code === "KeyX") {
          e.preventDefault();
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");
          return true;
        }

        if (!e.altKey && !e.shiftKey && e.key.toLowerCase() === "d") {
          e.preventDefault();
          editor.update(() => {
            const block = $currentBlock();
            if (block) block.insertAfter($deepCopy(block));
          });
          return true;
        }

        if (!e.altKey && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          editor.update(() => {
            const block = $currentBlock();
            if (block) $moveBlock(block, e.key === "ArrowUp" ? -1 : 1);
          });
          return true;
        }

        return false;
      },
      COMMAND_PRIORITY_NORMAL,
    ),
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      (e) => {
        if (e?.shiftKey) return false;
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
        const block = selection.anchor.getNode().getTopLevelElement();
        if (!($isHeadingNode(block) || $isQuoteNode(block)) || block.getTextContentSize() > 0) return false;
        e?.preventDefault();
        const paragraph = $createParagraphNode();
        block.replace(paragraph);
        paragraph.select();
        return true;
      },
      COMMAND_PRIORITY_NORMAL,
    ),
  );
}
