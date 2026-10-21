import "./floating-toolbar.css";

import { $isCodeNode } from "@lexical/code-core";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { ListNode } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import { $getSelectionStyleValueForProperty, $patchStyleText, createDOMRange } from "@lexical/selection";
import { $getNearestNodeOfType, mergeRegister } from "@lexical/utils";
import {
  $findMatchingParent,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  BLUR_COMMAND,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_NORMAL,
  CONTROL_OR_META,
  FOCUS_COMMAND,
  FORMAT_TEXT_COMMAND,
  IS_APPLE,
  KEY_DOWN_COMMAND,
  KEY_ESCAPE_COMMAND,
  isExactShortcutMatch,
  type LexicalEditor,
  type LexicalNode,
  type RangeSelection,
  type TextFormatType,
} from "lexical";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";

import { applyBlock, BLOCKS, type BlockKind } from "./blocks";

/** 서버 렌더(웹 정적 출력)에서는 레이아웃 효과 경고가 나니 일반 효과로 */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** 선택 영역과 떨어진 거리 · 가장자리 여백(px) */
const GAP = 8;
const EDGE = 4;
/** 패널이 아래로 열리려면 이만큼은 비어 있어야 한다(아니면 더 넓은 쪽) */
const PANEL_MIN = 220;

/** 아이콘 — Bootstrap Icons(16×16) 경로 */
const ICON = {
  bold: ["M8.21 13c2.106 0 3.412-1.087 3.412-2.823 0-1.306-.984-2.283-2.324-2.386v-.055a2.176 2.176 0 0 0 1.852-2.14c0-1.51-1.162-2.46-3.014-2.46H3.843V13H8.21zM5.908 4.674h1.696c.963 0 1.517.451 1.517 1.244 0 .834-.629 1.32-1.73 1.32H5.908V4.673zm0 6.788V8.598h1.73c1.217 0 1.88.492 1.88 1.415 0 .943-.643 1.449-1.832 1.449H5.907z"],
  italic: ["M7.991 11.674 9.53 4.455c.123-.595.246-.71 1.347-.807l.11-.52H7.211l-.11.52c1.06.096 1.128.212 1.005.807L6.57 11.674c-.123.595-.246.71-1.346.806l-.11.52h3.774l.11-.52c-1.06-.095-1.129-.211-1.006-.806z"],
  underline: ["M5.313 3.136h-1.23V9.54c0 2.105 1.47 3.623 3.917 3.623s3.917-1.518 3.917-3.623V3.136h-1.23v6.323c0 1.49-.978 2.57-2.687 2.57-1.709 0-2.687-1.08-2.687-2.57V3.136zM12.5 15h-9v-1h9v1z"],
  strikethrough: ["M6.333 5.686c0 .31.083.581.27.814H5.166a2.776 2.776 0 0 1-.099-.76c0-1.627 1.436-2.768 3.48-2.768 1.969 0 3.39 1.175 3.445 2.85h-1.23c-.11-1.08-.964-1.743-2.25-1.743-1.23 0-2.18.602-2.18 1.607zm2.194 7.478c-2.153 0-3.589-1.107-3.705-2.81h1.23c.144 1.06 1.129 1.703 2.544 1.703 1.34 0 2.31-.705 2.31-1.675 0-.827-.547-1.374-1.914-1.675L8.046 8.5H1v-1h14v1h-3.504c.468.437.675.994.675 1.697 0 1.826-1.436 2.967-3.644 2.967z"],
  code: ["M5.854 4.854a.5.5 0 1 0-.708-.708l-3.5 3.5a.5.5 0 0 0 0 .708l3.5 3.5a.5.5 0 0 0 .708-.708L2.707 8l3.147-3.146zm4.292 0a.5.5 0 0 1 .708-.708l3.5 3.5a.5.5 0 0 1 0 .708l-3.5 3.5a.5.5 0 0 1-.708-.708L13.293 8l-3.147-3.146z"],
  link: [
    "M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1.002 1.002 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4.018 4.018 0 0 1-.128-1.287z",
    "M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243L6.586 4.672z",
  ],
  chevron: ["M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"],
  trash: [
    "M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z",
    "M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z",
  ],
} as const;

