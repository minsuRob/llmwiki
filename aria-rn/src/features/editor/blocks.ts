import { $createCodeNode } from "@lexical/code-core";
import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/extension";
import { $isListItemNode, INSERT_CHECK_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND } from "@lexical/list";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $createParagraphNode, $findMatchingParent, $getSelection, $isRangeSelection, type LexicalEditor } from "lexical";

import { INSERT_CALLOUT_COMMAND } from "./CalloutExtension";
import { OPEN_IMAGE_PICKER_COMMAND } from "./ImageExtension";
import { INSERT_TOGGLE_COMMAND } from "./ToggleExtension";

/** 블록 종류 — 슬래시 메뉴 · 블록 전환 단축키가 같은 목록을 쓴다 */
export type BlockKind = "paragraph" | "h1" | "h2" | "h3" | "h4" | "bullet" | "number" | "check" | "toggle" | "callout" | "quote" | "code" | "divider" | "image";

export interface BlockDef {
  kind: BlockKind;
  /** 메뉴에 보이는 이름 */
  label: string;
  /** 짧은 설명(메뉴 둘째 줄) */
  hint: string;
  /** 메뉴 아이콘 자리 글자 */
  glyph: string;
  /** 슬래시 뒤에 쳐서 찾는 말(한 · 영) */
  keywords: string[];
  /** 마크다운 단축 입력 안내(메뉴 오른쪽) */
  shortcut?: string;
}

export const BLOCKS: BlockDef[] = [
  { kind: "paragraph", label: "텍스트", hint: "일반 텍스트로 쓰기", glyph: "Aa", keywords: ["text", "paragraph", "plain", "텍스트", "본문"] },
  { kind: "h1", label: "제목 1", hint: "큰 제목", glyph: "H1", keywords: ["h1", "heading1", "title", "제목1", "큰제목"], shortcut: "#" },
  { kind: "h2", label: "제목 2", hint: "중간 제목", glyph: "H2", keywords: ["h2", "heading2", "subtitle", "제목2"], shortcut: "##" },
  { kind: "h3", label: "제목 3", hint: "작은 제목", glyph: "H3", keywords: ["h3", "heading3", "제목3"], shortcut: "###" },
  { kind: "h4", label: "제목 4", hint: "더 작은 제목", glyph: "H4", keywords: ["h4", "heading4", "제목4"], shortcut: "####" },
  { kind: "bullet", label: "글머리 기호 목록", hint: "점 목록", glyph: "•", keywords: ["bullet", "unordered", "list", "ul", "글머리", "목록"], shortcut: "-" },
  { kind: "number", label: "번호 매기기 목록", hint: "번호 목록", glyph: "1.", keywords: ["number", "numbered", "ordered", "ol", "번호", "목록"], shortcut: "1." },
  { kind: "check", label: "할 일 목록", hint: "체크 상자로 할 일 정리", glyph: "☐", keywords: ["todo", "to-do", "check", "checkbox", "task", "할일", "체크"], shortcut: "[]" },
  { kind: "toggle", label: "토글 목록", hint: "눌러서 펼치고 접는 블록", glyph: "▸", keywords: ["toggle", "collapse", "details", "토글", "접기"], shortcut: ">" },
  { kind: "callout", label: "콜아웃", hint: "눈에 띄게 적기", glyph: "💡", keywords: ["callout", "note", "tip", "콜아웃", "강조", "메모"] },
  { kind: "quote", label: "인용", hint: "인용문", glyph: "❝", keywords: ["quote", "blockquote", "인용"], shortcut: '"' },
  { kind: "code", label: "코드", hint: "코드 조각", glyph: "</>", keywords: ["code", "snippet", "코드"], shortcut: "```" },
  { kind: "image", label: "이미지", hint: "기기에서 사진 고르기 · 붙여넣기 · 끌어다 놓기", glyph: "▣", keywords: ["image", "img", "photo", "picture", "이미지", "사진", "그림"] },
  { kind: "divider", label: "구분선", hint: "블록을 나누는 선", glyph: "—", keywords: ["divider", "hr", "line", "separator", "구분선", "선"], shortcut: "---" },
];

/** 커서가 있는 블록을 다른 종류로 바꾼다(목록 · 구분선은 명령으로) */
export function applyBlock(editor: LexicalEditor, kind: BlockKind) {
  switch (kind) {
    case "bullet":
      editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
      return;
    case "number":
      editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
      return;
    case "check":
      editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
      return;
    case "divider":
      editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined);
      return;
    case "toggle":
      editor.dispatchCommand(INSERT_TOGGLE_COMMAND, undefined);
      return;
    case "callout":
      editor.dispatchCommand(INSERT_CALLOUT_COMMAND, undefined);
      return;
    case "image":
      // 파일 고르기 창은 누르기(사용자 동작) 안에서 바로 열어야 iOS · 브라우저가 막지 않는다
      editor.dispatchCommand(OPEN_IMAGE_PICKER_COMMAND, undefined);
      return;
  }
  // 목록 항목은 $setBlocksType 이 바로 바꾸지 못한다 — 목록을 먼저 풀어 문단으로 만든 뒤 바꾼다
  const inList = editor.getEditorState().read(() => {
    const selection = $getSelection();
    return $isRangeSelection(selection) && $findMatchingParent(selection.anchor.getNode(), $isListItemNode) !== null;
  });
  if (inList) {
    editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    if (kind === "paragraph") return;
  }
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    $setBlocksType(selection, () => {
      switch (kind) {
        case "h1":
        case "h2":
        case "h3":
        case "h4":
          return $createHeadingNode(kind);
        case "quote":
          return $createQuoteNode();
        case "code":
          return $createCodeNode();
        default:
          return $createParagraphNode();
      }
    });
  });
}

/** 슬래시 뒤 검색어로 거른다 — 이름 · 키워드 앞부분 · 포함 순으로 */
export function filterBlocks(query: string): BlockDef[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, "");
  if (!q) return BLOCKS;
  const score = (b: BlockDef) => {
    const names = [b.label.replace(/\s+/g, "").toLowerCase(), ...b.keywords];
    if (names.some((n) => n.startsWith(q))) return 2;
    if (names.some((n) => n.includes(q))) return 1;
    return 0;
  };
  return BLOCKS.map((b) => ({ b, s: score(b) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.b);
}
