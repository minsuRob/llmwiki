import { $createCodeNode, $isCodeNode } from "@lexical/code-core";
import { $createHorizontalRuleNode, $isHorizontalRuleNode, HorizontalRuleNode } from "@lexical/extension";
import { $isListItemNode, type ListType } from "@lexical/list";
import {
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
  $isParagraphNode,
  $isRangeSelection,
  TextNode,
  type LexicalEditor,
} from "lexical";
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode, HeadingNode, QuoteNode, type HeadingTagType } from "@lexical/rich-text";

import { $setListItemType } from "./listItems";
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

/** 취소선 — 물결 하나(~글~)도 받는다. "~~" 가 먼저 와야 한다 */
const STRIKE_SINGLE: TextFormatTransformer = { type: "text-format", format: ["strikethrough"], tag: "~" };

/** 순서가 중요하다 — 할 일("[] ")이 글머리("- ")보다, 굵게("**")가 기울임("*")보다 먼저 */
export const MARKDOWN_TRANSFORMERS: Transformer[] = [
  HEADING_1_4,
  TOGGLE_TRANSFORMER,
  QUOTE_DQ,
  CHECK_LIST,
  UNORDERED_LIST,
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
 * Lexical 의 마크다운 단축 입력은 맨 위 블록에서만 돌아 목록 안에서는 따로 본다
 */
function $convertListItemPrefix(node: TextNode): boolean {
  const item = node.getParent();
  if (!$isListItemNode(item) || item.getFirstChild() !== node) return false;
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.key !== node.getKey()) return false;
  const before = node.getTextContent().slice(0, selection.anchor.offset);
  const match = /^(?:(\[( |x|X)?\])|([-*+])|(\d{1,9})\.) $/.exec(before);
  if (!match) return false;
  const type: ListType = match[1] ? "check" : match[3] ? "bullet" : "number";
  node.spliceText(0, before.length, "", true);
  $setListItemType(item, type, (match[2] ?? "").toLowerCase() === "x");
  return true;
}
