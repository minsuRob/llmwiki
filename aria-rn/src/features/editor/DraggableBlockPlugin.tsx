import { $isListItemNode } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, $getRoot, $getSelection, $isElementNode, $isRangeSelection, type ElementNode, type LexicalEditor, type NodeKey } from "lexical";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { $isCalloutNode } from "./CalloutExtension";
import { $outlineInsertParagraph, $outlineMoveTo, $readOutline, subtreeEnd } from "./outline";
import { $isToggleContainerNode } from "./ToggleNodes";

/*
 * 블록 왼쪽 + · ⠿ 손잡이(Lexical 놀이터의 DraggableBlockPlugin 을 Notion 실측에 맞춰 다시 짰다).
 * 손잡이는 목록 항목 · 토글 · 콜아웃 안 블록까지 블록마다 그 블록 깊이 바로 왼쪽에 뜬다.
 * 끌면 반투명 사본이 커서를 따라오고, 놓을 자리는 선(시작 위치 = 놓일 깊이)과 대상 블록 배경으로 보인다.
 * 놓을 자리(Notion): 블록 위 절반이면 그 블록 앞(같은 깊이), 아래 절반이면 화면에서 바로 다음 줄 앞(그 줄의 깊이 — 자식이 있으면 첫 자식).
 * 옮기기는 개요 모델(outline.ts)로 — 블록은 자식과 함께, 종류는 그대로
 */

/** 한 깊이의 들여쓰기(px) — editor.css 의 --lexical-indent-base-value · 목록 칸과 같다 */
const INDENT = 32;
/** 손잡이 묶음 너비 · 블록과의 간격 */
const MENU_WIDTH = 44;
const MENU_GAP = 4;
/** 이만큼 움직여야 끌기로 본다(그 전에 떼면 누르기) */
const DRAG_THRESHOLD = 4;
/** 끄는 중 스크롤 영역 위아래 이 안에 오면 스크롤 */
const SCROLL_ZONE = 40;

/** 화면의 블록 한 줄 */
interface Row {
  key: NodeKey;
  scopeKey: NodeKey;
  index: number;
  depth: number;
  /** 같은 범위에서 자식이 끝나는 줄 번호 */
  subEnd: number;
  /** 줄로 보이는 요소(토글은 제목) · 블록 전체 요소 */
  el: HTMLElement;
  host: HTMLElement;
  top: number;
  bottom: number;
  /** 기호 · 들여쓰기를 넣은 블록 왼쪽 */
  left: number;
  /** 안에 다른 줄을 담는 상자(콜아웃) — 아래 절반은 상자 뒤로 */
  box: boolean;
}

interface DropTarget {
  scopeKey: NodeKey;
  index: number;
  depth: number;
  /** 선 자리(화면 좌표) · 배경을 칠할 블록 */
  y: number;
  left: number;
  row: Row;
}

/** 화면에 보이는 블록을 문서 순서로 — 문서 · 열린 토글 안 · 콜아웃 안 */
function $collectRows(editor: LexicalEditor): Row[] {
  const rows: Row[] = [];
  const walk = (scope: ElementNode) => {
    const entries = $readOutline(scope);
    entries.forEach((e, index) => {
      const node = e.node;
      const host = editor.getElementByKey(node.getKey());
      if (!host) return;
      const toggle = $isToggleContainerNode(node);
      const title = toggle ? node.getTitle() : null;
      const el = (title && editor.getElementByKey(title.getKey())) || host;
      const r = el.getBoundingClientRect();
      // 닫힌 토글 안 블록은 그려지지 않는다
      if (r.height === 0) return;
      const marked = $isListItemNode(node) || toggle;
      rows.push({
        key: node.getKey(),
        scopeKey: scope.getKey(),
        index,
        depth: e.depth,
        subEnd: subtreeEnd(entries, index),
        el,
        host,
        top: r.top,
        bottom: r.bottom,
        left: marked ? r.left : r.left + e.depth * INDENT,
        box: $isCalloutNode(node),
      });
      if (toggle && node.getOpen()) {
        const content = node.getContent();
        if (content) walk(content);
      }
      if ($isCalloutNode(node)) walk(node);
    });
  };
  walk($getRoot());
  return rows;
}