function Icon({ name, size = 16 }: { name: keyof typeof ICON; size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
      {ICON[name].map((d) => (
        <path key={d} fillRule="evenodd" d={d} />
      ))}
    </svg>
  );
}

/** 단축키 표시 — 애플은 ⌘, 나머지는 Ctrl+ */
const MOD = IS_APPLE ? "⌘" : "Ctrl+";
const SHIFT = IS_APPLE ? "⇧" : "Shift+";

type InlineFormat = Extract<TextFormatType, "bold" | "italic" | "underline" | "strikethrough" | "code">;

const FORMATS: { format: InlineFormat; label: string; keys: string }[] = [
  { format: "bold", label: "굵게", keys: `${MOD}B` },
  { format: "italic", label: "기울임", keys: `${MOD}I` },
  { format: "underline", label: "밑줄", keys: `${MOD}U` },
  { format: "strikethrough", label: "취소선", keys: `${MOD}${SHIFT}S` },
  { format: "code", label: "인라인 코드", keys: `${MOD}E` },
];

/** Notion 의 10색 — 값은 floating-toolbar.css 의 --lex-c-* · --lex-bg-*(라이트 · 다크) */
export const COLORS = [
  { name: "default", label: "기본" },
  { name: "gray", label: "회색" },
  { name: "brown", label: "갈색" },
  { name: "orange", label: "주황" },
  { name: "yellow", label: "노랑" },
  { name: "green", label: "초록" },
  { name: "blue", label: "파랑" },
  { name: "purple", label: "보라" },
  { name: "pink", label: "분홍" },
  { name: "red", label: "빨강" },
] as const;

export type ColorName = (typeof COLORS)[number]["name"];
/** 글자 색 · 배경 색 */
export type ColorKind = "text" | "bg";

/** 글자 노드 style 에 넣는 값 — 변수로 넣어야 팔레트(라이트 · 다크)를 따라간다. 기본은 null(지움) */
export function colorValue(kind: ColorKind, name: ColorName): string | null {
  if (name === "default") return null;
  return `var(--lex-${kind === "text" ? "c" : "bg"}-${name})`;
}

/** style 값 → 색 이름(우리 변수가 아니거나 섞여 있으면 null) */
function colorName(value: string, kind: ColorKind): ColorName | null {
  const m = /^var\(--lex-(c|bg)-([a-z]+)\)$/.exec(value.trim());
  if (!m || m[1] !== (kind === "text" ? "c" : "bg")) return null;
  return COLORS.find((c) => c.name === m[2])?.name ?? null;
}

/** 선택 영역에 색을 칠한다(기본이면 지운다) */
export function $applyColor(selection: RangeSelection, kind: ColorKind, name: ColorName) {
  const value = colorValue(kind, name);
  $patchStyleText(selection, kind === "text" ? { color: value } : { "background-color": value });
}

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * 입력한 링크 주소를 고친다 — 스킴이 없으면 https:// 를 붙이고, 이메일은 mailto: 로.
 * 빈 값이면 null(링크 지움), 쓸 수 없는 주소(javascript: 등)면 false
 */
export function normalizeLinkUrl(raw: string): string | null | false {
  const text = raw.trim();
  if (!text) return null;
  // 브라우저는 스킴 안의 제어 문자 · 공백을 무시하니 지우고 본다("java\tscript:")
  const probe = Array.from(text)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code > 0x20 && code !== 0x7f;
    })
    .join("")
    .toLowerCase();
  if (/^(javascript|vbscript|data|file|blob):/.test(probe)) return false;
  // 같은 문서 안 · 앱 안 경로는 그대로
  if (/^[/#]/.test(text) && !text.startsWith("//")) return text;
  let url = text;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(text)) url = `mailto:${text}`;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^(mailto|tel):/i.test(text)) url = `https://${text.replace(/^\/\//, "")}`;
  try {
    const parsed = new URL(url);
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) return false;
    if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.hostname.includes(".") && parsed.hostname !== "localhost") return false;
  } catch {
    return false;
  }
  return url;
}

