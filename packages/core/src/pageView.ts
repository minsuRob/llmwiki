/**
 * 목록 보기 — 소주제(하위가 있는 페이지)의 하위를 한 줄씩 볼 때 어떤 칸을 어떻게 보일지. 테스트: pageView.test.ts
 *
 * 칸 이름은 정해 두지 않는다(구인 · 독서 · 리서치 무엇이든). 정해 둔 것은 칸의 종류 다섯뿐이다:
 *   status 상태(값 몇 개 — 칩) · date 날짜(정렬 · 지난 것) · tag 분류 · flag 표시(참일 때만 이름이 꼬리표로) · text 글.
 * - 보기는 소주제 페이지의 색인(PageMeta.view)에 둔다. 없으면 하위의 값 모양으로 짐작한다(guessView).
 * - AI 는 주제 이름과 하위를 보고 '보기 제안'을 낸다 — 칸(columns)과, 필요하면 하위마다 채울 값(values).
 *   요약(summary)도 낸다 — 하위를 세는 말(unit: 구인 · 팁 …)과 전체를 2~3줄로(마크다운 — 앱은 편집기 뷰어로 그린다). 오늘 탭은 목록 대신 '개수 + 요약'만 보인다.
 *   요약한 때의 하위 수를 적어 두어, 그 뒤 하위가 늘거나 줄면 '요약 뒤 바뀜'을 보인다.
 *   MCP llmwiki_propose_view · 페이지 넘기기 결과(view · props)가 같은 함수(proposeView)를 부른다.
 *   검사: 페이지가 있고 살아 있어야, 묶음 범주 안이어야(cross_workspace), 값은 그 페이지의 하위에만, 지시문은 표시.
 * - 받기 · 빼기는 사람만(applyViewProposal · decideViewProposal). 받으면 보기가 바뀌고 하위 속성에 값이 더해진다.
 */
import { hashText } from "./hash.ts";
import { scanInjection } from "./inject.ts";
import { facetsOf } from "./pageQuery.ts";
import { childrenOf, pageOf, type BodyFlag, type PageMeta, type PageState } from "./pages.ts";
import { newId } from "./types.ts";
import type { AiTool, WorkManifest } from "./work.ts";

export const COLUMN_KINDS = ["status", "date", "tag", "flag", "text"] as const;
export type ColumnKind = (typeof COLUMN_KINDS)[number];

export interface ViewColumn {
  /** 하위 속성(props)의 키 */
  key: string;
  /** 보일 이름 — 없으면 key */
  label: string;
  kind: ColumnKind;
}

export interface ViewSummary {
  /** 전체 요약 2~3줄 */
  text: string;
  /** 하위를 세는 말(구인 · 팁 · 자료) — 없으면 '하위' */
  unit?: string | null;
  /** 요약할 때의 하위 수 */
  count: number;
  at: string;
}

export interface PageView {
  columns: ViewColumn[];
  summary?: ViewSummary | null;
  /** 누가 정했나 — ai: AI 제안을 사람이 받음 · human: 사람이 고침 */
  by: "ai" | "human";
  at: string;
}

export interface ViewProposal {
  id: string;
  /** 소주제 페이지 */
  pageId: string;
  workspaceId: string;
  /** 새 보기(없으면 값만 채우는 제안) */
  columns?: ViewColumn[] | null;
  /** 새 요약 — 제안할 때의 하위 수와 함께 */
  summary?: { text: string; unit?: string | null; count: number } | null;
  /** 하위 페이지 id → 더할 속성. 정하면 비운다(매니페스트를 가볍게) */
  values: Record<string, Record<string, string>>;
  /** 값을 낸 하위 수(정한 뒤에도 남는다) */
  valueCount: number;
  note?: string;
  flags?: BodyFlag[];
  tool: AiTool;
  runId?: string | null;
  /** 같은 제안을 두 번 들이지 않게 */
  hash: string;
  status: "open" | "accepted" | "rejected";
  createdAt: string;
  decidedAt?: string | null;
}

const MAX_COLUMNS = 8;
const MAX_KEY = 40;
const MAX_LABEL = 30;
const MAX_VALUE = 200;
const MAX_VALUE_PAGES = 600;
const MAX_DECIDED = 50;
const MAX_SUMMARY = 800;
const MAX_UNIT = 12;

/* ───────────────────────── 값 모양 ───────────────────────── */

const TRUE = new Set(["true", "yes", "y", "1", "o", "예", "네", "있음", "✓", "✔"]);
const FALSE = new Set(["false", "no", "n", "0", "x", "아니오", "아니요", "없음"]);
const lower = (v: string) => v.trim().toLowerCase();
export const isTruthy = (v: string | undefined) => !!v && TRUE.has(lower(v));
const isBool = (v: string) => TRUE.has(lower(v)) || FALSE.has(lower(v));

