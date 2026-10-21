import type { ElementTransformer } from "@lexical/markdown";
import { $insertNodeToNearestRoot } from "@lexical/utils";
import {
  $createParagraphNode,
  $findMatchingParent,
  $getSelection,
  $getSiblingCaret,
  $insertNodeToNearestRootAtCaret,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW,
  createCommand,
  defineExtension,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  mergeRegister,
  type ElementNode,
  type LexicalCommand,
  type LexicalNode,
} from "lexical";

import { $isPointAtEnd, $isPointAtStart, $wrapInlineChildren, registerTapZone } from "./nestedBlocks";
import {
  $createToggle,
  $createToggleContentNode,
  $isToggleContainerNode,
  $isToggleContentNode,
  $isToggleTitleNode,
  $unwrapToggle,
  ToggleContainerNode,
  ToggleContentNode,
  ToggleTitleNode,
} from "./ToggleNodes";

export {
  $createToggle,
  $isToggleContainerNode,
  $isToggleContentNode,
  $isToggleTitleNode,
  $unwrapToggle,
  ToggleContainerNode,
  ToggleContentNode,
  ToggleTitleNode,
} from "./ToggleNodes";

/** 커서가 든 블록을 토글로 — 그 블록 글이 토글 제목이 된다 */
export const INSERT_TOGGLE_COMMAND: LexicalCommand<void> = createCommand("INSERT_TOGGLE_COMMAND");
/** 커서가 든(가장 안쪽) 토글을 열고 닫는다 — 토글 밖이면 false */
export const TOGGLE_OPEN_COMMAND: LexicalCommand<void> = createCommand("TOGGLE_OPEN_COMMAND");

/** ▸ 를 누를 수 있는 너비(px) — blocks-extra.css 의 제목 왼쪽 여백과 맞춘다 */
const CARET_ZONE = 26;

/** 글(인라인)만 담는 가장 가까운 블록 */
function $leafBlockOf(node: LexicalNode): ElementNode | null {
  const block = $findMatchingParent(node, (n) => $isElementNode(n) && !n.isInline() && !$isRootOrShadowRoot(n));
  if (!$isElementNode(block)) return null;
  return block.getChildren().every((c) => c.isInline()) ? block : null;
}

/** 커서가 든 가장 안쪽 토글 */
function $currentToggle(): ToggleContainerNode | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const node = $findMatchingParent(selection.anchor.getNode(), $isToggleContainerNode);
  return $isToggleContainerNode(node) ? node : null;
}

/**
 * 커서가 든 블록을 토글로 바꾼다(편집기 update 안에서).
 * 루트 바로 아래 블록은 그 자리에서 바꾸고, 목록 항목처럼 안쪽 블록이면 목록을 그 뒤에서 나눠 넣는다
 */
export function $insertToggle(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  const anchor = selection.anchor.getNode();
  if ($findMatchingParent(anchor, $isToggleTitleNode)) return false;
  const toggle = $createToggle();
  const title = toggle.getTitle();
  const block = $leafBlockOf(anchor);
  if (!title) return false;
  if (!block) {
    $insertNodeToNearestRoot(toggle);
  } else if ($isRootOrShadowRoot(block.getParent())) {
    title.append(...block.getChildren());
    block.replace(toggle);
  } else {
    $insertNodeToNearestRootAtCaret(toggle, $getSiblingCaret(block, "next"), { $shouldSplit: (_node, edge) => edge !== "last" });
    title.append(...block.getChildren());
    block.remove();
  }
  // 글 노드는 그대로 옮겨지므로 커서가 제목 안에 남아 있으면 그 자리를 둔다
  const after = $getSelection();
  if (!$isRangeSelection(after) || !title.isParentOf(after.anchor.getNode())) title.selectEnd();
  return true;
}

/** 토글 구조를 바로잡는다 — 제목이 없으면 풀고, 내용이 없으면 만들고, 그 밖의 자식은 내용으로 */
function $normalizeContainer(container: ToggleContainerNode): void {
  const children = container.getChildren();
  const title = children.find($isToggleTitleNode);
  if (!title) {
    $unwrapToggle(container);
    return;
  }
  if (!title.is(container.getFirstChild())) container.getFirstChildOrThrow().insertBefore(title);
  let content = children.find($isToggleContentNode);
  if (!content) {
    content = $createToggleContentNode();
    container.append(content);
  }
  for (const child of children) {
    if (child.is(title) || child.is(content)) continue;
    if ($isToggleContentNode(child)) {
      content.append(...child.getChildren());
      child.remove();
    } else {
      content.append(child);
    }
  }
}

/** 제목은 토글 안에서만 · 글만 — 밖이면 문단으로, 블록이 섞이면 내용 맨 앞으로 */
function $normalizeTitle(title: ToggleTitleNode): void {
  const container = title.getParent();
  if (!$isToggleContainerNode(container)) {
    const paragraph = $createParagraphNode();
    paragraph.append(...title.getChildren());
    title.replace(paragraph);
    return;
  }
  const blocks = title.getChildren().filter((c) => !c.isInline());
  if (blocks.length === 0) return;
  const content = container.getContent();
  if (!content) return;
  const first = content.getFirstChild();
  for (const block of blocks) {
    if (first) first.insertBefore(block);
    else content.append(block);
  }
}

/** 내용은 토글 안에서만 · 블록만 · 비지 않게 */
function $normalizeContent(content: ToggleContentNode): void {
  if (!$isToggleContainerNode(content.getParent())) {
    let anchor: LexicalNode = content;
    for (const child of content.getChildren()) {
      anchor.insertAfter(child);
      anchor = child;
    }
    content.remove();
    return;
  }
  $wrapInlineChildren(content);
  if (content.isEmpty()) content.append($createParagraphNode());
}

