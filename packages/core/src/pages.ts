/**
 * 페이지 트리(스키마 3) — 노션처럼 범주 아래 페이지, 페이지 아래 페이지. 본문은 마크다운 하나(정본). 순수 함수.
 *
 * 나눠 두는 것
 * - 색인(PageMeta): 트리 · 제목 · 순서 · 본문 지문(bodyHash)만. 범주마다 파일 하나(state/index/{범주}.json) — 500쪽이어도 이것만 읽으면 트리가 선다.
 * - 문서(PageDoc): 본문 · 이어 둔 자료 · 되돌리기 기록. 사람이 만들거나 고친 페이지는 state/pages/{id}.json,
 *   가져온 페이지는 묶음(state/packs/{packId}.json) 속에 있다가 처음 고칠 때 제 파일로 옮긴다(bodyRef).
 *
 * 원칙
 * - AI 는 '본문 제안' 하나만 낸다(proposeBody). 받기 · 빼기 · 옮기기 · 휴지통 · 되살리기는 사람만.
 * - AI 제안은 범주를 넘지 못한다 — 묶음을 만든 범주 밖 페이지는 cross_workspace 로 거른다. 비공개 범주는 켰을 때만.
 * - 받을 때 본문이 그사이 바뀌었으면(bodyHash ≠ baseHash) stale — 사람이 비교를 보고 force 로만 받는다.
 * - 지우지 않는다. 휴지통은 trashedAt 만 적는다. 이행도 옛 업무 파일을 지우지 않는다.
 * - 화면 문구는 두지 않는다 — 문구 키(Msg)와 앱이 넘기는 라벨(MigrateLabels)만.
 */
import { scanInjection } from "./inject.ts";
import { newId } from "./types.ts";
import { mergeViewProposals, type PageView } from "./pageView.ts";
import { hashText as hash } from "./hash.ts";
import type { AiTool, ChangeEntry, MigrationRecord, Msg, WorkManifest, Workspace } from "./work.ts";
import type { Importance, Proposal, WorkItem, WorkStatus } from "./workV2.ts";

export const PAGES_SCHEMA_VERSION = 3;

/* ───────────────────────── 모델 ───────────────────────── */

/** 본문이 있는 곳 — file: state/pages/{id}.json · pack:{packId}: 가져오기 묶음 속(아직 아무도 고치지 않음) */
export type BodyRef = "file" | `pack:${string}`;

export interface PageMeta {
  id: string;
  workspaceId: string;
  /** null 이면 범주 바로 아래 */
  parentId: string | null;
  /** 형제 사이 순서(분수 키 — 사이에 끼워도 다른 형제를 고치지 않는다). 같으면 id 순 */
  order: string;
  title: string;
  icon?: string | null;
  createdAt: string;
  updatedAt: string;
  /** 색인 속 이 항목을 바꿀 때마다 1씩 */
  rev: number;
  /** 정규화한 본문의 지문 — 기기 캐시 키 · 제안이 낡았나 · 다시 가져오기 판단 */
  bodyHash: string;
  bodyLen: number;
  bodyRef: BodyRef;
  /** 가져온 페이지의 바깥 id(공고 id 등) — 같은 부모 아래에서 다시 가져올 때 맞춘다 */
  externalId?: string | null;
  /** 작은 문자열 값(회사 · 마감 …) — 목차 거르기 · 표 보기 */
  props?: Record<string, string>;
  /** 이어 둔 자료 id — 문서(PageDoc.sourceIds)의 사본. 조각에서 거꾸로 페이지를 찾을 때(문서를 다 읽지 않게) */
  sourceIds?: string[];
  /** 가져올 때의 모습 — 사람이 본문을 고쳤는지(bodyHash 가 달라졌는지) 본다 */
  imported?: { hash: string; bodyHash: string; title: string; at: string } | null;
  /** 휴지통 — 지우지 않고 시각만 적는다 */
  trashedAt?: string | null;
  /** 함께 휴지통에 들어간 묶음의 맨 위 페이지 — 되살릴 때 같이 돌아온다 */
  trashedBy?: string | null;
  /** 하위를 한 줄씩 볼 때의 칸(pageView.ts) — 없으면 하위 값 모양으로 짐작 */
  view?: PageView | null;
}

export interface PageDoc {
  id: string;
  schemaVersion: number;
  /** 저장할 때마다 1씩(저장소가 올린다) */
  rev: number;
  workspaceId: string;
  /** 마크다운 — 정본 */
  body: string;
  /** 이어 둔 자료(받은 것 조각 · Drive 파일) */
  sourceIds: string[];
  changes: ChangeEntry[];
  updatedAt: string;
}

/** 범주 하나의 색인 파일 */
export interface PageIndexFile {
  schemaVersion: number;
  workspaceId: string;
  rev: number;
  pages: PageMeta[];
}

/** 가져오기 묶음 — 한 번 쓰고 고치지 않는다 */
export interface PagePack {
  id: string;
  pages: { id: string; body: string }[];
}

export type BodyFlag = "injection_suspect" | "bad_refs" | "forbidden_fields" | "run_mismatch";

/** AI 의 본문 제안 — 새 본문 전체. 원문은 raw/{rawHash}.txt */
export interface BodyProposal {
  id: string;
  pageId: string;
  workspaceId: string;
  /** 제안을 만들 때 본 본문의 지문 — 받을 때 지금 지문과 다르면 낡은 제안 */
  baseHash: string;
  rawHash: string;
  bodyLen: number;
  note?: string;
  /** AI 가 댄 근거(P1 · S1:3) */
  refs?: string[];
  flags?: BodyFlag[];
  tool: AiTool;
  /** ai: AI 가 냄 · migration: 옛 업무의 AI 기록 · 확정 안 된 것을 옮긴 것 */
  origin: "ai" | "migration";
  runId?: string | null;
  status: "open" | "accepted" | "rejected";
  createdAt: string;
  decidedAt?: string | null;
  /** 받은 방식 — forced: 낡은 것을 비교한 뒤 그대로 받음 */
  outcome?: "applied" | "forced" | null;
}

export interface PageState {
  manifest: WorkManifest;
  pages: PageMeta[];
}

/* ───────────────────────── 도우미 ───────────────────────── */

/** 본문 비교 · 지문용 — 줄바꿈 · 줄 끝 빈칸 · 위아래 빈 줄 · 세 줄 넘는 빈 줄을 맞춘다(들여쓰기는 그대로) */
export function normalizeBody(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

export const bodyHashOf = (body: string) => hash(normalizeBody(body));

const alive = (p: PageMeta) => !p.trashedAt;
const byOrder = (a: PageMeta, b: PageMeta) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const touch = (p: PageMeta, patch: Partial<PageMeta>, nowIso: string): PageMeta => ({ ...p, ...patch, rev: p.rev + 1, updatedAt: nowIso });

/* ───────────────────────── 순서 키(분수) ───────────────────────── */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** a < 결과 < b 인 가장 짧은 키 근처. a 는 "" 일 수 있고 b 가 null 이면 끝없이 큰 쪽 */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)];
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[da] + midpoint(a.slice(1), null);
}

