import { $isListItemNode } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, $getRoot, $getSelection, $isElementNode, $isRangeSelection, type ElementNode, type LexicalEditor, type NodeKey } from "lexical";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { $isCalloutNode } from "./CalloutExtension";
import { $outlineInsertParagraph, $outlineMoveTo, $readOutline, MAX_DEPTH, subtreeEnd } from "./outline";
import { $isToggleContainerNode } from "./ToggleNodes";

/*
 * 블록 왼쪽 + · ⠿ 손잡이(Lexical 놀이터의 DraggableBlockPlugin 을 Notion 실측에 맞춰 다시 짰다).
 * 손잡이는 목록 항목 · 토글 · 콜아웃 안 블록까지 블록마다 그 블록 깊이 바로 왼쪽에 뜬다.
 * 끌면 반투명 사본이 커서를 따라오고, 놓을 자리는 선(시작 위치 = 놓일 깊이)과 새 부모 블록 배경으로 보인다.
 * 놓을 자리: 커서 높이로 줄 사이 경계(블록 위 절반 = 그 블록 위, 아래 절반 = 그 블록 아래, 자기 블록 위 = 제자리)를 고르고,
 * 그 경계에 놓일 수 있는 깊이(아래 줄의 부모를 뺏지 않는 깊이 ~ 위 줄의 자식, 토글 · 콜아웃 끝이면 그 밖까지) 가운데
 * 끄는 블록의 가로 위치에 가장 가까운 깊이로 — 왼쪽으로 끌면 내어 쓰고 오른쪽으로 끌면 들여 쓴다.
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
  /** 이 줄이 든 범위를 담은 블록(토글 · 콜아웃) 줄, 문서 바로 아래면 null */
  owner: NodeKey | null;
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
  /** 자식(한 단계 깊은 블록)을 둘 수 있는지 — 제목 · 코드 · 토글 · 콜아웃 · 이미지 · 구분선은 아니다(토글 · 콜아웃은 안에 담는다) */
  nest: boolean;
}

/** 놓을 자리 — 범위의 index 줄 앞, depth 깊이. left 는 그 깊이의 화면 왼쪽 */
interface Slot {
  scopeKey: NodeKey;
  index: number;
  depth: number;
  left: number;
}