/** y 높이의 줄 — 겹치면 안쪽(뒤) 줄, 줄 사이 틈이면 가장 가까운 줄 */
function rowAt(rows: Row[], y: number): Row | null {
  let hit: Row | null = null;
  for (const row of rows) if (y >= row.top && y < row.bottom) hit = row;
  if (hit) return hit;
  let best: Row | null = null;
  let dist = Infinity;
  for (const row of rows) {
    const d = y < row.top ? row.top - y : y - row.bottom;
    if (d < dist) {
      dist = d;
      best = row;
    }
  }
  return best;
}

/** 줄의 자손(같은 범위의 자식 줄 · 안에 담긴 줄)까지 — 배경 · 끌기 제외에 쓴다 */
function descendants(rows: Row[], i: number): Row[] {
  const head = rows[i];
  const out = [head];
  for (let k = i + 1; k < rows.length; k += 1) {
    const row = rows[k];
    const inside = (row.scopeKey === head.scopeKey && row.index < head.subEnd) || out.some((o) => o.host !== row.host && o.host.contains(row.host));
    if (!inside) break;
    out.push(row);
  }
  return out;
}

/** 줄 바로 아래 자리 — 화면에서 다음 줄 앞(그 줄의 깊이), 다음 줄이 없으면 같은 깊이로 뒤 */
function targetAfter(rows: Row[], row: Row): DropTarget {
  const i = rows.indexOf(row);
  let next: Row | undefined;
  for (let k = i + 1; k < rows.length; k += 1) {
    if (row.box && row.host.contains(rows[k].host)) continue;
    next = rows[k];
    break;
  }
  const bottom = row.box ? row.host.getBoundingClientRect().bottom : row.bottom;
  if (next) return { scopeKey: next.scopeKey, index: next.index, depth: next.depth, y: (bottom + next.top) / 2, left: next.left, row };
  return { scopeKey: row.scopeKey, index: row.index + 1, depth: row.depth, y: bottom, left: row.left, row };
}

function targetBefore(rows: Row[], row: Row): DropTarget {
  const i = rows.indexOf(row);
  const prev = rows[i - 1];
  return { scopeKey: row.scopeKey, index: row.index, depth: row.depth, y: prev && prev.bottom <= row.top ? (prev.bottom + row.top) / 2 : row.top, left: row.left, row };
}

/** 끄는 블록의 반투명 사본 — 목록 항목은 기호가 나오게 목록 요소로 싼다 */
function makeGhost(row: Row, root: HTMLElement): HTMLElement {
  const ghost = document.createElement("div");
  ghost.className = "lex-input lex-drag-ghost";
  const copy = row.el.cloneNode(true) as HTMLElement;
  if (row.el.tagName === "LI" && row.el.parentElement) {
    const list = row.el.parentElement.cloneNode(false) as HTMLElement;
    list.appendChild(copy);
    ghost.appendChild(list);
  } else ghost.appendChild(copy);
  root.appendChild(ghost);
  return ghost;
}

