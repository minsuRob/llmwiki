/**
 * 하위 페이지 거르기 · 정렬 — 어떤 주제의 어떤 하위에도 똑같이(공고 500개든 책 메모든). 순수 함수 — 테스트: pageQuery.test.ts
 *
 * 색인만 본다: 제목 · 작은 값(props) · 고친 때(본문은 bodyOf 를 줄 때만 — '본문까지 찾기').
 * - 값 고르기(where): 같은 키 안은 '또는', 키끼리는 '그리고'. 값이 적은 키(enum)만 고르기 칩으로 보인다(facetsOf).
 * - 날짜 키(값이 모두 YYYY-MM-DD 로 시작): from 으로 '이 날 이후만' — 값이 없는 페이지는 남긴다(마감 없음 ≠ 지남).
 * - 정렬: 제목 · 고친 때 · 트리 순서 · 아무 키. 숫자끼리는 수로, 없는 값은 언제나 뒤로.
 * 앱의 펼쳐 보기 · AI 에게 맡기기 · MCP llmwiki_read 가 같은 함수를 부른다.
 */
import type { PageMeta } from "./pages.ts";

export interface PageQuery {
  /** 낱말 모두 — 제목 · 작은 값(· 본문) 어딘가에 */
  text?: string;
  /** 키 → 고른 값들 */
  where?: Record<string, string[]>;
  /** 날짜 키 → 이 날(YYYY-MM-DD) 이후만 */
  from?: Record<string, string>;
  sort?: { key: string; dir: "asc" | "desc" };
}

export type FacetKind = "enum" | "date" | "text";

export interface Facet {
  key: string;
  kind: FacetKind;
  /** 이 키가 있는 페이지 수 */
  count: number;
  /** enum 일 때 값과 수(많은 순) */
  values: { value: string; count: number }[];
}

/** 정렬 키 — props 밖의 것 */
export const BUILTIN_SORT = ["order", "title", "updatedAt"] as const;

const DATE = /^\d{4}-\d{2}-\d{2}/;
const NUM = /^-?\d+(\.\d+)?$/;

/**
 * 거를 수 있는 키 — 값 종류가 maxValues 이하이고 두 페이지 이상이 같은 값을 갖는 키는 enum(칩),
 * 값이 모두 날짜면 date, 나머지는 text(글로만 찾는다). 많이 쓰인 키부터.
 */
export function facetsOf(pages: PageMeta[], maxValues = 20): Facet[] {
  const byKey = new Map<string, Map<string, number>>();
  for (const p of pages)
    for (const [k, v] of Object.entries(p.props ?? {})) {
      const m = byKey.get(k) ?? new Map<string, number>();
      m.set(v, (m.get(v) ?? 0) + 1);
      byKey.set(k, m);
    }
  const out: Facet[] = [];
  for (const [key, m] of byKey) {
    const values = [...m].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    const count = values.reduce((n, v) => n + v.count, 0);
    const kind: FacetKind = values.every((v) => DATE.test(v.value)) ? "date" : values.length <= maxValues && values.some((v) => v.count > 1) ? "enum" : "text";
    out.push({ key, kind, count, values: kind === "enum" ? values : [] });
  }
  return out.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function valueOf(p: PageMeta, key: string): string | undefined {
  if (key === "title") return p.title;
  if (key === "updatedAt") return p.updatedAt;
  if (key === "order") return p.order;
  return p.props?.[key];
}

function compare(a: string | undefined, b: string | undefined): number {
  if (a == null || a === "") return b == null || b === "" ? 0 : 1;
  if (b == null || b === "") return -1;
  if (NUM.test(a) && NUM.test(b)) return Number(a) - Number(b);
  return a.localeCompare(b, "ko");
}

const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);

/** 거르고 정렬한 페이지(입력 순서를 바꾸지 않는다). bodyOf 를 주면 본문까지 찾는다 */
export function queryPages(pages: PageMeta[], q: PageQuery, bodyOf?: (p: PageMeta) => string | undefined): PageMeta[] {
  const ws = words(q.text ?? "");
  const where = Object.entries(q.where ?? {}).filter(([, vs]) => vs.length);
  const from = Object.entries(q.from ?? {}).filter(([, d]) => d);
  const out = pages.filter((p) => {
    for (const [k, vs] of where) if (!vs.includes(p.props?.[k] ?? "")) return false;
    for (const [k, d] of from) {
      const v = p.props?.[k];
      if (v && DATE.test(v) && v.slice(0, 10) < d) return false;
    }
    if (!ws.length) return true;
    const hay = `${p.title}\n${Object.values(p.props ?? {}).join("\n")}\n${bodyOf?.(p) ?? ""}`.toLowerCase();
    return ws.every((w) => hay.includes(w));
  });
  if (!q.sort) return out;
  const { key, dir } = q.sort;
  const sign = dir === "desc" ? -1 : 1;
  return [...out].sort((a, b) => {
    const va = valueOf(a, key);
    const vb = valueOf(b, key);
    // 없는 값은 방향과 상관없이 뒤로
    if (!va && vb) return 1;
    if (va && !vb) return -1;
    return sign * compare(va, vb) || (a.order < b.order ? -1 : a.order > b.order ? 1 : 0);
  });
}

/** MCP · 글로 받은 조건 — "source=groupby,dev=true; career=신입" (같은 키를 여러 번 주면 '또는') */
export function parseWhere(s: string | null | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of String(s ?? "").split(/[,;]/)) {
    const m = /^\s*([^=]+?)\s*=\s*(.+?)\s*$/.exec(part);
    if (m) (out[m[1]] ??= []).push(m[2]);
  }
  return out;
}

/** 조건을 사람이 읽는 한 줄로(묶음 머리 · MCP 답) */
export function describeQuery(q: PageQuery): string {
  const parts = [
    ...Object.entries(q.where ?? {}).filter(([, v]) => v.length).map(([k, v]) => `${k}=${v.join("|")}`),
    ...Object.entries(q.from ?? {}).filter(([, d]) => d).map(([k, d]) => `${k}≥${d}`),
    ...(q.text?.trim() ? [`"${q.text.trim()}"`] : []),
  ];
  return parts.join(" · ");
}

