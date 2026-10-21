import { $createCodeNode, $isCodeNode } from "@lexical/code-core";
import { $createHorizontalRuleNode, $isHorizontalRuleNode, HorizontalRuleNode } from "@lexical/extension";
import { $createListItemNode, $createListNode, $isListItemNode, $isListNode, ListItemNode, ListNode, type ListType } from "@lexical/list";
import {
  $generateNodesFromMarkdownString,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  CHECK_LIST,
  CODE,
  INLINE_CODE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  LINK,
  ORDERED_LIST,
  STRIKETHROUGH,
  UNORDERED_LIST,
  type ElementTransformer,
  type TextFormatTransformer,
  type Transformer,
} from "@lexical/markdown";
import {
  $createParagraphNode,
  $getSelection,
  $getState,
  $isParagraphNode,
  $isRangeSelection,
  $setState,
  COMMAND_PRIORITY_NORMAL,
  PASTE_COMMAND,
  TextNode,
  type LexicalEditor,
} from "lexical";
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode, HeadingNode, QuoteNode, type HeadingTagType } from "@lexical/rich-text";

import { $listItemToBlock, $listItemToToggle, $setListItemType } from "./listItems";
import { listLetters } from "./listStyle";
import { TOGGLE_TRANSFORMER } from "./ToggleExtension";

/** 제목은 4단계까지 — "#" ~ "####" + 띄어쓰기(Notion 과 같다. "#####" 는 그대로 둔다) */
const HEADING_1_4: ElementTransformer = {
  type: "element",
  dependencies: [HeadingNode],
  export: (node, exportChildren) => {
    if (!$isHeadingNode(node)) return null;
    return "#".repeat(Number(node.getTag().slice(1))) + " " + exportChildren(node);
  },
  regExp: /^(#{1,4})\s/,
  replace: (parentNode, children, match) => {
    const node = $createHeadingNode(`h${match[1].length}` as HeadingTagType);
    node.append(...children);
    parentNode.replace(node);
    node.select(0, 0);
  },
};

/** 인용 — 큰따옴표 · 세로줄 + 띄어쓰기(">" 는 토글) */
const QUOTE_DQ: ElementTransformer = {
  type: "element",
  dependencies: [QuoteNode],
  export: (node, exportChildren) => ($isQuoteNode(node) ? "> " + exportChildren(node) : null),
  regExp: /^["“”|]\s/,
  replace: (parentNode, children) => {
    const node = $createQuoteNode();
    node.append(...children);
    parentNode.replace(node);
    node.select(0, 0);
  },
};

/** 구분선 — "---" + 띄어쓰기 */
const DIVIDER: ElementTransformer = {
  type: "element",
  dependencies: [HorizontalRuleNode],
  export: (node) => ($isHorizontalRuleNode(node) ? "---" : null),
  regExp: /^(---|\*\*\*|___)\s?$/,
  replace: (parentNode, _children, _match, isImport) => {
    const line = $createHorizontalRuleNode();
    if (isImport || parentNode.getNextSibling() != null) {
      parentNode.replace(line);
    } else {
      parentNode.insertBefore(line);
    }
    line.selectNext();
  },
};

/**
 * 번호 목록(입력할 때) — "1. " 은 바로 위 번호 목록에 이어 붙고, "5. " 처럼 다른 수는 그 수부터 새 목록,
 * "a. " 는 a. b. c. 로 세는 새 목록(Notion 과 같다). 가져오기(붙여넣기)는 Lexical 기본 규칙에 맡긴다
 */
const NUMBERED_TYPED: ElementTransformer = {
  type: "element",
  dependencies: [ListNode, ListItemNode],
  export: () => null,
  regExp: /^(\d{1,9}|a)\.\s/,
  replace: (parentNode, children, match, isImport) => {
    if (isImport || $isHeadingNode(parentNode)) return false;
    const letters = match[1] === "a";
    const start = letters ? 1 : Number(match[1]);
    const item = $createListItemNode();
    item.append(...children);
    const prev = parentNode.getPreviousSibling();
    if (!letters && start === 1 && $isListNode(prev) && prev.getListType() === "number" && !$getState(prev, listLetters)) {
      prev.append(item);
      parentNode.remove();
    } else {
      const list = $createListNode("number", start);
      if (letters) $setState(list, listLetters, true);
      list.append(item);
      parentNode.replace(list);
    }
    item.select(0, 0);
  },
};

/** 취소선 — 물결 하나(~글~)도 받는다. "~~" 가 먼저 와야 한다 */
const STRIKE_SINGLE: TextFormatTransformer = { type: "text-format", format: ["strikethrough"], tag: "~" };

/** 순서가 중요하다 — 할 일("[] ")이 글머리("- ")보다, 굵게("**")가 기울임("*")보다 먼저 */
export const MARKDOWN_TRANSFORMERS: Transformer[] = [
  HEADING_1_4,
  TOGGLE_TRANSFORMER,
  QUOTE_DQ,
  CHECK_LIST,
  UNORDERED_LIST,
  NUMBERED_TYPED,
  ORDERED_LIST,
  CODE,
  DIVIDER,
  INLINE_CODE,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  STRIKETHROUGH,
  STRIKE_SINGLE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  LINK,
];

/**
 * "```" · "---" 는 띄어쓰기 없이 세 번째 글자에서 바로 바꾼다(Notion 과 같다).
 * 문단에 그 글자만 있고 커서가 끝에 있을 때만 — 붙여넣은 긴 글 속 "---" 는 건드리지 않는다
 */
export function registerInstantBlocks(editor: LexicalEditor): () => void {
  return editor.registerNodeTransform(TextNode, (node) => {
    if ($convertListItemPrefix(node)) return;
    $replaceTypography(node);
    // "--" 가 먼저 "—" 로 바뀌니 구분선은 "—-" 로도 알아본다
    const raw = node.getTextContent();
    const text = raw === "—-" ? "---" : raw;
    if (text !== "```" && text !== "---") return;
    const block = node.getParent();
    if (!$isParagraphNode(block) || block.getChildrenSize() !== 1) return;
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.key !== node.getKey() || selection.anchor.offset !== raw.length) return;
    if (text === "```") {
      const code = $createCodeNode();
      block.replace(code);
      code.select();
      return;
    }
    const line = $createHorizontalRuleNode();
    block.replace(line);
    const next = $createParagraphNode();
    line.insertAfter(next);
    next.select();
  });
}

/** 입력 치환 — 커서 바로 앞이 이 글자들이면 기호로 바꾼다(코드 · 인라인 코드 안은 그대로) */
const TYPOGRAPHY: [string, string][] = [
  ["--", "—"],
  ["->", "→"],
  ["<-", "←"],
  ["=>", "⇒"],
  [">=", "≥"],
  ["<=", "≤"],
  ["!=", "≠"],
];

function $replaceTypography(node: TextNode) {
  if (node.hasFormat("code") || $isCodeNode(node.getParent())) return;
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.key !== node.getKey()) return;
  const offset = selection.anchor.offset;
  const before = node.getTextContent().slice(0, offset);
  for (const [from, to] of TYPOGRAPHY) {
    if (!before.endsWith(from)) continue;
    node.spliceText(offset - from.length, from.length, to, true);
    return;
  }
}