const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const GripIcon = () => (
  <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden>
    {[2.5, 7.5].flatMap((x) => [3, 8, 13].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" fill="currentColor" />))}
  </svg>
);

export default function DraggableBlockPlugin() {
  const [editor] = useLexicalComposerContext();
  // 손잡이 · 선 · 배경은 스크롤 영역(.lex-inner) 안에 그려 글과 같이 스크롤된다
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);
  /** 손잡이가 붙은 줄 */
  const hovered = useRef<Row | null>(null);

  useEffect(() => editor.registerRootListener((root) => setAnchor(root?.parentElement ?? null)), [editor]);

  useEffect(() => {
    if (!anchor) return;
    const menu = menuRef.current;
    const line = lineRef.current;
    const shade = shadeRef.current;
    const root = anchor.closest<HTMLElement>(".lex-root");
    if (!menu || !line || !shade || !root) return;

    /** 화면 좌표 → 스크롤 영역 안 좌표 */
    const local = (x: number, y: number) => {
      const r = anchor.getBoundingClientRect();
      return { x: x - r.left + anchor.scrollLeft, y: y - r.top + anchor.scrollTop };
    };
    const contentRight = () => {
      const input = editor.getRootElement();
      if (!input) return 0;
      return input.getBoundingClientRect().right - parseFloat(getComputedStyle(input).paddingRight);
    };
    const rows = () => editor.read(() => $collectRows(editor));

    const hideMenu = () => {
      hovered.current = null;
      menu.classList.remove("visible");
    };
    const showMenu = (row: Row) => {
      hovered.current = row;
      // 첫 줄 가운데에 맞춘다(제목은 줄이 높다)
      const style = getComputedStyle(row.el);
      const lineHeight = parseFloat(style.lineHeight) || 24;
      const y = row.top + parseFloat(style.paddingTop) + (row.box ? 0 : (lineHeight - 24) / 2);
      const p = local(row.left - MENU_WIDTH - MENU_GAP, y);
      menu.style.transform = `translate(${Math.max(0, p.x)}px, ${p.y}px)`;
      menu.classList.add("visible");
    };
    const hideTarget = () => {
      line.classList.remove("visible");
      shade.classList.remove("visible");
    };
    const showTarget = (t: DropTarget, all: Row[]) => {
      const right = contentRight();
      const a = local(t.left, t.y);
      line.style.transform = `translate(${a.x}px, ${a.y - 1.5}px)`;
      line.style.width = `${Math.max(0, right - t.left)}px`;
      line.classList.add("visible");
      const block = descendants(all, all.indexOf(t.row));
      const top = Math.min(...block.map((r) => r.top));
      const bottom = Math.max(...block.map((r) => (r.box ? r.host.getBoundingClientRect().bottom : r.bottom)));
      const b = local(t.row.left - 4, top);
      shade.style.transform = `translate(${b.x}px, ${b.y}px)`;
      shade.style.width = `${Math.max(0, right - t.row.left + 4)}px`;
      shade.style.height = `${bottom - top}px`;
      shade.classList.add("visible");
    };

    // ── 손잡이 띄우기 — 높이로 줄을 고른다(손잡이로 옮겨 가도 같은 줄에 남게)
    let dragging = false;
    const onHover = (event: MouseEvent) => {
      if (dragging || !editor.isEditable()) return;
      if (menu.contains(event.target as Node)) return;
      const row = rowAt(rows(), event.clientY);
      if (row) showMenu(row);
      else hideMenu();
    };
    const onLeave = () => {
      if (!dragging) hideMenu();
    };
    // 글을 치면 Notion 처럼 손잡이를 숨긴다
    const onKey = () => {
      if (!dragging) hideMenu();
    };

    // ── 끌기
    const grip = menu.querySelector<HTMLElement>(".lex-block-grip");
    const onGripDown = (event: MouseEvent) => {
      if (event.button !== 0 || !hovered.current) return;
      event.preventDefault();
      const start = { x: event.clientX, y: event.clientY };
      const source = hovered.current;
      let ghost: HTMLElement | null = null;
      let excluded = new Set<NodeKey>();
      let target: DropTarget | null = null;
      let grabOffset = 0;

      const move = (e: MouseEvent) => {
        if (!dragging) {
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD) return;
          dragging = true;
          const all = rows();
          const head = all.find((r) => r.key === source.key);
          if (!head) return end(false);
          excluded = new Set(descendants(all, all.indexOf(head)).map((r) => r.key));
          ghost = makeGhost(head, root);
          grabOffset = Math.min(start.y - head.top, head.el.getBoundingClientRect().height);
          root.classList.add("lex-dragging");
          menu.classList.remove("visible");
        }
        if (ghost) {
          ghost.style.transform = `translate(${e.clientX + 16}px, ${e.clientY - grabOffset}px)`;
        }
        // 위아래 끝에서 스크롤
        const box = anchor.getBoundingClientRect();
        if (e.clientY < box.top + SCROLL_ZONE) anchor.scrollTop -= 12;
        else if (e.clientY > box.bottom - SCROLL_ZONE) anchor.scrollTop += 12;
        const all = rows();
        const row = rowAt(all, e.clientY);
        // 자기 블록(자식 포함) 위에서는 놓을 자리가 없다
        if (!row || excluded.has(row.key)) {
          target = null;
          return hideTarget();
        }
        const mid = row.box ? (row.top + row.host.getBoundingClientRect().bottom) / 2 : (row.top + row.bottom) / 2;
        target = e.clientY < mid ? targetBefore(all, row) : targetAfter(all, row);
        showTarget(target, all);
      };
      const end = (drop: boolean) => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        document.removeEventListener("keydown", escape, true);
        ghost?.remove();
        root.classList.remove("lex-dragging");
        hideTarget();
        const wasDragging = dragging;
        dragging = false;
        if (!wasDragging) {
          // 누르기만 하면 그 블록 끝으로 커서
          editor.update(() => {
            const node = $getNodeByKey(source.key);
            if ($isElementNode(node)) node.selectEnd();
          });
          editor.focus();
          return;
        }
        if (!drop || !target) return;
        const t = target;
        editor.update(() => {
          const node = $getNodeByKey(source.key);
          const dest = $getNodeByKey(t.scopeKey);
          if (node && $isElementNode(dest)) $outlineMoveTo(node, dest, t.index, t.depth);
        });
      };
      const up = () => end(true);
      const escape = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        target = null;
        end(false);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      document.addEventListener("keydown", escape, true);
    };

    // ── + — 아래(Option/Alt 는 위)에 빈 블록을 넣고 "/" 블록 메뉴를 연다(Notion)
    const plus = menu.querySelector<HTMLElement>(".lex-block-plus");
    const onPlusDown = (event: MouseEvent) => event.preventDefault();
    const onPlus = (event: MouseEvent) => {
      const row = hovered.current;
      if (!row) return;
      const all = rows();
      const fresh = all.find((r) => r.key === row.key) ?? row;
      const t = event.altKey ? targetBefore(all, fresh) : targetAfter(all, fresh);
      editor.focus();
      editor.update(() => {
        const scope = $getNodeByKey(t.scopeKey);
        if (!$isElementNode(scope)) return;
        const paragraph = $outlineInsertParagraph(scope, t.index, t.depth);
        paragraph.select();
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertText("/");
      });
      hideMenu();
    };

    anchor.addEventListener("mousemove", onHover);
    root.addEventListener("mouseleave", onLeave);
    root.addEventListener("keydown", onKey);
    grip?.addEventListener("mousedown", onGripDown);
    plus?.addEventListener("mousedown", onPlusDown);
    plus?.addEventListener("click", onPlus);
    return () => {
      anchor.removeEventListener("mousemove", onHover);
      root.removeEventListener("mouseleave", onLeave);
      root.removeEventListener("keydown", onKey);
      grip?.removeEventListener("mousedown", onGripDown);
      plus?.removeEventListener("mousedown", onPlusDown);
      plus?.removeEventListener("click", onPlus);
    };
  }, [anchor, editor]);

  if (!anchor) return null;
  return createPortal(
    <>
      <div ref={menuRef} className="lex-block-menu">
        <button type="button" className="lex-block-plus" title="클릭해서 아래에 추가 · Option+클릭으로 위에 추가" aria-label="블록 추가">
          <PlusIcon />
        </button>
        <button type="button" className="lex-block-grip" title="드래그해서 옮기기" aria-label="블록 옮기기">
          <GripIcon />
        </button>
      </div>
      <div ref={shadeRef} className="lex-drop-shade" />
      <div ref={lineRef} className="lex-drop-line" />
    </>,
    anchor,
  );
}