/** 두 키 사이의 새 키(null = 맨 앞 · 맨 뒤). a ≥ b 면 쓸 수 없다(형제 키를 다시 매긴다) */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) throw new Error(`order: ${a} >= ${b}`);
  return midpoint(a ?? "", b);
}

/** 사이에 n 개를 고르게 — 한꺼번에 가져올 때 키가 길어지지 않게 가운데부터 나눈다 */
export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  if (n <= 0) return [];
  const c = keyBetween(a, b);
  const k = Math.floor((n - 1) / 2);
  return [...keysBetween(a, c, k), c, ...keysBetween(c, b, n - 1 - k)];
}

/* ───────────────────────── 트리 읽기 ───────────────────────── */

export function pageOf(pages: PageMeta[], id: string | null | undefined): PageMeta | undefined {
  return id ? pages.find((p) => p.id === id) : undefined;
}

/** 살아 있는 자식(순서대로). parentId null = 범주 맨 위 */
export function childrenOf(pages: PageMeta[], workspaceId: string, parentId: string | null): PageMeta[] {
  return pages.filter((p) => alive(p) && p.workspaceId === workspaceId && (p.parentId ?? null) === parentId).sort(byOrder);
}

/** 맨 위부터 부모까지(자기 빼고) */
export function ancestors(pages: PageMeta[], id: string): PageMeta[] {
  const out: PageMeta[] = [];
  const seen = new Set<string>([id]);
  let cur = pageOf(pages, pageOf(pages, id)?.parentId);
  while (cur && !seen.has(cur.id)) {
    out.unshift(cur);
    seen.add(cur.id);
    cur = pageOf(pages, cur.parentId);
  }
  return out;
}

/** 자기와 아래 전부의 id(살아 있는 것만, 깊이 우선 · 순서대로) */
export function subtreeIds(pages: PageMeta[], id: string, opts: { includeTrashed?: boolean } = {}): string[] {
  const kids = new Map<string, PageMeta[]>();
  for (const p of pages) {
    if (!opts.includeTrashed && !alive(p)) continue;
    if (p.parentId) kids.set(p.parentId, [...(kids.get(p.parentId) ?? []), p]);
  }
  const out: string[] = [];
  const walk = (x: string) => {
    if (out.includes(x)) return;
    out.push(x);
    for (const k of (kids.get(x) ?? []).sort(byOrder)) walk(k.id);
  };
  walk(id);
  return out;
}

/** 트리를 줄로 펼친다(깊이 포함) — 접은 페이지의 아래는 뺀다. 화면 트리 · MCP 목록이 같이 쓴다 */
export function flattenTree(pages: PageMeta[], workspaceId: string, opts: { under?: string | null; depth?: number; collapsed?: Set<string> } = {}): { page: PageMeta; depth: number; childCount: number }[] {
  const out: { page: PageMeta; depth: number; childCount: number }[] = [];
  const max = opts.depth ?? Infinity;
  const walk = (parentId: string | null, depth: number) => {
    for (const p of childrenOf(pages, workspaceId, parentId)) {
      const kids = childrenOf(pages, workspaceId, p.id).length;
      out.push({ page: p, depth, childCount: kids });
      if (kids && depth + 1 < max && !opts.collapsed?.has(p.id)) walk(p.id, depth + 1);
    }
  };
  walk(opts.under ?? null, 0);
  return out;
}