/**
 * 보기가 없을 때 — 하위 값 모양으로 칸을 짐작한다. 순서: 상태 · 날짜 · 분류 · 표시 · 글.
 * 모두 같은 값인 키 · 제목에 이미 들어 있는 값(회사 이름 등) · 긴 글은 한 줄에 넣지 않는다.
 */
export function guessView(children: PageMeta[]): ViewColumn[] {
  const n = children.length;
  if (!n) return [];
  const picked: Record<ColumnKind, ViewColumn[]> = { status: [], date: [], tag: [], flag: [], text: [] };
  for (const f of facetsOf(children)) {
    const withKey = children.filter((p) => p.props?.[f.key]?.trim());
    const vals = withKey.map((p) => p.props![f.key].trim());
    const distinct = new Set(vals);
    const col = (kind: ColumnKind): ViewColumn => ({ key: f.key, label: f.key, kind });
    if (vals.every(isBool)) {
      if (vals.some((v) => isTruthy(v)) && vals.some((v) => !isTruthy(v))) picked.flag.push(col("flag"));
      continue;
    }
    if (distinct.size === 1 && withKey.length === n) continue;
    const inTitle = withKey.filter((p) => p.title.toLowerCase().includes(p.props![f.key].trim().toLowerCase())).length;
    if (inTitle >= withKey.length * 0.8) continue;
    if (f.kind === "date") picked.date.push(col("date"));
    else if (f.kind === "enum") picked[distinct.size <= 6 ? "status" : "tag"].push(col(distinct.size <= 6 ? "status" : "tag"));
    else if (vals.reduce((s, v) => s + v.length, 0) / vals.length <= 40) picked.text.push(col("text"));
  }
  return [...picked.status.slice(0, 1), ...picked.date.slice(0, 1), ...picked.tag.slice(0, 2), ...picked.flag.slice(0, 3), ...picked.text.slice(0, 1)];
}

/** 이 소주제의 칸 — 정한 보기가 있으면 그것, 없으면 짐작 */
export function viewOf(page: PageMeta, children: PageMeta[]): { columns: ViewColumn[]; guessed: boolean } {
  return page.view?.columns?.length ? { columns: page.view.columns, guessed: false } : { columns: guessView(children), guessed: true };
}

export interface RowCell {
  key: string;
  kind: ColumnKind;
  /** 보일 글 — 표시(flag)는 칸 이름 */
  text: string;
}

/** 한 줄의 칸 — 칸 순서로, 빈 값 · 거짓 표시는 건너뛴다 */
export function rowCells(p: PageMeta, columns: ViewColumn[]): RowCell[] {
  const out: RowCell[] = [];
  for (const c of columns) {
    const v = p.props?.[c.key]?.trim();
    if (!v) continue;
    if (c.kind === "flag") {
      if (isTruthy(v)) out.push({ key: c.key, kind: "flag", text: c.label || c.key });
    } else out.push({ key: c.key, kind: c.kind, text: v });
  }
  return out;
}

/* ───────────────────────── 오늘 개요 ───────────────────────── */

export interface OverviewGroup {
  /** 범주 맨 위 페이지(소주제) */
  page: PageMeta;
  /** 그 하위(트리 순서) */
  children: PageMeta[];
  columns: ViewColumn[];
  /** 정한 보기가 없어 짐작한 칸인가 */
  guessed: boolean;
}

/**
 * 오늘 개요 — 범주의 맨 위 페이지마다 하위와 칸. 하위 없는 맨 위 페이지는 loose 로(트리 순서).
 * 하위가 없어도 칸을 정했거나 보기 제안이 열린 페이지(withProposal)는 카드로 — 데이터가 들어오기 전에도 모양을 정한다.
 */
export function overviewOf(pages: PageMeta[], workspaceId: string, withProposal: ReadonlySet<string> = new Set()): { groups: OverviewGroup[]; loose: PageMeta[] } {
  const groups: OverviewGroup[] = [];
  const loose: PageMeta[] = [];
  for (const page of childrenOf(pages, workspaceId, null)) {
    const children = childrenOf(pages, workspaceId, page.id);
    if (!children.length && !page.view?.columns?.length && !page.view?.summary && !withProposal.has(page.id)) loose.push(page);
    else groups.push({ page, children, ...viewOf(page, children) });
  }
  return { groups, loose };
}

/* ───────────────────────── 사람이 정하기 ───────────────────────── */

