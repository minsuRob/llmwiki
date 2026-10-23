import { $isListItemNode } from "@lexical/list";
import { $getRoot, $isElementNode, type ElementNode, type LexicalEditor, type NodeKey } from "lexical";

import { $isCalloutNode } from "./CalloutExtension";
import { $readOutline, subtreeEnd } from "./outline";
import { $isToggleContainerNode } from "./ToggleNodes";

/* 화면의 블록 줄 — 손잡이 · 끌어 옮기기(DraggableBlockPlugin) · 블록 선택(BlockSelectionPlugin)이 같이 쓴다 */

/** 한 깊이의 들여쓰기(px) — editor.css 의 --lexical-indent-base-value · 목록 칸과 같다 */
export const INDENT = 32;

/** 화면의 블록 한 줄 */
export interface Row {
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

/** 화면에 보이는 블록을 문서 순서로 — 문서 · 열린 토글 안 · 콜아웃 안 */
export function $collectRows(editor: LexicalEditor): Row[] {
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
export function rowAt(rows: Row[], y: number): Row | null {
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
export const bottomOf = (row: Row) => (row.box ? row.host.getBoundingClientRect().bottom : row.bottom);

/** 줄의 자손(같은 범위의 자식 줄 · 안에 담긴 줄)까지 — 배경 · 끌기 제외에 쓴다 */
export function descendants(rows: Row[], i: number): Row[] {
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