/** 최근 바뀐 페이지 — 오늘 화면 */
export function recentPages(pages: PageMeta[], workspaceId: string | null, n = 10): PageMeta[] {
  return pages
    .filter((p) => alive(p) && (!workspaceId || p.workspaceId === workspaceId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    .slice(0, n);
}

/** 휴지통 — 사람이 넣은 맨 위 페이지만(같이 들어간 아래는 그 안에) */
export function trashedPages(pages: PageMeta[], workspaceId: string | null): PageMeta[] {
  return pages.filter((p) => p.trashedAt && (p.trashedBy ?? p.id) === p.id && (!workspaceId || p.workspaceId === workspaceId)).sort((a, b) => (b.trashedAt ?? "").localeCompare(a.trashedAt ?? ""));
}

/** 제목으로 찾기(색인만) — 경로 포함 */
export function searchPageTitles(pages: PageMeta[], query: string, workspaceId?: string | null): PageMeta[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return pages.filter((p) => alive(p) && (!workspaceId || p.workspaceId === workspaceId) && words.every((w) => `${p.title} ${Object.values(p.props ?? {}).join(" ")}`.toLowerCase().includes(w)));
}

/* ───────────────────────── 트리 바꾸기(사람만) ───────────────────────── */

/** 형제 키가 겹쳐 사이에 끼울 수 없을 때 — 지금 순서대로 다시 매긴다 */
function rekey(pages: PageMeta[], workspaceId: string, parentId: string | null, nowIso: string): PageMeta[] {
  const sibs = childrenOf(pages, workspaceId, parentId);
  const keys = keysBetween(null, null, sibs.length);
  const next = new Map(sibs.map((s, i) => [s.id, keys[i]]));
  return pages.map((p) => (next.has(p.id) && p.order !== next.get(p.id) ? touch(p, { order: next.get(p.id) as string }, nowIso) : p));
}

/** parentId 아래 beforeId 앞(없으면 맨 끝)에 들어갈 키 — 필요하면 형제를 다시 매긴 색인과 함께 */
function slot(pages: PageMeta[], workspaceId: string, parentId: string | null, beforeId: string | null | undefined, skipId: string | null, nowIso: string): { pages: PageMeta[]; order: string } {
  for (let attempt = 0; attempt < 2; attempt++) {
    const sibs = childrenOf(pages, workspaceId, parentId).filter((p) => p.id !== skipId);
    const at = beforeId ? sibs.findIndex((p) => p.id === beforeId) : -1;
    const i = at >= 0 ? at : sibs.length;
    const a = sibs[i - 1]?.order ?? null;
    const b = sibs[i]?.order ?? null;
    if (a === null || b === null || a < b) return { pages, order: keyBetween(a, b) };
    pages = rekey(pages, workspaceId, parentId, nowIso);
  }
  return { pages, order: keyBetween(childrenOf(pages, workspaceId, parentId).at(-1)?.order ?? null, null) };
}

export function newDoc(id: string, workspaceId: string, body: string, nowIso: string): PageDoc {
  return { id, schemaVersion: PAGES_SCHEMA_VERSION, rev: 0, workspaceId, body: normalizeBody(body), sourceIds: [], changes: [], updatedAt: nowIso };
}

export type CreatePageResult = { kind: "ok"; pages: PageMeta[]; page: PageMeta; doc: PageDoc } | { kind: "bad_parent" };

/** 새 페이지 — 부모가 있으면 같은 범주 · 살아 있어야 한다 */
export function createPage(
  pages: PageMeta[],
  input: { workspaceId: string; parentId?: string | null; title: string; icon?: string | null; beforeId?: string | null; body?: string; id?: string },
  nowIso: string,
): CreatePageResult {
  const parentId = input.parentId ?? null;
  if (parentId) {
    const parent = pageOf(pages, parentId);
    if (!parent || !alive(parent) || parent.workspaceId !== input.workspaceId) return { kind: "bad_parent" };
  }
  const s = slot(pages, input.workspaceId, parentId, input.beforeId, null, nowIso);
  const id = input.id ?? newId();
  const doc = newDoc(id, input.workspaceId, input.body ?? "", nowIso);
  const page: PageMeta = {
    id,
    workspaceId: input.workspaceId,
    parentId,
    order: s.order,
    title: input.title.trim().slice(0, 200),
    ...(input.icon ? { icon: input.icon } : {}),
    createdAt: nowIso,
    updatedAt: nowIso,
    rev: 0,
    bodyHash: bodyHashOf(doc.body),
    bodyLen: doc.body.length,
    bodyRef: "file",
  };
  return { kind: "ok", pages: [...s.pages, page], page, doc };
}

export function renamePage(pages: PageMeta[], id: string, title: string, nowIso: string): PageMeta[] {
  const t = title.trim().slice(0, 200);
  return pages.map((p) => (p.id === id && p.title !== t ? touch(p, { title: t }, nowIso) : p));
}

/** 작은 값 고치기 — 사람만. 빈 값은 지운다 */
export function setPageProps(pages: PageMeta[], id: string, props: Record<string, string>, nowIso: string): PageMeta[] {
  const next = cleanProps(props);
  const same = (a: Record<string, string> = {}, b: Record<string, string> = {}) => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);
  return pages.map((p) => (p.id === id && !same(p.props, next) ? touch(p, { props: next }, nowIso) : p));
}

export function setPageIcon(pages: PageMeta[], id: string, icon: string | null, nowIso: string): PageMeta[] {
  return pages.map((p) => (p.id === id && (p.icon ?? null) !== icon ? touch(p, { icon }, nowIso) : p));
}

export type MoveResult = { kind: "ok"; pages: PageMeta[] } | { kind: "gone" } | { kind: "cycle" } | { kind: "cross_workspace" };

/** 옮기기 — 자기 아래로는 못 간다(순환). 다른 범주 페이지 아래로도 못 간다 */
export function movePage(pages: PageMeta[], id: string, parentId: string | null, beforeId: string | null, nowIso: string): MoveResult {
  const page = pageOf(pages, id);
  if (!page || !alive(page)) return { kind: "gone" };
  if (parentId) {
    const parent = pageOf(pages, parentId);
    if (!parent || !alive(parent)) return { kind: "gone" };
    if (parent.workspaceId !== page.workspaceId) return { kind: "cross_workspace" };
    if (subtreeIds(pages, id).includes(parentId)) return { kind: "cycle" };
  }
  const s = slot(pages, page.workspaceId, parentId, beforeId === id ? null : beforeId, id, nowIso);
  return { kind: "ok", pages: s.pages.map((p) => (p.id === id ? touch(p, { parentId, order: s.order }, nowIso) : p)) };
}

/** 위 · 아래로 한 칸(같은 부모 안) */
export function reorderPage(pages: PageMeta[], id: string, dir: -1 | 1, nowIso: string): PageMeta[] {
  const page = pageOf(pages, id);
  if (!page) return pages;
  const sibs = childrenOf(pages, page.workspaceId, page.parentId);
  const i = sibs.findIndex((p) => p.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sibs.length) return pages;
  // 아래로 한 칸 = 두 칸 아래 형제 앞
  const before = dir < 0 ? sibs[j].id : (sibs[j + 1]?.id ?? null);
  const r = movePage(pages, id, page.parentId, before, nowIso);
  return r.kind === "ok" ? r.pages : pages;
}

/**
 * 휴지통으로 — 사람만. with_children: 아래까지 함께 · lift_children: 아래는 이 페이지 자리로 올리고 이것만.
 * 지우지 않는다(trashedAt 만). 되살리면 함께 들어간 것이 같이 돌아온다
 */
export function trashPage(pages: PageMeta[], id: string, mode: "with_children" | "lift_children", nowIso: string): { pages: PageMeta[]; count: number } {
  const page = pageOf(pages, id);
  if (!page || !alive(page)) return { pages, count: 0 };
  if (mode === "with_children") {
    const ids = new Set(subtreeIds(pages, id));
    return { pages: pages.map((p) => (ids.has(p.id) ? touch(p, { trashedAt: nowIso, trashedBy: id }, nowIso) : p)), count: ids.size };
  }
  const sibs = childrenOf(pages, page.workspaceId, page.parentId);
  const i = sibs.findIndex((p) => p.id === id);
  const kids = childrenOf(pages, page.workspaceId, id);
  let next = pages;
  let a = sibs[i - 1]?.order ?? null;
  let b = sibs[i + 1]?.order ?? null;
  if (a !== null && b !== null && a >= b) {
    next = rekey(next, page.workspaceId, page.parentId, nowIso);
    const again = childrenOf(next, page.workspaceId, page.parentId);
    a = again[i - 1]?.order ?? null;
    b = again[i + 1]?.order ?? null;
  }
  const keys = keysBetween(a, b, kids.length);
  const moved = new Map(kids.map((k, j) => [k.id, keys[j]]));
  next = next.map((p) => (moved.has(p.id) ? touch(p, { parentId: page.parentId, order: moved.get(p.id) as string }, nowIso) : p.id === id ? touch(p, { trashedAt: nowIso, trashedBy: id }, nowIso) : p));
  return { pages: next, count: 1 };
}

/** 휴지통에서 되살리기 — 함께 들어간 아래도. 부모가 휴지통 · 없으면 범주 맨 위 끝으로 */
export function restorePage(pages: PageMeta[], id: string, nowIso: string): PageMeta[] {
  const page = pageOf(pages, id);
  if (!page || alive(page)) return pages;
  const batch = page.trashedBy ?? page.id;
  const ids = new Set(subtreeIds(pages, id, { includeTrashed: true }).filter((x) => (pageOf(pages, x)?.trashedBy ?? x) === batch && pageOf(pages, x)?.trashedAt));
  const parent = pageOf(pages, page.parentId);
  const home = parent && alive(parent) ? parent.id : null;
  let next = pages.map((p) => (ids.has(p.id) ? touch(p, { trashedAt: null, trashedBy: null }, nowIso) : p));
  if (home !== page.parentId) {
    const s = slot(next, page.workspaceId, home, null, id, nowIso);
    next = s.pages.map((p) => (p.id === id ? { ...p, parentId: home, order: s.order } : p));
  }
  return next;
}

/* ───────────────────────── 본문(사람이 고침 · 되돌리기) ───────────────────────── */

/** 되돌리기 사본 상한 — 페이지 파일이 한없이 커지지 않게(가장 최근 하나는 언제나 남긴다) */
const MAX_UNDO_CHARS = 200_000;
const MAX_UNDO_ENTRIES = 12;

type DocSnapshot = Pick<PageDoc, "body" | "sourceIds">;

/** 문서를 바꾸고 바꾸기 전 모습(본문 · 자료)을 되돌리기 기록으로 남긴다. rev 는 저장소가 올린다 */
export function withDocChange(doc: PageDoc, msg: Msg, nowIso: string, fn: (draft: PageDoc) => PageDoc, attention?: Msg[]): PageDoc {
  const before = JSON.stringify({ body: doc.body, sourceIds: doc.sourceIds } satisfies DocSnapshot);
  const next = fn({ ...doc, sourceIds: [...doc.sourceIds] });
  const entry: ChangeEntry = { id: newId(), at: nowIso, msg, before, undone: false, ...(attention?.length ? { attention } : {}) };
  const changes: ChangeEntry[] = [];
  let used = 0;
  for (const c of [entry, ...doc.changes]) {
    if (changes.length >= MAX_UNDO_ENTRIES || (changes.length && used + c.before.length > MAX_UNDO_CHARS)) break;
    changes.push(c);
    used += c.before.length;
  }
  return { ...next, changes, updatedAt: nowIso };
}

/** 가장 최근 바꿈만 되돌린다 */
export function undoDoc(doc: PageDoc, changeId: string, nowIso: string): { doc: PageDoc; ok: boolean } {
  const latest = doc.changes.find((c) => !c.undone);
  if (!latest || latest.id !== changeId) return { doc, ok: false };
  const snap = JSON.parse(latest.before) as DocSnapshot;
  return { doc: { ...doc, body: snap.body, sourceIds: snap.sourceIds, changes: doc.changes.map((c) => (c.id === changeId ? { ...c, undone: true } : c)), updatedAt: nowIso }, ok: true };
}

/** 사람이 본문을 고친다 — 정규화해서 같으면 그대로 돌려준다(저장하지 않는다) */
export function editBody(doc: PageDoc, body: string, nowIso: string): PageDoc {
  const next = normalizeBody(body);
  if (next === normalizeBody(doc.body)) return doc;
  return withDocChange(doc, { key: "change.editBody" }, nowIso, (d) => ({ ...d, body: next }));
}

export function linkSourceToPage(doc: PageDoc, sourceId: string, title: string, nowIso: string): PageDoc {
  if (doc.sourceIds.includes(sourceId)) return doc;
  return withDocChange(doc, { key: "change.linkSource", params: { title } }, nowIso, (d) => ({ ...d, sourceIds: [...d.sourceIds, sourceId] }));
}

export function unlinkSourceFromPage(doc: PageDoc, sourceId: string, nowIso: string): PageDoc {
  if (!doc.sourceIds.includes(sourceId)) return doc;
  return withDocChange(doc, { key: "change.unlinkSource" }, nowIso, (d) => ({ ...d, sourceIds: d.sourceIds.filter((x) => x !== sourceId) }));
}

/** 문서를 저장한 뒤 색인을 맞춘다 — 지문 · 길이 · 제 파일(file)로 */
export function syncMeta(meta: PageMeta, doc: PageDoc, nowIso: string): PageMeta {
  const h = bodyHashOf(doc.body);
  const same = (meta.sourceIds ?? []).join(",") === doc.sourceIds.join(",");
  if (meta.bodyHash === h && meta.bodyRef === "file" && meta.bodyLen === doc.body.length && same) return meta;
  return touch(meta, { bodyHash: h, bodyLen: doc.body.length, bodyRef: "file", ...(doc.sourceIds.length || meta.sourceIds ? { sourceIds: [...doc.sourceIds] } : {}) }, nowIso);
}

/** 이 자료를 이어 둔 페이지(살아 있는 것) — 색인의 사본으로 */
export function pagesForSource(pages: PageMeta[], sourceId: string): PageMeta[] {
  return pages.filter((p) => alive(p) && p.sourceIds?.includes(sourceId));
}

/* ───────────────────────── 본문 제안(AI → 사람) ───────────────────────── */

export const MAX_PROPOSAL_BODY = 60_000;
const MAX_DECIDED_PROPOSALS = 100;

export type BodySkip = "unknown_page" | "trashed" | "private" | "cross_workspace" | "too_long" | "empty" | "same" | "duplicate";

export interface BodyInput {
  pageId: string;
  body: string;
  note?: string;
  refs?: string[];
  tool: AiTool;
  runId?: string | null;
  /** 제안을 만들 때 본 본문 지문 — 없으면 지금 지문 */
  baseHash?: string | null;
  origin?: "ai" | "migration";
  flags?: BodyFlag[];
}

export const openBodyProposals = (m: WorkManifest, pageId?: string | null): BodyProposal[] => (m.bodyProposals ?? []).filter((p) => p.status === "open" && (!pageId || p.pageId === pageId));

function pruneBody(list: BodyProposal[]): BodyProposal[] {
  const decided = list.filter((p) => p.status !== "open").sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? "")).slice(0, MAX_DECIDED_PROPOSALS);
  const keep = new Set(decided.map((p) => p.id));
  return list.filter((p) => p.status === "open" || keep.has(p.id));
}