/** 선택 영역이 코드 블록 안에 걸쳐 있는지 */
function $inCode(selection: RangeSelection) {
  return $findMatchingParent(selection.anchor.getNode(), $isCodeNode) !== null || $findMatchingParent(selection.focus.getNode(), $isCodeNode) !== null;
}

/** 서식을 줄 수 있는 선택(글자가 있는 범위 · 코드 블록 밖)인지 */
function $formattable(): RangeSelection | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || selection.isCollapsed() || selection.getTextContent() === "" || $inCode(selection)) return null;
  return selection;
}

export interface FormatShortcutHandlers {
  /** ⌘K — 링크 입력 열기. 처리했으면 true */
  onLink?: () => boolean;
  /** ⌘⇧H — 마지막 색 다시 칠하기. 처리했으면 true */
  onRepeatColor?: () => boolean;
}

/**
 * 서식 단축키 — ⌘K 링크 · ⌘E 인라인 코드 · ⌘⇧S 취소선 · ⌘⇧H 마지막 색.
 * ⌘B · I · U 는 Lexical 이 이미 처리한다. 코어 키 처리(EDITOR 우선순위)보다 먼저 받는다
 */
export function registerFormatShortcuts(editor: LexicalEditor, handlers: FormatShortcutHandlers = {}): () => void {
  const withShift = { ...CONTROL_OR_META, shiftKey: true };
  const format = (event: KeyboardEvent, f: InlineFormat) => {
    const inCode = editor.getEditorState().read(() => {
      const selection = $getSelection();
      return $isRangeSelection(selection) && $inCode(selection);
    });
    if (inCode) return false;
    event.preventDefault();
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, f);
    return true;
  };
  const handled = (event: KeyboardEvent, ok: boolean | undefined) => {
    if (ok) event.preventDefault();
    return ok === true;
  };
  return editor.registerCommand(
    KEY_DOWN_COMMAND,
    (event) => {
      if (isExactShortcutMatch(event, "k", CONTROL_OR_META)) return handled(event, handlers.onLink?.());
      if (isExactShortcutMatch(event, "e", CONTROL_OR_META)) return format(event, "code");
      if (isExactShortcutMatch(event, "s", withShift)) return format(event, "strikethrough");
      if (isExactShortcutMatch(event, "h", withShift)) return handled(event, handlers.onRepeatColor?.());
      return false;
    },
    COMMAND_PRIORITY_NORMAL,
  );
}

/** registerFormatShortcuts 의 훅 — 처리기는 매번 바뀌어도 다시 등록하지 않는다 */
export function useFormatShortcuts(handlers: FormatShortcutHandlers = {}) {
  const [editor] = useLexicalComposerContext();
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(
    () =>
      registerFormatShortcuts(editor, {
        onLink: () => latest.current.onLink?.() ?? false,
        onRepeatColor: () => latest.current.onRepeatColor?.() ?? false,
      }),
    [editor],
  );
}

type Panel = "block" | "link" | "color" | null;

interface SelectionInfo {
  /** 같은 선택인지 가리는 값(Escape 로 닫은 선택은 다시 열지 않는다) */
  sig: string;
  formats: Record<InlineFormat, boolean>;
  block: BlockKind;
  link: string | null;
  color: ColorName | null;
  bg: ColorName | null;
}

function sameInfo(a: SelectionInfo | null, b: SelectionInfo | null) {
  return a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));
}

