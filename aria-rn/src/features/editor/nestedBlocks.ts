import {
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  $isElementNode,
  $isTextNode,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type PointType,
} from "lexical";

/*
 * 토글 · 콜아웃이 함께 쓰는 도구 — 커서 위치 판단, 인라인 감싸기, 블록 앞머리(▸ · 이모지) 누르기
 */

/** 노드 안 가장 깊은 첫 · 끝 자리 */
function $edgeLeaf(node: LexicalNode, end: boolean): LexicalNode {
  let cur = node;
  while ($isElementNode(cur)) {
    const next: LexicalNode | null = end ? cur.getLastChild() : cur.getFirstChild();
    if (!next) break;
    cur = next;
  }
  return cur;
}

/** 점이 노드 맨 앞인지 */
export function $isPointAtStart(point: PointType, node: LexicalNode): boolean {
  const leaf = $edgeLeaf(node, false);
  if (point.key === leaf.getKey()) return point.offset === 0;
  const parent = leaf.getParent();
  return point.type === "element" && !$isElementNode(leaf) && point.key === parent?.getKey() && point.offset === 0;
}

/** 점이 노드 맨 끝인지 */
export function $isPointAtEnd(point: PointType, node: LexicalNode): boolean {
  const leaf = $edgeLeaf(node, true);
  if (point.key === leaf.getKey()) {
    if ($isTextNode(leaf)) return point.offset === leaf.getTextContentSize();
    if ($isElementNode(leaf)) return point.offset === leaf.getChildrenSize();
    return false;
  }
  const parent = leaf.getParent();
  return point.type === "element" && !$isElementNode(leaf) && point.key === parent?.getKey() && point.offset === parent.getChildrenSize();
}

/** 블록만 담아야 하는 노드에 글(인라인)이 바로 들어오면 이어진 것끼리 문단으로 감싼다(붙여넣기 등) */
export function $wrapInlineChildren(node: ElementNode): void {
  let group: ElementNode | null = null;
  for (const child of node.getChildren()) {
    if (!child.isInline()) {
      group = null;
      continue;
    }
    if (!group) {
      group = $createParagraphNode();
      child.insertBefore(group);
    }
    group.append(child);
  }
}

export interface TapZone {
  /** 블록 DOM 을 고르는 CSS 선택자(예: ".lex-toggle-title") */
  selector: string;
  /** 누른 자리가 앞머리 안인지 — 블록 DOM 기준 좌표(px) */
  hit: (x: number, y: number, el: HTMLElement) => boolean;
  /** 편집기 update 안에서 그 블록 노드로 할 일 */
  $onTap: (node: LexicalNode) => void;
}

/** 손가락이 이만큼 넘게 움직이면 누르기가 아니라 스크롤 */
const TAP_SLOP = 10;

/**
 * 블록 앞머리(CSS ::before · ::after 로 그린 ▸ · 이모지) 누르기.
 * 터치는 touchend 에서 처리하고 기본 동작을 막아 커서 이동 · 키보드가 뜨지 않게, 마우스는 mousedown 을 막고 click 에서
 */
export function registerTapZone(editor: LexicalEditor, zone: TapZone): () => void {
  return editor.registerRootListener((root) => {
    if (!root) return;
    let touchStart: { x: number; y: number } | null = null;

    const targetOf = (target: EventTarget | null, x: number, y: number): HTMLElement | null => {
      if (!(target instanceof Element)) return null;
      const el = target.closest<HTMLElement>(zone.selector);
      if (!el || !root.contains(el)) return null;
      const rect = el.getBoundingClientRect();
      return zone.hit(x - rect.left, y - rect.top, el) ? el : null;
    };
    const tap = (el: HTMLElement) => {
      editor.update(() => {
        const node = $getNearestNodeFromDOMNode(el);
        if (node) zone.$onTap(node);
      });
    };

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      touchStart = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      const start = touchStart;
      touchStart = null;
      if (!t || !start || Math.hypot(t.clientX - start.x, t.clientY - start.y) > TAP_SLOP) return;
      const el = targetOf(e.target, t.clientX, t.clientY);
      if (!el) return;
      e.preventDefault();
      tap(el);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0 && targetOf(e.target, e.clientX, e.clientY)) e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const el = targetOf(e.target, e.clientX, e.clientY);
      if (!el) return;
      e.preventDefault();
      tap(el);
    };

    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchend", onTouchEnd, { passive: false });
    root.addEventListener("mousedown", onMouseDown);
    root.addEventListener("click", onClick);
    return () => {
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("mousedown", onMouseDown);
      root.removeEventListener("click", onClick);
    };
  });
}