/**
 * 본문 제안을 들인다 — MCP · 앱의 결과 가져오기 · 이행이 같은 함수를 부른다. 저장(raw/{rawHash}.txt · 매니페스트)은 부르는 쪽이.
 * 검사: 페이지가 있고 살아 있어야, 묶음 범주(opts.workspaceId) 안이어야, 비공개 범주는 켰을 때만, 6만 자 이하.
 * 지시문으로 보이는 말은 들이되 표시한다.
 */
export function proposeBody(
  state: PageState,
  input: BodyInput,
  nowIso: string,
  opts: { includePrivate?: boolean; workspaceId?: string | null } = {},
): { kind: "ok"; manifest: WorkManifest; proposal: BodyProposal; body: string } | { kind: "skipped"; reason: BodySkip } {
  const page = pageOf(state.pages, input.pageId);
  if (!page) return { kind: "skipped", reason: "unknown_page" };
  if (!alive(page)) return { kind: "skipped", reason: "trashed" };
  if (opts.workspaceId && page.workspaceId !== opts.workspaceId) return { kind: "skipped", reason: "cross_workspace" };
  const ws = state.manifest.workspaces.find((w) => w.id === page.workspaceId);
  if (ws?.private && !opts.includePrivate && input.origin !== "migration") return { kind: "skipped", reason: "private" };
  const body = normalizeBody(String(input.body ?? ""));
  if (!body) return { kind: "skipped", reason: "empty" };
  if (body.length > MAX_PROPOSAL_BODY) return { kind: "skipped", reason: "too_long" };
  const rawHash = hash(body);
  if (rawHash === page.bodyHash) return { kind: "skipped", reason: "same" };
  if (openBodyProposals(state.manifest, page.id).some((p) => p.rawHash === rawHash)) return { kind: "skipped", reason: "duplicate" };
  const note = (input.note ?? "").trim().slice(0, 1000);
  const refs = (input.refs ?? []).filter((r) => typeof r === "string" && r.trim()).map((r) => r.trim()).slice(0, 40);
  const flags = [...new Set([...(input.flags ?? []), ...(scanInjection(`${body}\n${note}`).length ? (["injection_suspect"] as BodyFlag[]) : [])])].sort();
  const proposal: BodyProposal = {
    id: newId(),
    pageId: page.id,
    workspaceId: page.workspaceId,
    baseHash: input.baseHash || page.bodyHash,
    rawHash,
    bodyLen: body.length,
    ...(note ? { note } : {}),
    ...(refs.length ? { refs } : {}),
    ...(flags.length ? { flags } : {}),
    tool: input.tool,
    origin: input.origin ?? "ai",
    runId: input.runId ?? null,
    status: "open",
    createdAt: nowIso,
  };
  return { kind: "ok", manifest: { ...state.manifest, bodyProposals: pruneBody([...(state.manifest.bodyProposals ?? []), proposal]) }, proposal, body };
}