export function cleanColumns(raw: unknown): ViewColumn[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ViewColumn[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const key = String(o.key ?? "").trim().slice(0, MAX_KEY);
    if (!key || seen.has(key)) continue;
    const kind = (COLUMN_KINDS as readonly string[]).includes(String(o.kind)) ? (o.kind as ColumnKind) : "text";
    seen.add(key);
    out.push({ key, label: String(o.label ?? "").trim().slice(0, MAX_LABEL) || key, kind });
    if (out.length >= MAX_COLUMNS) break;
  }
  return out;
}

/** 보기를 바꾼다(null 이면 지워서 짐작으로) — 사람이 고칠 때 */
export function setPageView(pages: PageMeta[], id: string, columns: ViewColumn[] | null, nowIso: string, by: PageView["by"] = "human"): PageMeta[] {
  return pages.map((p) => {
    if (p.id !== id) return p;
    const cols = columns?.length ? cleanColumns(columns) : [];
    const view: PageView | null = cols.length || p.view?.summary ? { columns: cols, ...(p.view?.summary ? { summary: p.view.summary } : {}), by, at: nowIso } : null;
    return { ...p, view, rev: p.rev + 1, updatedAt: nowIso };
  });
}

/** 개수 + 요약 — 오늘 탭 카드. stale: 요약한 뒤 하위 수가 바뀌었다 */
export function summaryOf(page: PageMeta, children: PageMeta[]): { count: number; unit: string | null; text: string | null; stale: boolean } {
  const s = page.view?.summary;
  return { count: children.length, unit: s?.unit ?? null, text: s?.text ?? null, stale: !!s && s.count !== children.length };
}

/* ───────────────────────── AI 보기 제안 ───────────────────────── */

export type ViewSkip = "unknown_page" | "trashed" | "private" | "cross_workspace" | "empty" | "duplicate";

export interface ViewInput {
  pageId: string;
  columns?: unknown;
  /** 전체 요약 2~3줄 · 하위를 세는 말 */
  summary?: string | null;
  unit?: string | null;
  /** 하위 페이지 id → 속성 */
  values?: Record<string, Record<string, unknown>> | null;
  note?: string;
  tool: AiTool;
  runId?: string | null;
  flags?: BodyFlag[];
}

export const openViewProposals = (m: WorkManifest, pageId?: string | null): ViewProposal[] => (m.viewProposals ?? []).filter((p) => p.status === "open" && (!pageId || p.pageId === pageId));

function prune(list: ViewProposal[]): ViewProposal[] {
  const decided = list.filter((p) => p.status !== "open").sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? "")).slice(0, MAX_DECIDED);
  const keep = new Set(decided.map((p) => p.id));
  return list.filter((p) => p.status === "open" || keep.has(p.id));
}

/** 보기 제안을 들인다 — 저장은 부르는 쪽이. 하위가 아닌 페이지의 값은 버리고 bad_refs 로 표시 */
export function proposeView(
  state: PageState,
  input: ViewInput,
  nowIso: string,
  opts: { includePrivate?: boolean; workspaceId?: string | null } = {},
): { kind: "ok"; manifest: WorkManifest; proposal: ViewProposal } | { kind: "skipped"; reason: ViewSkip } {
  const page = pageOf(state.pages, input.pageId);
  if (!page) return { kind: "skipped", reason: "unknown_page" };
  if (page.trashedAt) return { kind: "skipped", reason: "trashed" };
  if (opts.workspaceId && page.workspaceId !== opts.workspaceId) return { kind: "skipped", reason: "cross_workspace" };
  const ws = state.manifest.workspaces.find((w) => w.id === page.workspaceId);
  if (ws?.private && !opts.includePrivate) return { kind: "skipped", reason: "private" };

  const columns = cleanColumns(input.columns);
  const kids = new Set(childrenOf(state.pages, page.workspaceId, page.id).map((k) => k.id));
  const values: Record<string, Record<string, string>> = {};
  let outside = 0;
  for (const [id, props] of Object.entries(input.values ?? {})) {
    if (!kids.has(id)) {
      outside++;
      continue;
    }
    if (Object.keys(values).length >= MAX_VALUE_PAGES || !props || typeof props !== "object") continue;
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(props)) {
      const key = k.trim().slice(0, MAX_KEY);
      if (key && v != null && typeof v !== "object") clean[key] = String(v).trim().slice(0, MAX_VALUE);
    }
    if (Object.keys(clean).length) values[id] = clean;
  }
  const valueCount = Object.keys(values).length;
  // 요약은 마크다운(편집기 규칙 — 글머리 · **굵게**) — 줄 끝 공백 · 3줄 넘는 빈 줄만 정리하고 들여쓰기는 둔다
  const summaryText = String(input.summary ?? "").replace(/\r/g, "").split("\n").map((l) => l.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_SUMMARY);
  const unit = String(input.unit ?? "").trim().slice(0, MAX_UNIT) || null;
  const summary = summaryText ? { text: summaryText, unit, count: kids.size } : null;
  if (!columns.length && !valueCount && !summary) return { kind: "skipped", reason: "empty" };

  const note = (input.note ?? "").trim().slice(0, 1000);
  const hash = hashText(JSON.stringify([page.id, columns, values, summary]));
  if (openViewProposals(state.manifest, page.id).some((p) => p.hash === hash)) return { kind: "skipped", reason: "duplicate" };
  const text = [note, summary?.text ?? "", unit ?? "", ...columns.map((c) => c.label), ...Object.values(values).flatMap((v) => Object.values(v))].join("\n");
  const flags = [...new Set([...(input.flags ?? []), ...(outside ? (["bad_refs"] as BodyFlag[]) : []), ...(scanInjection(text).length ? (["injection_suspect"] as BodyFlag[]) : [])])].sort();
  const proposal: ViewProposal = {
    id: newId(),
    pageId: page.id,
    workspaceId: page.workspaceId,
    columns: columns.length ? columns : null,
    ...(summary ? { summary } : {}),
    values,
    valueCount,
    ...(note ? { note } : {}),
    ...(flags.length ? { flags } : {}),
    tool: input.tool,
    runId: input.runId ?? null,
    hash,
    status: "open",
    createdAt: nowIso,
  };
  return { kind: "ok", manifest: { ...state.manifest, viewProposals: prune([...(state.manifest.viewProposals ?? []), proposal]) }, proposal };
}