/** Enter — 제목 맨 앞이면 토글 위에 빈 문단. 내용의 빈 마지막 줄은 Notion 처럼 그대로 새 줄(밖으로는 Shift+Tab) */
function $onInsertParagraph(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const anchor = selection.anchor.getNode();
  const title = $findMatchingParent(anchor, $isToggleTitleNode);
  if ($isToggleTitleNode(title)) {
    const container = title.getParent();
    if (!$isToggleContainerNode(container) || title.isEmpty() || !$isPointAtStart(selection.anchor, title)) return false;
    container.insertBefore($createParagraphNode());
    return true;
  }
  return false;
}

/** ↓ · → — 닫힌 토글 제목 끝에서는 숨은 내용을 건너뛰고, 문서 끝 토글이면 아래에 빈 문단을 만든다 */
function $onArrowForward(event: KeyboardEvent, createAtEnd: boolean): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed() || event.shiftKey) return false;
  const container = $currentToggle();
  if (!container) return false;
  const open = container.getOpen();
  const end = open ? container : container.getTitle();
  if (!end || !$isPointAtEnd(selection.anchor, end)) return false;
  const next = container.getNextSibling();
  if (next) {
    if (open || !$isElementNode(next)) return false;
    event.preventDefault();
    next.selectStart();
    return true;
  }
  if (!createAtEnd) return false;
  event.preventDefault();
  const paragraph = $createParagraphNode();
  container.insertAfter(paragraph);
  paragraph.select();
  return true;
}

/** ↑ — 문서 맨 앞 토글 제목 맨 앞이면 위에 빈 문단을 만든다(토글 위로 갈 자리) */
function $onArrowUp(event: KeyboardEvent): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed() || event.shiftKey) return false;
  const title = $findMatchingParent(selection.anchor.getNode(), $isToggleTitleNode);
  const container = title?.getParent();
  if (!$isToggleTitleNode(title) || !$isToggleContainerNode(container) || container.getPreviousSibling()) return false;
  if (!$isPointAtStart(selection.anchor, title)) return false;
  event.preventDefault();
  const paragraph = $createParagraphNode();
  container.insertBefore(paragraph);
  paragraph.select();
  return true;
}

/** 마크다운 단축 입력 — 문단 맨 앞 "> " 로 토글. 내보낼 때는 <details> 로(인용 "> " 와 겹치지 않게) */
export const TOGGLE_TRANSFORMER: ElementTransformer = {
  type: "element",
  dependencies: [ToggleContainerNode, ToggleTitleNode, ToggleContentNode],
  export: (node, exportChildren) => {
    if (!$isToggleContainerNode(node)) return null;
    const title = node.getTitle();
    const lines = (node.getContent()?.getChildren() ?? []).map((c) => c.getTextContent()).filter((t) => t.trim() !== "");
    const summary = `<details${node.getOpen() ? " open" : ""}><summary>${title ? exportChildren(title) : ""}</summary>`;
    return [summary, ...(lines.length > 0 ? ["", ...lines, ""] : []), "</details>"].join("\n");
  },
  regExp: /^>\s/,
  replace: (parentNode, children, _match, isImport) => {
    // 가져오기의 "> " 는 인용 몫 — 토글은 입력할 때만
    if (isImport || !$isParagraphNode(parentNode)) return false;
    const toggle = $createToggle();
    const title = toggle.getTitle();
    if (!title) return false;
    title.append(...children);
    parentNode.replace(toggle);
    title.selectStart();
  },
};

/** 토글 블록 — 제목 줄의 ▸ 를 누르거나 Cmd+Enter(TOGGLE_OPEN_COMMAND)로 열고 닫는다 */
export const ToggleExtension = defineExtension({
  name: "llmwiki/toggle",
  nodes: () => [ToggleContainerNode, ToggleTitleNode, ToggleContentNode],
  register(editor) {
    return mergeRegister(
      editor.registerNodeTransform(ToggleContainerNode, $normalizeContainer),
      editor.registerNodeTransform(ToggleTitleNode, $normalizeTitle),
      editor.registerNodeTransform(ToggleContentNode, $normalizeContent),
      editor.registerCommand(INSERT_TOGGLE_COMMAND, $insertToggle, COMMAND_PRIORITY_EDITOR),
      editor.registerCommand(
        TOGGLE_OPEN_COMMAND,
        () => {
          const container = $currentToggle();
          if (!container) return false;
          container.toggleOpen();
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      // 목록의 빈 항목 나가기(LOW)와 겹치지 않는다 — 여기는 문단 · 제목만 본다
      editor.registerCommand(INSERT_PARAGRAPH_COMMAND, $onInsertParagraph, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_ARROW_DOWN_COMMAND, (e) => $onArrowForward(e, true), COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_ARROW_RIGHT_COMMAND, (e) => $onArrowForward(e, false), COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_ARROW_UP_COMMAND, $onArrowUp, COMMAND_PRIORITY_LOW),
      registerTapZone(editor, {
        selector: ".lex-toggle-title",
        hit: (x, y, el) => {
          // 첫 줄 높이만 — 여러 줄 제목의 아래쪽 왼편은 글 고르기로 둔다
          const line = parseFloat(getComputedStyle(el).lineHeight);
          return x >= 0 && x < CARET_ZONE && y < (Number.isFinite(line) ? line : 24) + 6;
        },
        $onTap: (node) => {
          const title = $findMatchingParent(node, $isToggleTitleNode);
          const container = title?.getParent();
          if ($isToggleContainerNode(container)) container.toggleOpen();
        },
      }),
    );
  },
});