export type BodyAccept =
  | { kind: "ok"; manifest: WorkManifest; doc: PageDoc; meta: PageMeta }
  /** 제안을 만든 뒤 본문이 바뀌었다 — 비교를 보고 force 로 */
  | { kind: "stale"; proposal: BodyProposal }
  /** 제안 · 페이지가 없거나 이미 정했다 */
  | { kind: "gone" }
  /** 가져온 원문이 제안 지문과 다르다(원문 파일이 깨졌다) */
  | { kind: "bad_raw" };

/** 본문 제안을 받는다 — 사람만. 되돌리기 기록에 남아 [되돌리기] 로 돌릴 수 있다 */
export function acceptBodyProposal(manifest: WorkManifest, meta: PageMeta, doc: PageDoc, proposalId: string, proposedBody: string, nowIso: string, opts: { force?: boolean } = {}): BodyAccept {
  const p = (manifest.bodyProposals ?? []).find((x) => x.id === proposalId);
  if (!p || p.status !== "open" || p.pageId !== meta.id || doc.id !== meta.id || !alive(meta)) return { kind: "gone" };
  const body = normalizeBody(proposedBody);
  if (hash(body) !== p.rawHash) return { kind: "bad_raw" };
  const current = bodyHashOf(doc.body);
  const stale = current !== p.baseHash;
  if (stale && !opts.force) return { kind: "stale", proposal: p };
  const nextDoc = withDocChange(doc, { key: p.origin === "migration" ? "change.acceptMigration" : "change.acceptBody", params: { tool: p.tool } }, nowIso, (d) => ({ ...d, body }));
  const bodyProposals = pruneBody((manifest.bodyProposals ?? []).map((x) => (x.id === proposalId ? { ...x, status: "accepted" as const, decidedAt: nowIso, outcome: stale ? ("forced" as const) : ("applied" as const) } : x)));
  return { kind: "ok", manifest: { ...manifest, bodyProposals }, doc: nextDoc, meta: syncMeta(meta, nextDoc, nowIso) };
}

export function rejectBodyProposal(manifest: WorkManifest, proposalId: string, nowIso: string): WorkManifest {
  const bodyProposals = (manifest.bodyProposals ?? []).map((x) => (x.id === proposalId && x.status === "open" ? { ...x, status: "rejected" as const, decidedAt: nowIso } : x));
  return { ...manifest, bodyProposals: pruneBody(bodyProposals) };
}

/** 본문 제안 · 보기 제안 · 이행 기록 · 페이지 넘기기 기록을 다른 쪽 최신 매니페스트에 합친다(mergeTriage 옆) — 같은 id 는 정한 쪽이 이긴다 */
export function mergeBodyProposals(cur: WorkManifest, mine: WorkManifest): WorkManifest {
  const byId = new Map((cur.bodyProposals ?? []).map((p) => [p.id, p]));
  for (const p of mine.bodyProposals ?? []) {
    const c = byId.get(p.id);
    if (!c || (c.status === "open" && p.status !== "open")) byId.set(p.id, p);
  }
  const migrations = [...(cur.migrations ?? [])];
  for (const r of mine.migrations ?? []) if (!migrations.some((x) => x.id === r.id)) migrations.push(r);
  // 페이지 넘기기 기록도 — 끝난 쪽이 이긴다(최근 20개)
  const runs = new Map((cur.pageRuns ?? []).map((r) => [r.id, r]));
  for (const r of mine.pageRuns ?? []) {
    const c = runs.get(r.id);
    if (!c || (!c.finishedAt && r.finishedAt)) runs.set(r.id, r);
  }
  const pageRuns = [...runs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).slice(-20);
  // 보기 제안도 같은 저장에 실려 온다(pageView.ts)
  return mergeViewProposals({ ...cur, bodyProposals: pruneBody([...byId.values()]), migrations, pageRuns }, mine);
}

/* ───────────────────────── 가져오기(범용) ───────────────────────── */

export interface ImportEntry {
  title: string;
  markdown: string;
  /** 같은 부모 아래에서 다시 가져올 때 맞추는 바깥 id */
  externalId: string;
  props?: Record<string, string>;
  icon?: string | null;
}

export interface ImportPlan {
  workspaceId: string;
  parentId: string | null;
  /** 새 페이지(색인 항목 — bodyRef 는 저장할 때 묶음으로 정한다) + 본문 */
  create: { meta: PageMeta; body: string }[];
  /** 사람이 고치지 않은 페이지의 새 내용 */
  update: { meta: PageMeta; body: string }[];
  /** 사람이 본문을 고친 페이지 — 덮어쓰지 않는다 */
  skipEdited: PageMeta[];
  /** 사람이 휴지통에 넣은 페이지 — 되살리지 않는다 */
  skipTrashed: number;
  unchanged: number;
  /** 제목 · 바깥 id 가 빈 항목 */
  bad: number;
}

const MAX_PROP = 200;

