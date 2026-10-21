import { $isCodeNode } from "@lexical/code-core";
import { $createListItemNode, $isListItemNode, $isListNode, type ListItemNode } from "@lexical/list";
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import { mergeRegister } from "@lexical/utils";
import {
  $copyNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $createParagraphNode,
  $findMatchingParent,
  $isParagraphNode,
  $isRootNode,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_NORMAL,
  INSERT_LINE_BREAK_COMMAND,
  FORMAT_TEXT_COMMAND,
  INDENT_CONTENT_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  INSERT_TAB_COMMAND,
  IS_APPLE,
  KEY_ARROW_DOWN_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";

import { applyBlock, type BlockKind } from "./blocks";
import { $listItemToBlock, $selectedListItem } from "./listItems";
import { $outlineBackspaceBlock, $outlineDuplicate, $outlineEmptyItemEnter, $outlineExitToggle, $outlineItemToBlock, $outlineMove, $outlineShift } from "./outline";
import { $isToggleContainerNode, $isToggleTitleNode, $unwrapToggle, TOGGLE_OPEN_COMMAND } from "./ToggleExtension";

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
 * - Tab / Shift+Tab: 블록과 자식을 함께 들이고 내어 쓴다 — 종류는 그대로(코드 안은 탭 문자) · 앞 형제가 토글이면 그 안으로, 토글 안 맨 위면 밖으로
 * - Enter 로 만든 새 문단: 서식 없이 시작, 들여쓰기 깊이는 이어 간다
 * - 목록 항목 맨 앞 Backspace: 같은 깊이의 텍스트로. 텍스트 맨 앞 Backspace: 마지막 자식이면 내어 쓰고, 아니면 위와 합치며 자식은 한 단계 올린다(Notion)
 * - 빈 목록 항목 Enter: 마지막 자식이면 종류 그대로 내어 쓰고, 아니면 텍스트로 · 글 있는 항목 맨 앞 Enter: 위에 같은 종류 · 같은 체크의 빈 항목
 * - 맨 끝 코드 블록의 끝에서 ↓: 아래에 새 문단을 만들어 빠져나간다
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

        // 명령 처리기는 이미 편집(update) 안에서 돈다 — 여기서 editor.update 를 또 부르면 뒤로 밀려
        // 처리했는지 알 수 없고 Enter 기본 동작까지 같이 돈다. $ 함수로 바로 고친다
        if (!e.altKey && !e.shiftKey && e.key === "Enter") {
          const block = $currentBlock();
          const list = block?.getParent();
          let handled = false;
          if ($isListItemNode(block) && $isListNode(list) && list.getListType() === "check") {
            (block as ListItemNode).toggleChecked();
            handled = true;
          } else {
            handled = editor.dispatchCommand(TOGGLE_OPEN_COMMAND, undefined);
          }
          if (handled) e.preventDefault();
          return handled;
        }

        if (!e.altKey && e.shiftKey && (e.code === "KeyX" || e.key.toLowerCase() === "x")) {
          e.preventDefault();
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");
          return true;
        }

        if (!e.altKey && !e.shiftKey && e.key.toLowerCase() === "d") {
          e.preventDefault();
          const selection = $getSelection();
          const anchor = $isRangeSelection(selection) ? selection.anchor.getNode() : null;
          // 자식까지 통째로 바로 뒤에, 커서는 복사본으로(Notion)
          if (anchor && !$outlineDuplicate(anchor)) {
            const block = $currentBlock();
            if (block) {
              const copy = $deepCopy(block);
              block.insertAfter(copy);
              if ($isElementNode(copy)) copy.selectEnd();
            }
          }
          return true;
        }

        if (!e.altKey && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          const selection = $getSelection();
          const anchor = $isRangeSelection(selection) ? selection.anchor.getNode() : null;
          const dir = e.key === "ArrowUp" ? -1 : 1;
          // 자식과 함께 한 줄씩(Notion) — 개요 밖 블록은 형제끼리만
          if (anchor && !$outlineMove(anchor, dir)) {
            const block = $currentBlock();
            if (block) $moveBlock(block, dir);
          }
          return true;
        }

        return false;
      },
      COMMAND_PRIORITY_NORMAL,
    ),
    editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (e) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.offset !== 0) return false;
        const anchor = selection.anchor.getNode();
        // 토글 제목 맨 앞: 토글을 푼다(제목은 같은 깊이 텍스트, 내용은 그 아래 한 단계 더) — 들여 쓴 토글도 위와 합치지 않게 직접 처리
        const title = $findMatchingParent(anchor, $isToggleTitleNode);
        if ($isToggleTitleNode(title) && (anchor.is(title) || title.getFirstDescendant()?.is(anchor) === true)) {
          const container = title.getParent();
          if (!$isToggleContainerNode(container)) return false;
          e.preventDefault();
          $unwrapToggle(container)?.selectStart();
          return true;
        }
        const item = $selectedListItem();
        if (item) {
          if (!(anchor.is(item) || item.getFirstDescendant()?.is(anchor) === true)) return false;
          e.preventDefault();
          // 같은 깊이 텍스트로 — 자식은 그대로 이 텍스트의 자식(Notion)
          const paragraph = $createParagraphNode();
          if ($outlineItemToBlock(item, paragraph)) paragraph.selectStart();
          else $listItemToBlock(item, $createParagraphNode());
          return true;
        }
        const block = anchor.getTopLevelElement();
        if (!$isElementNode(block) || !(anchor.is(block) || block.getFirstDescendant()?.is(anchor) === true)) return false;
        // 인용 맨 앞: 위와 합치지 않고 먼저 텍스트로(Notion 과 같다)
        if ($isQuoteNode(block)) {
          e.preventDefault();
          const paragraph = $createParagraphNode();
          paragraph.append(...block.getChildren());
          block.replace(paragraph);
          paragraph.selectStart();
          return true;
        }
        const prev = block.getPreviousSibling();
        // 닫힌 토글 바로 아래: 숨은 내용으로 들어가지 않게 토글 제목 끝으로
        if ($isToggleContainerNode(prev) && !prev.getOpen()) {
          const title = prev.getTitle();
          if (!title) return false;
          e.preventDefault();
          const empty = block.getTextContentSize() === 0;
          const offset = title.getTextContentSize();
          if (!empty) title.append(...block.getChildren());
          block.remove();
          if (empty) title.selectEnd();
          else title.select(offset, offset);
          return true;
        }
        // 문단 · 제목 맨 앞(Notion): 깊이가 있고 부모의 마지막 자식이면 한 단계 내어 쓰고, 아니면 바로 위 줄과 합친다.
        // 합칠 때 이 블록의 자식은 한 단계 올라온다
        if (!($isParagraphNode(block) || $isHeadingNode(block))) return false;
        if (!$outlineBackspaceBlock(block)) return false;
        e.preventDefault();
        return true;
      },
      COMMAND_PRIORITY_NORMAL,
    ),
    editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (e) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed() || e.shiftKey) return false;
        const anchor = selection.anchor.getNode();
        const code = $findMatchingParent(anchor, $isCodeNode);
        if (!$isCodeNode(code) || code.getNextSibling() || !$isRootNode(code.getParent())) return false;
        const last = code.getLastDescendant();
        const atEnd = last === null ? anchor.is(code) : anchor.is(last) && selection.anchor.offset === last.getTextContentSize();
        if (!atEnd) return false;
        e.preventDefault();
        const paragraph = $createParagraphNode();
        code.insertAfter(paragraph);
        paragraph.select();
        return true;
      },
      COMMAND_PRIORITY_NORMAL,
    ),
    editor.registerCommand(
      KEY_TAB_COMMAND,
      (e) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;
        // 코드 안은 탭 문자
        if ($findMatchingParent(selection.anchor.getNode(), $isCodeNode)) {
          e.preventDefault();
          return e.shiftKey ? false : editor.dispatchCommand(INSERT_TAB_COMMAND, undefined);
        }
        e.preventDefault();
        return editor.dispatchCommand(e.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND, undefined);
      },
      COMMAND_PRIORITY_NORMAL,
    ),
    // 들여쓰기 · 내어쓰기(Tab · 도구 막대) — 블록 종류는 그대로 깊이만(Notion). Lexical 목록 처리에 맡기면 다른 종류 목록에 섞여 종류가 바뀐다
    editor.registerCommand(
      INDENT_CONTENT_COMMAND,
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || $findMatchingParent(selection.anchor.getNode(), $isCodeNode)) return false;
        return $outlineShift(selection.anchor.getNode(), false, selection.focus.getNode());
      },
      COMMAND_PRIORITY_NORMAL,
    ),
    editor.registerCommand(
      OUTDENT_CONTENT_COMMAND,
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || $findMatchingParent(selection.anchor.getNode(), $isCodeNode)) return false;
        // 토글 안 맨 위 깊이면 토글 밖으로(뒤 블록들은 자식으로 따라 나온다)
        if (selection.isCollapsed() && $outlineExitToggle(selection.anchor.getNode())) return true;
        return $outlineShift(selection.anchor.getNode(), true, selection.focus.getNode());
      },
      COMMAND_PRIORITY_NORMAL,
    ),
    // 새 문단은 서식 없이 시작하고(굵게 · 색이 따라오지 않게), 들여쓴 문단의 깊이는 이어 간다(Notion 과 같다)
    editor.registerCommand(
      INSERT_PARAGRAPH_COMMAND,
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
        // 글이 있는 목록 항목 맨 앞 Enter: 위에 빈 항목을 넣는다(체크는 이 항목에 그대로 — 새 항목으로 옮겨 가지 않게)
        const item = $selectedListItem();
        if (item) {
          const anchor = selection.anchor.getNode();
          // 빈 항목: 마지막 자식이면 종류 그대로 내어 쓰고, 아니면 같은 깊이 텍스트로(Notion)
          if (item.getTextContentSize() === 0 && item.getChildrenSize() === 0) return $outlineEmptyItemEnter(item);
          const atStart = selection.anchor.offset === 0 && (anchor.is(item) || item.getFirstDescendant()?.is(anchor) === true);
          if (!atStart) return false;
          // 위에 넣는 빈 항목은 체크 상태도 같게(Notion)
          const blank = $createListItemNode();
          const list = item.getParent();
          if ($isListNode(list) && list.getListType() === "check") blank.setChecked(item.getChecked() === true);
          item.insertBefore(blank);
          return true;
        }
        const block = selection.anchor.getNode().getTopLevelElement();
        // 목록 · 토글 · 콜아웃 · 코드는 각자 처리가 있다 — 문서 맨 위의 문단 · 제목 · 인용만.
        // 콜아웃 · 토글 내용은 그림자 루트라 그 안 문단도 "맨 위"로 보이니 진짜 루트인지 본다
        if (!($isParagraphNode(block) || $isHeadingNode(block) || $isQuoteNode(block)) || !$isRootNode(block.getParent())) return false;
        const indent = $isParagraphNode(block) ? block.getIndent() : 0;
        selection.insertParagraph();
        const next = $getSelection();
        if (!$isRangeSelection(next)) return true;
        const created = next.anchor.getNode().getTopLevelElement();
        if ($isParagraphNode(created) && created.getTextContentSize() === 0) {
          next.format = 0;
          next.style = "";
          created.setTextFormat(0);
          created.setTextStyle("");
          if (indent > 0) created.setIndent(indent);
        }
        return true;
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

/**
 * 한글 조합 중 누른 Enter — 마지막 글자를 조합하던 중이면 브라우저 · 입력기에 따라 Enter 가 조합을 끝내는 데만 쓰이고
 * 줄바꿈이 안 될 때가 있다. 조합 중 Enter 뒤 조합이 끝났는데 곧 줄바꿈이 안 오면 직접 Enter 를 한 번 보낸다(Notion 과 같다)
 */
export function registerImeEnter(editor: LexicalEditor): () => void {
  let pending = false;
  let broke = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && (e.isComposing || e.keyCode === 229)) {
      pending = true;
      broke = false;
    }
  };
  const onCompositionEnd = () => {
    if (!pending) return;
    pending = false;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!broke) editor.dispatchCommand(KEY_ENTER_COMMAND, null);
    }, 60);
  };
  const mark = () => {
    broke = true;
    return false;
  };
  return mergeRegister(
    editor.registerCommand(INSERT_PARAGRAPH_COMMAND, mark, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(INSERT_LINE_BREAK_COMMAND, mark, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(KEY_ENTER_COMMAND, mark, COMMAND_PRIORITY_CRITICAL),
    editor.registerRootListener((root, prev) => {
      prev?.removeEventListener("keydown", onKeyDown, true);
      prev?.removeEventListener("compositionend", onCompositionEnd, true);
      root?.addEventListener("keydown", onKeyDown, true);
      root?.addEventListener("compositionend", onCompositionEnd, true);
    }),
    () => {
      if (timer) clearTimeout(timer);
    },
  );
}
