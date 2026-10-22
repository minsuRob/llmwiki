import { $createCodeNode, $isCodeNode } from "@lexical/code-core";
import { $createHorizontalRuleNode, $isHorizontalRuleNode, HorizontalRuleNode } from "@lexical/extension";
import { $createListItemNode, $createListNode, $isListItemNode, $isListNode, ListItemNode, ListNode, type ListType } from "@lexical/list";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
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
  type MultilineElementTransformer,
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
  type ElementNode,
  type LexicalEditor,
} from "lexical";
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode, HeadingNode, QuoteNode, type HeadingTagType } from "@lexical/rich-text";

import { $createCalloutNode, $isCalloutNode, CalloutNode } from "./CalloutExtension";
import { $createImageNode, $isImageNode, ImageNode } from "./ImageNode";
import { $listItemToBlock, $listItemToToggle, $setListItemType } from "./listItems";
import { listLetters } from "./listStyle";
import { toEditorMarkdown } from "./markdownCompat";
import { TOGGLE_TRANSFORMER } from "./ToggleExtension";
import { $createToggleContainerNode, $createToggleContentNode, $createToggleTitleNode, $isToggleContainerNode, ToggleContainerNode, ToggleContentNode, ToggleTitleNode } from "./ToggleNodes";

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

/** 인용 — 큰따옴표 · 세로줄 + 띄어쓰기(">" 는 토글). 내보낼 때는 일반 마크다운 "> "(줄마다) */
const QUOTE_DQ: ElementTransformer = {
  type: "element",
  dependencies: [QuoteNode],
  export: (node, exportChildren) => ($isQuoteNode(node) ? "> " + exportChildren(node).replace(/\n/g, "\n> ") : null),
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

/** 블록을 담는 노드(토글 내용 · 콜아웃)의 안쪽을 같은 규칙으로 — 깊이가 있어도 그대로 */
const $exportInner = (node: ElementNode) => $convertToMarkdownString(MARKDOWN_TRANSFORMERS, node);
function $importInner(markdown: string, into: ElementNode) {
  $convertFromMarkdownString(toEditorMarkdown(markdown), MARKDOWN_TRANSFORMERS, into);
  if (into.isEmpty()) into.append($createParagraphNode());
}

/**
 * 토글 — 일반 마크다운의 <details>(GitHub · Obsidian 이 접어 보인다). 안쪽은 블록 그대로(목록 · 토글 속 토글).
 * 가져올 때 짝이 맞는 </details> 까지 읽는다. 입력할 때의 "> " 는 TOGGLE_TRANSFORMER 가 맡는다
 */
export const DETAILS_TRANSFORMER: MultilineElementTransformer = {
  type: "multiline-element",
  dependencies: [ToggleContainerNode, ToggleTitleNode, ToggleContentNode],
  regExpStart: /^<details( open)?>\s*<summary>(.*?)<\/summary>\s*$/,
  regExpEnd: /^<\/details>\s*$/,
  handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex, startMatch }) => {
    let depth = 1;
    let end = startLineIndex;
    while (depth > 0 && end + 1 < lines.length) {
      const line = lines[++end].trim();
      if (/^<details[\s>]/.test(line)) depth++;
      else if (/^<\/details>$/.test(line)) depth--;
    }
    if (depth > 0) return null;
    const toggle = $createToggleContainerNode(!!startMatch[1]);
    const title = $createToggleTitleNode();
    const content = $createToggleContentNode();
    toggle.append(title, content);
    rootNode.append(toggle);
    // 제목 속 서식(굵게 · 링크)도 — 문단 하나로 읽어 그 글자들만 옮긴다
    const holder = $createToggleContentNode();
    $convertFromMarkdownString(startMatch[2] ?? "", MARKDOWN_TRANSFORMERS, holder);
    const first = holder.getFirstChild();
    if (first && "getChildren" in first) title.append(...(first as ElementNode).getChildren());
    $importInner(lines.slice(startLineIndex + 1, end).join("\n"), content);
    return [true, end];
  },
  replace: () => false,
  export: (node, traverseChildren) => {
    if (!$isToggleContainerNode(node)) return null;
    const title = node.getTitle();
    const content = node.getContent();
    const inner = content ? $exportInner(content) : "";
    return [`<details${node.getOpen() ? " open" : ""}><summary>${title ? traverseChildren(title) : ""}</summary>`, ...(inner.trim() ? ["", inner, ""] : []), "</details>"].join("\n");
  },
};

/** 콜아웃 — Obsidian · GitHub 꼴 "> [!note] 💡" + "> " 줄들. 안쪽은 블록 그대로 */
export const CALLOUT_TRANSFORMER: MultilineElementTransformer = {
  type: "multiline-element",
  dependencies: [CalloutNode],
  regExpStart: /^>\s?\[!(\w+)\][ \t]*(.*)$/,
  handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex, startMatch }) => {
    let end = startLineIndex;
    while (end + 1 < lines.length && /^>/.test(lines[end + 1])) end++;
    const callout = $createCalloutNode(startMatch[2]?.trim() || undefined);
    rootNode.append(callout);
    $importInner(lines.slice(startLineIndex + 1, end + 1).map((l) => l.replace(/^>\s?/, "")).join("\n"), callout);
    return [true, end];
  },
  replace: () => false,
  export: (node) => {
    if (!$isCalloutNode(node)) return null;
    const inner = $exportInner(node);
    return [`> [!note] ${node.getEmoji()}`, ...inner.split("\n").map((l) => (l ? `> ${l}` : ">"))].join("\n");
  },
};

/** 이미지(블록) — ![설명](주소 "너비"). 기기에서 줄인 data URL 도 그대로 */
const IMAGE_TRANSFORMER: ElementTransformer = {
  type: "element",
  dependencies: [ImageNode],
  export: (node) => {
    if (!$isImageNode(node)) return null;
    const width = node.getWidth();
    return `![${node.getAlt().replace(/[[\]]/g, "")}](${node.getSrc()}${width ? ` "${width}"` : ""})`;
  },
  regExp: /^!\[([^\]]*)\]\((\S+?)(?:\s+"(\d+)")?\)\s*$/,
  replace: (parentNode, _children, match) => {
    parentNode.replace($createImageNode({ src: match[2], alt: match[1], width: match[3] ? Number(match[3]) : null }));
  },
};

/** 취소선 — 물결 하나(~글~)도 받는다. "~~" 가 먼저 와야 한다 */
const STRIKE_SINGLE: TextFormatTransformer = { type: "text-format", format: ["strikethrough"], tag: "~" };

/** 순서가 중요하다 — 할 일("[] ")이 글머리("- ")보다, 굵게("**")가 기울임("*")보다 먼저 */
export const MARKDOWN_TRANSFORMERS: Transformer[] = [
  DETAILS_TRANSFORMER,
  CALLOUT_TRANSFORMER,
  IMAGE_TRANSFORMER,
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

/** 편집기 내용 → 마크다운(페이지 본문 정본). 편집기 update · read 안에서 */
export function $toMarkdown(): string {
  return $convertToMarkdownString(MARKDOWN_TRANSFORMERS);
}

/** 마크다운(일반 마크다운 · 이 편집기 규칙 둘 다) → 편집기 내용. 지금 내용은 지운다 */
export function $fromMarkdown(markdown: string): void {
  $convertFromMarkdownString(toEditorMarkdown(markdown), MARKDOWN_TRANSFORMERS);
}

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