function cleanProps(props: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!props) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) if (k && v != null && String(v).trim()) out[k.slice(0, 40)] = String(v).trim().slice(0, MAX_PROP);
  return Object.keys(out).length ? out : undefined;
}

/**
 * 가져오기 계획 — 같은 부모 아래에서 externalId 로 맞춘다. 사람이 본문을 고친 페이지는 건너뛰고,
 * 고치지 않은 것은 새 내용으로, 같은 것은 그대로. 순수 함수 — 쓰기는 WorkRepo.applyImport.
 */
export function importPlan(pages: PageMeta[], workspaceId: string, parentId: string | null, entries: ImportEntry[], nowIso: string): ImportPlan | { kind: "bad_parent" } {
  if (parentId) {
    const parent = pageOf(pages, parentId);
    if (!parent || !alive(parent) || parent.workspaceId !== workspaceId) return { kind: "bad_parent" };
  }
  const plan: ImportPlan = { workspaceId, parentId, create: [], update: [], skipEdited: [], skipTrashed: 0, unchanged: 0, bad: 0 };
  const here = pages.filter((p) => p.workspaceId === workspaceId && (p.parentId ?? null) === parentId && p.externalId);
  const byExt = new Map(here.map((p) => [p.externalId as string, p]));
  const incoming = new Map<string, ImportEntry>();
  for (const e of entries) {
    if (!e?.externalId?.trim() || !e.title?.trim()) plan.bad++;
    else incoming.set(e.externalId.trim(), e);
  }
  const fresh: { e: ImportEntry; body: string; h: string; props?: Record<string, string> }[] = [];
  for (const [ext, e] of incoming) {
    const body = normalizeBody(e.markdown ?? "");
    const props = cleanProps(e.props);
    const title = e.title.trim().slice(0, 200);
    const h = hash(JSON.stringify([title, body, props ?? null, e.icon ?? null]));
    const have = byExt.get(ext);
    if (!have) {
      fresh.push({ e: { ...e, title, externalId: ext }, body, h, props });
      continue;
    }
    if (have.trashedAt) {
      plan.skipTrashed++;
      continue;
    }
    if (!have.imported || have.bodyHash !== have.imported.bodyHash) {
      plan.skipEdited.push(have);
      continue;
    }
    if (have.imported.hash === h) {
      plan.unchanged++;
      continue;
    }
    // 사람이 이름만 바꿨으면 그 이름은 지킨다
    const keepTitle = have.title !== have.imported.title;
    const bh = bodyHashOf(body);
    plan.update.push({
      meta: touch(have, { title: keepTitle ? have.title : title, props, ...(e.icon ? { icon: e.icon } : {}), bodyHash: bh, bodyLen: body.length, imported: { hash: h, bodyHash: bh, title, at: nowIso } }, nowIso),
      body,
    });
  }
  const last = childrenOf(pages, workspaceId, parentId).at(-1)?.order ?? null;
  const keys = keysBetween(last, null, fresh.length);
  fresh.forEach(({ e, body, h, props }, i) => {
    const bh = bodyHashOf(body);
    plan.create.push({
      meta: {
        id: newId(),
        workspaceId,
        parentId,
        order: keys[i],
        title: e.title,
        ...(e.icon ? { icon: e.icon } : {}),
        createdAt: nowIso,
        updatedAt: nowIso,
        rev: 0,
        bodyHash: bh,
        bodyLen: body.length,
        bodyRef: "file",
        externalId: e.externalId,
        ...(props ? { props } : {}),
        imported: { hash: h, bodyHash: bh, title: e.title, at: nowIso },
      },
      body,
    });
  });
  return plan;
}

/**
 * 붙여 넣은 · 올린 마크다운을 페이지 여럿으로 — 맨 위 단계 '# 제목' 줄마다 하나(코드 블록 안은 빼고).
 * 바깥 id 는 제목 지문 — 같은 제목을 다시 가져오면 같은 페이지로 맞춘다. '# ' 가 없으면 통째로 하나(fallbackTitle).
 */