/** 선택이 있는 블록의 종류 — 목록은 가장 가까운 목록, 나머지는 최상위 블록 */
function $blockKind(node: LexicalNode): BlockKind {
  const list = $getNearestNodeOfType(node, ListNode);
  if (list) {
    const type = list.getListType();
    return type === "bullet" ? "bullet" : type === "number" ? "number" : "check";
  }
  const top = node.getTopLevelElement();
  if ($isHeadingNode(top)) {
    const tag = top.getTag();
    return tag === "h1" || tag === "h2" ? tag : "h3";
  }
  if ($isQuoteNode(top)) return "quote";
  if ($isCodeNode(top)) return "code";
  return "paragraph";
}

function $readSelection(): { info: SelectionInfo; saved: RangeSelection } | null {
  const selection = $formattable();
  if (!selection) return null;
  const { anchor, focus } = selection;
  let link: string | null = null;
  for (const node of selection.getNodes()) {
    const found = $findMatchingParent(node, $isLinkNode);
    if ($isLinkNode(found)) {
      link = found.getURL();
      break;
    }
  }
  const info: SelectionInfo = {
    sig: `${anchor.key}:${anchor.offset}:${focus.key}:${focus.offset}`,
    formats: {
      bold: selection.hasFormat("bold"),
      italic: selection.hasFormat("italic"),
      underline: selection.hasFormat("underline"),
      strikethrough: selection.hasFormat("strikethrough"),
      code: selection.hasFormat("code"),
    },
    block: $blockKind(anchor.getNode()),
    link,
    color: colorName($getSelectionStyleValueForProperty(selection, "color", ""), "text"),
    bg: colorName($getSelectionStyleValueForProperty(selection, "background-color", ""), "bg"),
  };
  return { info, saved: selection.clone() };
}

/** 선택 영역의 화면 사각형 — 편집기 안 DOM 선택이 우선, 없으면(링크 입력 중) 기억해 둔 선택으로 */
function selectionRect(editor: LexicalEditor, root: HTMLElement, saved: RangeSelection | null): DOMRect | null {
  const dom = window.getSelection();
  let range: Range | null = null;
  if (dom && dom.rangeCount > 0 && !dom.isCollapsed && dom.anchorNode && root.contains(dom.anchorNode)) {
    range = dom.getRangeAt(0);
  } else if (saved) {
    try {
      range = editor.getEditorState().read(() => {
        const [start, end] = saved.isBackward() ? [saved.focus, saved.anchor] : [saved.anchor, saved.focus];
        return createDOMRange(editor, start.getNode(), start.offset, end.getNode(), end.offset);
      });
    } catch {
      range = null;
    }
  }
  if (!range) return null;
  const rect = range.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) return rect;
  // 블록 경계에 걸친 선택은 웹뷰에서 빈 사각형이 나오기도 한다
  return Array.from(range.getClientRects()).find((r) => r.width > 0 || r.height > 0) ?? null;
}

/** 서식 툴바를 잡고 있는 동안 편집기 선택을 잃지 않게(입력칸은 그대로 둔다) */
function keepSelection(e: ReactMouseEvent) {
  if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
}

/**
 * 글자를 고르면 위(자리가 없으면 아래)에 뜨는 서식 툴바 — Notion 처럼
 * 블록 바꾸기 · 굵게 · 기울임 · 밑줄 · 취소선 · 인라인 코드 · 링크 · 색.
 * 편집기 상자(.lex-container) 안에 그리고, .lex-inner 가 스크롤되면 따라간다
 */