/**
 * 받은 제안을 색인에 얹는다 — 사람만. 최신 색인에 다시 얹혀도 같은 결과(commitPages 의 fn).
 * 칸이 있으면 보기를 바꾸고, 지금도 그 페이지의 하위인 것에만 값을 더한다(있는 값은 덮고, 빈 값은 지운다).
 */
export function applyViewProposal(pages: PageMeta[], p: ViewProposal, nowIso: string): { pages: PageMeta[]; changed: number } {
  const page = pageOf(pages, p.pageId);
  if (!page || page.trashedAt) return { pages, changed: 0 };
  let next = pages;
  if (p.columns?.length || p.summary) {
    const cur = page.view;
    const view: PageView = {
      columns: p.columns?.length ? p.columns : (cur?.columns ?? []),
      ...(p.summary ? { summary: { ...p.summary, at: nowIso } } : cur?.summary ? { summary: cur.summary } : {}),
      by: "ai",
      at: nowIso,
    };
    next = pages.map((x) => (x.id === page.id ? { ...x, view, rev: x.rev + 1, updatedAt: nowIso } : x));
  }
  const kids = new Set(childrenOf(next, page.workspaceId, page.id).map((k) => k.id));
  let changed = 0;
  next = next.map((k) => {
    const add = kids.has(k.id) ? p.values[k.id] : undefined;
    if (!add) return k;
    const props: Record<string, string> = { ...(k.props ?? {}) };
    for (const [key, v] of Object.entries(add)) {
      if (v.trim()) props[key] = v;
      else delete props[key];
    }
    if (JSON.stringify(props) === JSON.stringify(k.props ?? {})) return k;
    changed++;
    return { ...k, props: Object.keys(props).length ? props : undefined, rev: k.rev + 1, updatedAt: nowIso };
  });
  return { pages: next, changed };
}

/** 받기 · 빼기를 매니페스트에 적는다(값은 비운다) */
export function decideViewProposal(manifest: WorkManifest, id: string, status: "accepted" | "rejected", nowIso: string): WorkManifest {
  const viewProposals = (manifest.viewProposals ?? []).map((x) => (x.id === id && x.status === "open" ? { ...x, status, decidedAt: nowIso, values: {} } : x));
  return { ...manifest, viewProposals: prune(viewProposals) };
}

/** 다른 쪽 최신 매니페스트에 합친다 — 같은 id 는 정한 쪽이 이긴다 */
export function mergeViewProposals(cur: WorkManifest, mine: WorkManifest): WorkManifest {
  const byId = new Map((cur.viewProposals ?? []).map((p) => [p.id, p]));
  for (const p of mine.viewProposals ?? []) {
    const c = byId.get(p.id);
    if (!c || (c.status === "open" && p.status !== "open")) byId.set(p.id, p);
  }
  return { ...cur, viewProposals: prune([...byId.values()]) };
}