export function splitMarkdownPages(md: string, fallbackTitle: string): ImportEntry[] {
  const out: ImportEntry[] = [];
  let cur: { title: string; lines: string[] } | null = null;
  let inCode = false;
  const pre: string[] = [];
  for (const line of md.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^```/.test(line)) inCode = !inCode;
    const h = !inCode ? /^# (.+)$/.exec(line) : null;
    if (h) {
      if (cur) out.push({ title: cur.title, markdown: cur.lines.join("\n"), externalId: `md:${hash(cur.title)}` });
      cur = { title: h[1].trim(), lines: [] };
    } else (cur ? cur.lines : pre).push(line);
  }
  if (cur) out.push({ title: cur.title, markdown: cur.lines.join("\n"), externalId: `md:${hash(cur.title)}` });
  if (!out.length && normalizeBody(pre.join("\n"))) out.push({ title: fallbackTitle, markdown: pre.join("\n"), externalId: `md:${hash(fallbackTitle)}` });
  return out;
}

const TITLE_KEYS = ["title", "name", "제목", "이름"];
const BODY_KEYS = ["body", "markdown", "content", "text", "본문", "내용"];
const ID_KEYS = ["id", "externalId", "key", "url"];

/** CSV 한 덩어리 → 행들(따옴표 · 줄바꿈 든 칸 · "" 이스케이프) */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const t = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && !cell) quoted = true;
    else if (ch === ",") row.push(cell), (cell = "");
    else if (ch === "\n") row.push(cell), rows.push(row), (row = []), (cell = "");
    else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim()));
}

const scalar = (v: unknown): string | null => (v == null ? null : typeof v === "object" ? (Array.isArray(v) && v.every((x) => typeof x !== "object") ? v.join(", ") : null) : String(v));

/**
 * 표 · 목록 데이터(JSON 배열 · CSV)를 하위 페이지 항목으로 — 어떤 데이터든 같은 길.
 * 제목 칸(title · name · 제목 …, 없으면 첫 칸) · 본문 칸(body · markdown · 본문 …) · 바깥 id 칸(id · url …, 없으면 제목 지문),
 * 나머지 칸은 작은 값(props) — 펼쳐 보기에서 거르고 정렬한다. 형식이 아니면 null(마크다운으로 읽을 것).
 */
export function rowsToEntries(text: string): ImportEntry[] | null {
  const t = text.trim();
  let rows: Record<string, unknown>[] | null = null;
  if (/^[[{]/.test(t)) {
    try {
      const o = JSON.parse(t) as unknown;
      const list = Array.isArray(o) ? o : o && typeof o === "object" ? Object.values(o as object).find(Array.isArray) : null;
      if (Array.isArray(list) && list.every((x) => x && typeof x === "object" && !Array.isArray(x))) rows = list as Record<string, unknown>[];
    } catch {
      return null;
    }
  } else {
    const csv = parseCsv(t);
    if (csv.length >= 2 && csv[0].length >= 2 && csv.slice(1).every((r) => r.length === csv[0].length)) {
      const head = csv[0].map((h) => h.trim());
      rows = csv.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
    }
  }
  if (!rows?.length) return null;
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const find = (cands: string[]) => keys.find((k) => cands.includes(k.toLowerCase()) || cands.includes(k));
  const titleKey = find(TITLE_KEYS) ?? keys[0];
  const bodyKey = find(BODY_KEYS);
  const idKey = find(ID_KEYS);
  return rows
    .map((r) => {
      const title = (scalar(r[titleKey]) ?? "").trim();
      const props: Record<string, string> = {};
      for (const k of keys) {
        // 제목 · 본문 칸, 그리고 id 뿐인 칸은 작은 값에 넣지 않는다(url 같은 것은 남긴다)
        if (k === titleKey || k === bodyKey || (k === idKey && ["id", "externalid", "key"].includes(k.toLowerCase()))) continue;
        const v = scalar(r[k]);
        if (v != null && v.trim() && v.length <= MAX_PROP) props[k] = v.trim();
      }
      const id = idKey ? scalar(r[idKey]) : null;
      return { title, markdown: bodyKey ? (scalar(r[bodyKey]) ?? "") : "", externalId: id?.trim() ? `row:${id.trim()}` : `row:${hash(title)}`, props };
    })
    .filter((e) => e.title);
}

/** 묶음 크기 — Drive 요청 수를 줄이되 파일 하나가 너무 커지지 않게 */
export const PACK_MAX_PAGES = 60;
export const PACK_MAX_CHARS = 1_000_000;

/** 가져올 본문을 묶음으로 나눈다(순서 그대로) */
export function packBodies(items: { id: string; body: string }[], newPackId: () => string = newId): PagePack[] {
  const packs: PagePack[] = [];
  let cur: PagePack | null = null;
  let size = 0;
  for (const it of items) {
    if (!cur || cur.pages.length >= PACK_MAX_PAGES || (cur.pages.length && size + it.body.length > PACK_MAX_CHARS)) {
      cur = { id: newPackId(), pages: [] };
      packs.push(cur);
      size = 0;
    }
    cur.pages.push(it);
    size += it.body.length;
  }
  return packs;
}

/** 계획을 색인에 얹는다 — 저장 직전 최신 색인(다른 기기가 고쳤을 수 있다)에 다시 적용해도 같은 결과 */
export function applyImportToIndex(pages: PageMeta[], plan: ImportPlan, bodyRefOf: (pageId: string) => BodyRef): PageMeta[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  for (const u of plan.update) {
    const cur = byId.get(u.meta.id);
    // 그사이 사람이 고쳤으면 건너뛴다
    if (!cur || cur.trashedAt || !cur.imported || cur.bodyHash !== cur.imported.bodyHash) continue;
    byId.set(u.meta.id, { ...u.meta, bodyRef: bodyRefOf(u.meta.id) });
  }
  const taken = new Set(pages.filter((p) => p.workspaceId === plan.workspaceId && (p.parentId ?? null) === plan.parentId && p.externalId).map((p) => p.externalId));
  for (const c of plan.create) {
    if (byId.has(c.meta.id) || taken.has(c.meta.externalId)) continue;
    byId.set(c.meta.id, { ...c.meta, bodyRef: bodyRefOf(c.meta.id) });
  }
  return [...byId.values()];
}

/* ───────────────────────── v2 업무 → v3 페이지 이행 ───────────────────────── */

/** 이행 본문의 고정 문구 — 앱 · MCP 가 번역 파일에서 넘긴다 */
export interface MigrateLabels {
  goal: string;
  doneCriteria: string;
  summary: string;
  decisions: string;
  actions: string;
  outputs: string;
  latest: string;
  /** "{status} · {importance}" 꼴의 한 줄 — {status} {importance} {due} */
  statusLine: string;
  dueSuffix: string;
  status: Record<WorkStatus, string>;
  importance: Record<Importance, string>;
  /** 이행 제안 본문 아래 붙는 절 */
  aiSection: string;
  aiSummary: string;
  proposedDecisions: string;
  openProposals: string;
  unverified: string;
  proposalKind: Record<Proposal["kind"], string>;
  /** 이행 제안 머리말(제안 note) */
  migrationNote: string;
}

const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");

/** 편집기(Lexical)가 내보내는 꼴로 — 제목 뒤 빈 줄. 편집기를 한 번 거쳐도 글이 바뀌지 않게 */
export const editorBlocks = (md: string) => normalizeBody(md.replace(/^(#{1,4} [^\n]*)\n(?=[^\n])/gm, "$1\n\n"));

/**
 * 옛 업무 하나 → 페이지 본문(사람이 확정한 것) + 이행 제안 본문(AI 가 썼거나 확정 안 된 것이 있을 때만).
 * 사람이 확정한 것: 목표 · 완료 조건 · 확정 결정 · 할 일 · 결과물 · 사람이 쓴 현재 상황 · 옛 상태 한 줄.
 */
export function migrateItemBody(item: WorkItem, L: MigrateLabels): { body: string; proposal: string | null } {
  const out: string[] = [];
  const due = item.due ? fill(L.dueSuffix, { due: item.due }) : "";
  out.push(fill(L.statusLine, { status: L.status[item.status] ?? item.status, importance: L.importance[item.importance] ?? item.importance, due }), "");
  if (item.goal?.trim()) out.push(`## ${L.goal}`, item.goal.trim(), "");
  if (item.doneCriteria?.length) out.push(`## ${L.doneCriteria}`, ...item.doneCriteria.map((c) => `- [ ] ${c}`), "");
  if (item.summary?.origin === "user" && item.summary.text.trim()) out.push(`## ${L.summary}`, item.summary.text.trim(), "");
  const confirmed = (item.decisions ?? []).filter((d) => d.status === "confirmed");
  if (confirmed.length) out.push(`## ${L.decisions}`, ...confirmed.map((d) => `- ${d.text}${d.reason ? ` — ${d.reason}` : ""}`), "");
  const actions = (item.actions ?? []).filter((a) => !a.deletedAt);
  if (actions.length) out.push(`## ${L.actions}`, ...actions.map((a) => `- [${a.done ? "x" : " "}] ${a.title}${a.due ? ` (${a.due})` : ""}`), "");
  const outputs = item.outputs ?? [];
  if (outputs.length) out.push(`## ${L.outputs}`, ...outputs.map((o) => `- ${o.url ? `[${o.title}](${o.url})` : o.title}${o.isLatest ? ` — ${L.latest}` : ""}`), "");
  const body = editorBlocks(out.join("\n"));

  const ai: string[] = [];
  if (item.summary && item.summary.origin === "ai" && item.summary.text.trim()) ai.push(`### ${L.aiSummary}`, item.summary.text.trim(), "");
  const proposed = (item.decisions ?? []).filter((d) => d.status === "proposed");
  if (proposed.length) ai.push(`### ${L.proposedDecisions}`, ...proposed.map((d) => `- ${d.text}${d.reason ? ` — ${d.reason}` : ""}`), "");
  const open = (item.proposals ?? []).filter((p) => p.status === "open");
  if (open.length)
    ai.push(
      `### ${L.openProposals}`,
      ...open.map((p) => {
        const kind = L.proposalKind[p.kind] ?? p.kind;
        const note = p.note ? ` — ${p.note}` : "";
        // 할 일 제안은 받으면 바로 쓸 수 있게 체크 목록으로
        return p.kind === "task" ? `- [ ] ${p.title ?? ""}${p.due ? ` (${p.due})` : ""} — ${kind}${note}` : `- ${kind}: ${p.title ?? ""}${p.due ? ` → ${p.due}` : ""}${note}`;
      }),
      "",
    );
  const unverified = (item.runs ?? []).flatMap((r) => r.unverified ?? []).filter((x) => x.trim());
  if (unverified.length) ai.push(`### ${L.unverified}`, ...unverified.map((x) => `- ${x}`), "");
  const proposal = ai.length ? editorBlocks([body, "", `## ${L.aiSection}`, "", ...ai].join("\n")) : null;
  return { body, proposal };
}

export interface MigrationV3 {
  /** 새 색인 항목(이미 페이지가 된 업무는 빼고) */
  pages: PageMeta[];
  docs: PageDoc[];
  /** 이행 제안 — proposeBody(origin: migration)로 들일 것 */
  proposals: { pageId: string; body: string }[];
  /** 옛 업무 원본 — archive/v2/{id}.json 에 한 번만 */
  archive: { id: string; text: string }[];
  record: MigrationRecord | null;
}

/**
 * v2 업무를 페이지로 — 같은 id 를 그대로 쓴다(정리 제안 · 판단 기록이 이어진다). 범주 맨 위에 만든 순서대로.
 * 여러 번 돌려도 같다: 이미 색인에 있는 id 는 건너뛴다. 옛 업무 파일은 지우지 않는다.
 */
export function migrateToPages(items: WorkItem[], existing: PageMeta[], workspaces: Workspace[], L: MigrateLabels, nowIso: string): MigrationV3 {
  const have = new Set(existing.map((p) => p.id));
  const known = new Set(workspaces.map((w) => w.id));
  const todo = items.filter((i) => !have.has(i.id) && known.has(i.workspaceId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const out: MigrationV3 = { pages: [], docs: [], proposals: [], archive: [], record: null };
  const byWs = new Map<string, WorkItem[]>();
  for (const it of todo) byWs.set(it.workspaceId, [...(byWs.get(it.workspaceId) ?? []), it]);
  for (const [ws, list] of byWs) {
    const last = childrenOf(existing, ws, null).at(-1)?.order ?? null;
    const keys = keysBetween(last, null, list.length);
    list.forEach((it, i) => {
      const { body, proposal } = migrateItemBody(it, L);
      const doc: PageDoc = { id: it.id, schemaVersion: PAGES_SCHEMA_VERSION, rev: 0, workspaceId: ws, body, sourceIds: [...new Set(it.sourceIds ?? [])], changes: [], updatedAt: it.updatedAt };
      out.docs.push(doc);
      out.pages.push({
        id: it.id,
        workspaceId: ws,
        parentId: null,
        order: keys[i],
        title: it.title,
        createdAt: it.createdAt,
        updatedAt: it.updatedAt,
        rev: 0,
        bodyHash: bodyHashOf(body),
        bodyLen: body.length,
        bodyRef: "file",
        ...(doc.sourceIds.length ? { sourceIds: [...doc.sourceIds] } : {}),
        ...(it.status === "archived" ? { trashedAt: nowIso, trashedBy: it.id } : {}),
      });
      if (proposal) out.proposals.push({ pageId: it.id, body: proposal });
      out.archive.push({ id: it.id, text: JSON.stringify(it, null, 1) });
    });
  }
  if (todo.length) out.record = { id: `pages-v3-${newId()}`, kind: "pages_v3", at: nowIso, sourceIds: [], pageIds: todo.map((i) => i.id), reverted: false };
  return out;
}

/* ───────────────────────── 사람이 읽는 사본(Drive '페이지' 폴더) ───────────────────────── */

/** 사본 파일 이름 — 제목.md(파일 이름에 못 쓰는 글자는 바꾼다) */
export function pageMdName(p: Pick<PageMeta, "title">, untitled: string): string {
  const t = (p.title.trim() || untitled).replace(/[\\/:*?"<>|\n\r\t]/g, "_").slice(0, 120);
  return `${t}.md`;
}

export const pageMdText = (p: Pick<PageMeta, "title">, body: string) => `# ${p.title}\n\n${body}\n`;

/** 사본을 새로 써야 할 페이지 — 기기에 적어 둔 것(id → 지문 · 이름)과 지금 본문 지문 · 이름이 다른 것. 이어서 돌 수 있게 순수 함수로 */
export function mirrorTodo(pages: PageMeta[], mirrored: Record<string, { hash: string; name: string }>, untitled: string): { page: PageMeta; name: string; rename: boolean }[] {
  return pages
    .filter((p) => !p.trashedAt)
    .map((p) => ({ page: p, name: pageMdName(p, untitled), seen: mirrored[p.id] }))
    .filter((x) => !x.seen || x.seen.hash !== x.page.bodyHash || x.seen.name !== x.name)
    .map((x) => ({ page: x.page, name: x.name, rename: !x.seen || x.seen.name !== x.name }));
}

/* ───────────────────────── 파일 이행(읽을 때) ───────────────────────── */

export function upgradeDoc(raw: Record<string, unknown>): PageDoc {
  const d = { ...raw } as unknown as PageDoc;
  d.rev ??= 0;
  d.body = typeof d.body === "string" ? d.body : "";
  d.sourceIds ??= [];
  d.changes ??= [];
  d.schemaVersion = PAGES_SCHEMA_VERSION;
  return d;
}

export function upgradeIndex(raw: Record<string, unknown>, workspaceId: string): PageIndexFile {
  const f = { ...raw } as unknown as PageIndexFile;
  f.rev ??= 0;
  f.workspaceId ??= workspaceId;
  f.pages = (Array.isArray(f.pages) ? f.pages : []).filter((p) => p && typeof p.id === "string").map((p) => ({ ...p, workspaceId: p.workspaceId ?? workspaceId, parentId: p.parentId ?? null, rev: p.rev ?? 0, bodyRef: p.bodyRef ?? "file" }));
  f.schemaVersion = PAGES_SCHEMA_VERSION;
  return f;
}