/**
 * 목록 항목 맨 앞에 "[] " · "[x] " · "- " · "* " · "+ " · "1. " 을 치면 그 항목만 바꾼다(Notion 과 같다).
 * "# " · "\" " 처럼 목록이 아닌 블록이면 목록 밖으로 꺼내 바꾼다.
 * Lexical 의 마크다운 단축 입력은 맨 위 블록에서만 돌아 목록 안에서는 따로 본다
 */
function $convertListItemPrefix(node: TextNode): boolean {
  const item = node.getParent();
  if (!$isListItemNode(item) || item.getFirstChild() !== node) return false;
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.key !== node.getKey()) return false;
  const before = node.getTextContent().slice(0, selection.anchor.offset);
  // "> " 은 토글로 — 항목 글은 제목, 자식 목록은 토글 안으로(깊이 그대로)
  if (before === "> ") {
    node.spliceText(0, before.length, "", true);
    $listItemToToggle(item);
    return true;
  }
  // "# " ~ "#### " · "\" " "| " 은 목록 밖 제목 · 인용으로(깊이는 들여쓰기로 지킨다)
  const block = /^(#{1,4}) $/.exec(before);
  if (block || /^["“”|] $/.test(before)) {
    node.spliceText(0, before.length, "", true);
    $listItemToBlock(item, block ? $createHeadingNode(`h${block[1].length}` as HeadingTagType) : $createQuoteNode());
    return true;
  }
  const match = /^(?:(\[( |x|X)?\])|([-*+])|(\d{1,9})\.) $/.exec(before);
  if (!match) return false;
  const type: ListType = match[1] ? "check" : match[3] ? "bullet" : "number";
  // 할 일 맨 앞 "- " 은 글자 그대로 둔다(Notion 실측 — "1. " · "# " 은 바뀌지만 글머리 기호는 안 바뀐다)
  const list = item.getParent();
  if (type === "bullet" && $isListNode(list) && list.getListType() === "check") return false;
  node.spliceText(0, before.length, "", true);
  $setListItemType(item, type, (match[2] ?? "").toLowerCase() === "x");
  return true;
}

/**
 * 여러 줄 일반 텍스트를 붙여넣으면 마크다운으로 읽어 블록으로 넣는다(Notion 과 같다) — "- 항목" · "# 제목" 등.
 * HTML 이 같이 오면(다른 편집기 · 웹에서 복사) 그쪽 서식을 따르고, 파일(이미지)과 코드 블록 안은 건드리지 않는다
 */
export function registerMarkdownPaste(editor: LexicalEditor): () => void {
  return editor.registerCommand(
    PASTE_COMMAND,
    (event) => {
      const data = "clipboardData" in event ? event.clipboardData : null;
      if (!data || data.types.includes("Files") || data.getData("text/html")) return false;
      const text = data.getData("text/plain").replace(/\r\n?/g, "\n");
      if (!text.includes("\n")) return false;
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || $isCodeNode(selection.anchor.getNode().getTopLevelElement())) return false;
      event.preventDefault();
      selection.insertNodes($generateNodesFromMarkdownString(text, MARKDOWN_TRANSFORMERS));
      return true;
    },
    COMMAND_PRIORITY_NORMAL,
  );
}