export default function FloatingToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  /** 툴바를 그릴 상자(.lex-container) */
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [info, setInfo] = useState<SelectionInfo | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [linkError, setLinkError] = useState(false);

  const barRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<Panel>(null);
  /** 마지막으로 본 서식 가능 선택 — 포커스가 입력칸 · 메뉴로 가도 여기에 되살린다 */
  const savedRef = useRef<RangeSelection | null>(null);
  /** Escape 로 닫은 선택 — 선택이 바뀌기 전까지 다시 열지 않는다 */
  const dismissedRef = useRef<string | null>(null);
  /** 마우스로 끌어 고르는 중이면 놓을 때까지 숨긴다 */
  const draggingRef = useRef(false);
  /** 툴바를 손가락으로 누르는 중(웹뷰는 이때 편집기 포커스가 빠질 수 있다) */
  const touchingRef = useRef(false);
  const lastColorRef = useRef<{ kind: ColorKind; name: ColorName } | null>(null);

  useEffect(() => {
    panelRef.current = panel;
  }, [panel]);

  const openPanel = useCallback((next: Panel) => {
    panelRef.current = next;
    setPanel(next);
    setLinkError(false);
  }, []);

  const refresh = useCallback(() => {
    const root = editor.getRootElement();
    const active = document.activeElement;
    const inBar = active !== null && (barRef.current?.contains(active) ?? false);
    // 링크 입력칸에 포커스가 있으면 지금 모습 그대로
    if (inBar && panelRef.current === "link") return;
    // 메뉴를 손가락으로 스크롤 · 누르는 동안 웹뷰가 편집기 선택을 풀어도 닫지 않는다
    if (touchingRef.current && panelRef.current) return;
    const read = root && editor.isEditable() && !draggingRef.current && (root.contains(active) || inBar) ? editor.getEditorState().read($readSelection) : null;
    if (!read || read.info.sig === dismissedRef.current) {
      if (!read) dismissedRef.current = null;
      setInfo(null);
      openPanel(null);
      return;
    }
    dismissedRef.current = null;
    savedRef.current = read.saved;
    setInfo((prev) => (sameInfo(prev, read.info) ? prev : read.info));
  }, [editor, openPanel]);

  const hide = useCallback(() => {
    setInfo(null);
    openPanel(null);
  }, [openPanel]);

  /** 편집기 선택이 사라졌으면(포커스가 툴바로 간 뒤) 기억해 둔 선택을 되살린다 — editor.update 안에서 */
  const $restore = useCallback((): RangeSelection | null => {
    const selection = $formattable();
    if (selection) return selection;
    const saved = savedRef.current;
    if (!saved || !$getNodeByKey(saved.anchor.key) || !$getNodeByKey(saved.focus.key)) return null;
    const next = saved.clone();
    $setSelection(next);
    return next;
  }, []);

  const toggleFormat = (f: InlineFormat) => {
    editor.update(() => {
      if ($restore()) editor.dispatchCommand(FORMAT_TEXT_COMMAND, f);
    });
  };

  /** 서식 지우기(Notion 의 Tx) — 굵게 · 기울임 · 밑줄 · 취소선 · 코드와 글자/배경 색을 뺀다(링크는 둔다) */
  const clearFormatting = () => {
    editor.update(() => {
      if (!$restore()) return;
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      // extract 는 선택 경계에서 글자 노드를 나눠 선택한 부분만 돌려준다
      for (const node of selection.extract()) {
        if ($isTextNode(node)) {
          node.setFormat(0);
          node.setStyle("");
        }
      }
      selection.format = 0;
      selection.style = "";
    });
  };

  const turnInto = (kind: BlockKind) => {
    openPanel(null);
    editor.update(() => {
      $restore();
    });
    applyBlock(editor, kind);
    editor.focus();
  };

  const applyColor = useCallback(
    (kind: ColorKind, name: ColorName) => {
      let applied = false;
      editor.update(() => {
        const selection = $restore();
        if (!selection) return;
        $applyColor(selection, kind, name);
        applied = true;
      });
      if (applied && name !== "default") lastColorRef.current = { kind, name };
    },
    [editor, $restore],
  );

  const applyLink = (raw: string) => {
    const url = normalizeLinkUrl(raw);
    if (url === false) {
      setLinkError(true);
      return;
    }
    editor.update(() => {
      if ($restore()) editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
    });
    openPanel(null);
    editor.focus();
  };

  const closeLink = () => {
    openPanel(null);
    editor.focus();
  };

  useFormatShortcuts({
    onLink: () => {
      if (!editor.getEditorState().read(() => $formattable() !== null)) return false;
      dismissedRef.current = null;
      refresh();
      openPanel("link");
      return true;
    },
    onRepeatColor: () => {
      if (!editor.getEditorState().read(() => $formattable() !== null)) return false;
      const last = lastColorRef.current;
      if (last) applyColor(last.kind, last.name);
      return true;
    },
  });

  // 툴바를 그릴 상자 · 마우스로 끌어 고르는 동안 숨기기
  useEffect(
    () =>
      editor.registerRootListener((root) => {
        setHost(root ? (root.closest<HTMLElement>(".lex-container") ?? root.parentElement) : null);
        if (!root) return;
        const onUp = () => {
          draggingRef.current = false;
          // 선택이 자리 잡은 뒤에 본다
          setTimeout(refresh, 0);
        };
        const onDown = (e: PointerEvent) => {
          if (e.pointerType !== "mouse" || e.button !== 0) return;
          draggingRef.current = true;
          hide();
          document.addEventListener("pointerup", onUp, { once: true });
        };
        root.addEventListener("pointerdown", onDown);
        return () => {
          root.removeEventListener("pointerdown", onDown);
          document.removeEventListener("pointerup", onUp);
        };
      }),
    [editor, refresh, hide],
  );

  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(() => refresh()),
        editor.registerEditableListener(() => refresh()),
        editor.registerCommand(
          FOCUS_COMMAND,
          () => {
            refresh();
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          BLUR_COMMAND,
          (event) => {
            const to = event.relatedTarget;
            if (to instanceof Node && barRef.current?.contains(to)) return false;
            if (touchingRef.current) return false;
            hide();
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          KEY_ESCAPE_COMMAND,
          (event) => {
            if (!barRef.current) return false;
            event.preventDefault();
            if (panelRef.current) {
              openPanel(null);
              return true;
            }
            dismissedRef.current = editor.getEditorState().read(() => $readSelection()?.info.sig ?? null);
            hide();
            return true;
          },
          COMMAND_PRIORITY_LOW,
        ),
      ),
    [editor, refresh, hide, openPanel],
  );

  /** 위치 잡기 — 상자 기준 좌표로 transform. 선택이 보이는 영역(.lex-inner) 밖으로 나가면 감춘다 */
  const place = useCallback(() => {
    const el = barRef.current;
    const root = editor.getRootElement();
    if (!el || !host || !root) return;
    const rect = selectionRect(editor, root, savedRef.current);
    const view = (root.closest<HTMLElement>(".lex-inner") ?? host).getBoundingClientRect();
    if (!rect || rect.bottom < view.top || rect.top > view.bottom) {
      el.style.visibility = "hidden";
      return;
    }
    el.style.visibility = "";
    const box = host.getBoundingClientRect();
    const bar = (el.firstElementChild as HTMLElement | null) ?? el;
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;
    const above = rect.top - view.top >= h + GAP;
    let top = above ? rect.top - h - GAP : rect.bottom + GAP;
    // 선택이 길어 아래도 넘치면 보이는 영역 안에 붙인다
    top = Math.max(view.top + EDGE, Math.min(top, view.bottom - h - EDGE));
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(box.left + EDGE, Math.min(left, box.right - w - EDGE));
    const x = left - box.left - host.clientLeft;
    const y = top - box.top - host.clientTop;
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    el.dataset.placement = above ? "above" : "below";
    // 패널은 상자 안에서 더 넓은 쪽으로 연다
    const below = box.bottom - (top + h) - EDGE;
    const upper = top - box.top - EDGE;
    const down = below >= PANEL_MIN || below >= upper;
    el.dataset.panel = down ? "down" : "up";
    el.style.setProperty("--lex-ft-max", `${Math.max(120, Math.floor((down ? below : upper) - GAP))}px`);
  }, [editor, host]);

  const shown = host !== null && info !== null;

  useIsoLayoutEffect(() => {
    if (!shown) return;
    place();
    let frame = 0;
    const onMove = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    // 캡처로 걸면 .lex-inner 스크롤도 받는다
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    window.visualViewport?.addEventListener("resize", onMove);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      window.visualViewport?.removeEventListener("resize", onMove);
    };
  }, [shown, info, panel, place]);

  // 터치 — 버튼을 누를 때 기본 동작(포커스 · 선택 이동)을 막고 손을 떼면 누른 것으로 친다.
  // React 의 touchstart 는 passive 라 preventDefault 가 안 먹으니 직접 건다. 스크롤 목록은 그대로 두고 선택은 $restore 로 되살린다
  useEffect(() => {
    const el = barRef.current;
    if (!shown || !el) return;
    let pressed: { x: number; y: number; button: HTMLButtonElement } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onStart = (e: TouchEvent) => {
      clearTimeout(timer);
      touchingRef.current = true;
      const target = e.target instanceof Element ? e.target : null;
      const button = target?.closest("button");
      if (!button || button.disabled || target?.closest("[data-lex-scroll]")) return;
      e.preventDefault();
      const t = e.touches[0];
      pressed = { x: t.clientX, y: t.clientY, button };
    };
    const onEnd = (e: TouchEvent) => {
      timer = setTimeout(() => {
        touchingRef.current = false;
      }, 400);
      const p = pressed;
      pressed = null;
      if (!p) return;
      const t = e.changedTouches[0];
      e.preventDefault();
      if (Math.hypot(t.clientX - p.x, t.clientY - p.y) < 10) p.button.click();
    };
    const onCancel = () => {
      pressed = null;
      touchingRef.current = false;
    };
    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    el.addEventListener("touchcancel", onCancel);
    return () => {
      clearTimeout(timer);
      touchingRef.current = false;
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
    };
  }, [shown]);

  if (!host || !info) return null;

  const blockLabel = BLOCKS.find((b) => b.kind === info.block)?.label ?? "텍스트";
  const toggle = (p: Exclude<Panel, null>) => openPanel(panel === p ? null : p);

  return createPortal(
    <div ref={barRef} className="lex-ft" onMouseDown={keepSelection}>
      <div className="lex-ft-bar" role="toolbar" aria-label="서식">
        <button
          type="button"
          className={"lex-ft-btn lex-ft-block" + (panel === "block" ? " open" : "")}
          onClick={() => toggle("block")}
          aria-haspopup="menu"
          aria-expanded={panel === "block"}
          title="블록 바꾸기"
        >
          <span className="lex-ft-block-label">{blockLabel}</span>
          <Icon name="chevron" size={10} />
        </button>
        <span className="lex-ft-sep" />
        {FORMATS.map(({ format, label, keys }) => {
          const on = info.formats[format];
          return (
            <button
              key={format}
              type="button"
              className={"lex-ft-btn" + (on ? " active" : "")}
              onClick={() => toggleFormat(format)}
              aria-label={label}
              aria-pressed={on}
              title={`${label} (${keys})`}
            >
              <Icon name={format} />
            </button>
          );
        })}
        <button type="button" className="lex-ft-btn lex-ft-clear" onClick={clearFormatting} aria-label="서식 지우기" title="서식 지우기">
          <span className="lex-ft-glyph">
            T<sub>x</sub>
          </span>
        </button>
        <button
          type="button"
          className={"lex-ft-btn" + (info.link !== null ? " active" : "") + (panel === "link" ? " open" : "")}
          onClick={() => toggle("link")}
          aria-label="링크"
          aria-pressed={info.link !== null}
          aria-expanded={panel === "link"}
          title={`링크 (${MOD}K)`}
        >
          <Icon name="link" />
        </button>
        <span className="lex-ft-sep" />
        <button
          type="button"
          className={"lex-ft-btn lex-ft-color" + (panel === "color" ? " open" : "")}
          onClick={() => toggle("color")}
          aria-label="색"
          aria-haspopup="menu"
          aria-expanded={panel === "color"}
          title={`색 (${MOD}${SHIFT}H 마지막 색)`}
        >
          <span
            className="lex-ft-glyph"
            style={{
              color: info.color ? (colorValue("text", info.color) ?? undefined) : undefined,
              backgroundColor: info.bg ? (colorValue("bg", info.bg) ?? undefined) : undefined,
            }}
          >
            A
          </span>
          <Icon name="chevron" size={10} />
        </button>
      </div>

      {panel === "block" ? (
        <div className="lex-ft-panel lex-ft-menu" role="menu" aria-label="블록 바꾸기" data-lex-scroll="">
          <div className="lex-ft-title">바꾸기</div>
          {BLOCKS.filter((b) => b.kind !== "divider" && b.kind !== "image" && b.kind !== "callout").map((b) => (
            <button
              key={b.kind}
              type="button"
              role="menuitemradio"
              aria-checked={info.block === b.kind}
              className={"lex-ft-item" + (info.block === b.kind ? " active" : "")}
              onClick={() => turnInto(b.kind)}
            >
              <span className="lex-ft-item-glyph">{b.glyph}</span>
              <span className="lex-ft-item-label">{b.label}</span>
              {info.block === b.kind ? <span className="lex-ft-check">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {panel === "link" ? (
        <div className="lex-ft-panel lex-ft-link">
          <input
            key={info.sig}
            className={"lex-ft-input" + (linkError ? " error" : "")}
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            defaultValue={info.link ?? ""}
            placeholder="링크 붙여넣기 · 입력"
            aria-label="링크 주소"
            aria-invalid={linkError}
            onChange={() => setLinkError(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                applyLink(e.currentTarget.value);
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeLink();
              }
            }}
            onBlur={(e) => {
              const to = e.relatedTarget;
              if (to instanceof Node && barRef.current?.contains(to)) return;
              openPanel(null);
              // 편집기로 돌아가면 그쪽 선택 변화가 다시 연다
              if (!(to instanceof Node && editor.getRootElement()?.contains(to))) setInfo(null);
            }}
          />
          {info.link !== null ? (
            <button type="button" className="lex-ft-btn" onClick={() => applyLink("")} aria-label="링크 지우기" title="링크 지우기">
              <Icon name="trash" />
            </button>
          ) : null}
          {linkError ? <div className="lex-ft-error">쓸 수 없는 주소예요</div> : null}
        </div>
      ) : null}

      {panel === "color" ? (
        <div className="lex-ft-panel lex-ft-colors" role="menu" aria-label="색">
          {(["text", "bg"] as const).map((kind) => {
            const current = (kind === "text" ? info.color : info.bg) ?? "default";
            return (
              <div key={kind} className="lex-ft-color-group">
                <div className="lex-ft-title">{kind === "text" ? "글자 색" : "배경 색"}</div>
                <div className="lex-ft-swatches">
                  {COLORS.map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      role="menuitemradio"
                      aria-checked={current === c.name}
                      aria-label={`${kind === "text" ? "글자" : "배경"} ${c.label}`}
                      title={c.label}
                      className={`lex-ft-swatch lex-ft-swatch-${kind}` + (current === c.name ? " active" : "")}
                      style={
                        kind === "text"
                          ? { color: colorValue("text", c.name) ?? "var(--lex-text)" }
                          : { backgroundColor: colorValue("bg", c.name) ?? "var(--lex-card)" }
                      }
                      onClick={() => {
                        applyColor(kind, c.name);
                        openPanel(null);
                      }}
                    >
                      A
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>,
    host,
  );
}