/** 화면에 보이는 블록을 문서 순서로 — 문서 · 열린 토글 안 · 콜아웃 안 */
function $collectRows(editor: LexicalEditor): Row[] {
  const rows: Row[] = [];
  const walk = (scope: ElementNode, owner: NodeKey | null) => {
    const entries = $readOutline(scope);
    entries.forEach((e, index) => {
      const node = e.node;
      const host = editor.getElementByKey(node.getKey());
      if (!host) return;
      const toggle = $isToggleContainerNode(node);
      const callout = $isCalloutNode(node);
      const title = toggle ? node.getTitle() : null;
      const el = (title && editor.getElementByKey(title.getKey())) || host;
      const r = el.getBoundingClientRect();
      // 닫힌 토글 안 블록은 그려지지 않는다
      if (r.height === 0) return;
      const marked = $isListItemNode(node) || toggle;
      rows.push({
        key: node.getKey(),
        scopeKey: scope.getKey(),
        owner,
        index,
        depth: e.depth,
        subEnd: subtreeEnd(entries, index),
        el,
        host,
        top: r.top,
        bottom: r.bottom,
        left: marked ? r.left : r.left + e.depth * INDENT,
        box: callout,
        nest: $isElementNode(node) && !node.isInline() && !toggle && !callout && !["heading", "code"].includes(node.getType()),
      });
      if (toggle && node.getOpen()) {
        const content = node.getContent();
        if (content) walk(content, node.getKey());
      }
      if (callout) walk(node, node.getKey());
    });
  };
  walk($getRoot(), null);
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

/** 줄 아래 끝 — 콜아웃은 상자 끝 */
const bottomOf = (row: Row) => (row.box ? row.host.getBoundingClientRect().bottom : row.bottom);

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

/** 범위 안 depth 깊이의 화면 왼쪽 — 같은 범위 줄 하나를 기준으로 */
const slot = (ref: Row, scopeKey: NodeKey, index: number, depth: number): Slot => ({ scopeKey, index, depth, left: ref.left + (depth - ref.depth) * INDENT });

/**
 * 위 줄 p 와 아래 줄 n 사이에 놓을 수 있는 자리들(깊이마다 하나).
 * 같은 범위면 n 의 깊이(n 의 부모를 뺏지 않게) ~ p 의 자식 깊이. p 가 범위 끝이면 그 범위 끝 자리들과
 * 범위를 담은 토글 · 콜아웃 뒤 자리들도 — n 이 있는 범위까지 밖으로 올라간다
 */
function slotsBetween(rows: Row[], p: Row | null, n: Row | null): Slot[] {
  const out: Slot[] = [];
  const span = (ref: Row, scopeKey: NodeKey, index: number, lo: number, hi: number) => {
    for (let d = lo; d <= Math.max(lo, Math.min(hi, MAX_DEPTH)); d += 1) out.push(slot(ref, scopeKey, index, d));
  };
  if (!p) {
    if (n) span(n, n.scopeKey, n.index, n.depth, n.depth);
    return out;
  }
  // 토글 제목 · 콜아웃 바로 아래(그 안 첫 블록 앞) — 그 안 맨 위뿐
  if (n && p.host !== n.host && p.host.contains(n.host)) {
    span(n, n.scopeKey, n.index, n.depth, n.depth);
    return out;
  }
  let cur: Row | undefined = p;
  let nest = p.nest;
  while (cur) {
    const hi = cur.depth + (nest ? 1 : 0);
    if (n && cur.scopeKey === n.scopeKey) {
      span(cur, n.scopeKey, n.index, n.depth, hi);
      break;
    }
    span(cur, cur.scopeKey, cur.index + 1, 0, hi);
    const owner: NodeKey | null = cur.owner;
    cur = owner ? rows.find((r) => r.key === owner) : undefined;
    nest = false;
  }
  return out;
}

/** 놓을 자리의 새 부모 줄(배경을 칠할 블록) — 깊이 0 이면 범위를 담은 토글 · 콜아웃, 문서 바로 아래면 없음 */
function parentOf(rows: Row[], s: Slot, skip: Set<NodeKey>): Row | null {
  const inScope = rows.filter((r) => r.scopeKey === s.scopeKey && r.index < s.index && !skip.has(r.key));
  if (s.depth === 0) {
    const owner = rows.find((r) => r.scopeKey === s.scopeKey)?.owner;
    return owner ? (rows.find((r) => r.key === owner) ?? null) : null;
  }
  for (let k = inScope.length - 1; k >= 0; k -= 1) {
    if (inScope[k].depth === s.depth - 1) return inScope[k];
    if (inScope[k].depth < s.depth - 1) break;
  }
  return null;
}

/** 줄 바로 아래 자리(+ 단추) — 화면에서 다음 줄 앞(그 줄의 깊이), 다음 줄이 없으면 같은 깊이로 뒤 */
function slotAfter(rows: Row[], row: Row): Slot {
  const i = rows.indexOf(row);
  const next = rows.slice(i + 1).find((r) => !(row.box && row.host.contains(r.host)));
  return next ? slot(next, next.scopeKey, next.index, next.depth) : slot(row, row.scopeKey, row.index + 1, row.depth);
}

const slotBefore = (row: Row): Slot => slot(row, row.scopeKey, row.index, row.depth);

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
    const showTarget = (s: Slot, y: number, parent: Row | null, all: Row[]) => {
      const right = contentRight();
      const a = local(s.left, y);
      line.style.transform = `translate(${a.x}px, ${a.y - 1.5}px)`;
      line.style.width = `${Math.max(0, right - s.left)}px`;
      line.classList.add("visible");
      if (!parent) {
        shade.classList.remove("visible");
        return;
      }
      const block = descendants(all, all.indexOf(parent));
      const top = Math.min(...block.map((r) => r.top));
      const bottom = Math.max(y, ...block.map(bottomOf));
      const b = local(parent.left - 4, top);
      shade.style.transform = `translate(${b.x}px, ${b.y}px)`;
      shade.style.width = `${Math.max(0, right - parent.left + 4)}px`;
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
      let target: Slot | null = null;
      let grabOffset = 0;
      /** 커서 → 끄는 블록 왼쪽(가로로 깊이를 고르는 기준) */
      let grabLeft = 0;

      /** 커서 높이의 줄 사이 경계 — 위 줄 · 아래 줄(끄는 블록은 빼고) · 선 높이 */
      const boundary = (all: Row[], y: number): { p: Row | null; n: Row | null; y: number } | null => {
        const hit = rowAt(all, y);
        if (!hit) return null;
        const live = (r: Row) => !excluded.has(r.key);
        const i = all.indexOf(hit);
        const before = (k: number) => {
          for (let j = k - 1; j >= 0; j -= 1) if (live(all[j])) return all[j];
          return null;
        };
        const after = (k: number, box?: Row) => {
          for (let j = k + 1; j < all.length; j += 1) {
            const r = all[j];
            if (!live(r) || (box && box.host !== r.host && box.host.contains(r.host))) continue;
            return r;
          }
          return null;
        };
        // 자기 블록 위 — 제자리 경계(가로로 깊이만 바꿀 수 있다)
        if (!live(hit)) {
          let first = i;
          while (first > 0 && !live(all[first - 1])) first -= 1;
          let last = i;
          while (last < all.length - 1 && !live(all[last + 1])) last += 1;
          return { p: before(first), n: after(last), y: all[first].top };
        }
        const bottom = bottomOf(hit);
        if (y < (hit.top + bottom) / 2) {
          const p = before(i);
          return { p, n: hit, y: p && bottomOf(p) <= hit.top ? (bottomOf(p) + hit.top) / 2 : hit.top };
        }
        const n = after(i, hit.box ? hit : undefined);
        return { p: hit, n, y: n ? (bottom + n.top) / 2 : bottom };
      };

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
          grabLeft = head.left - start.x;
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
        const edge = boundary(all, e.clientY);
        const slots = edge ? slotsBetween(all, edge.p, edge.n) : [];
        if (!edge || slots.length === 0) {
          target = null;
          return hideTarget();
        }
        // 끄는 블록 왼쪽에 가장 가까운 깊이
        const left = e.clientX + grabLeft;
        target = slots.reduce((best, s) => (Math.abs(s.left - left) < Math.abs(best.left - left) ? s : best));
        showTarget(target, edge.y, parentOf(all, target, excluded), all);
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
      const t = event.altKey ? slotBefore(fresh) : slotAfter(all, fresh);
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
