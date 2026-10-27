/**
 * 페이지 넘기기 — 페이지 하나(와 그 아래)를 Claude · Codex · Gemma 에게 보내고, 돌아온 새 본문을 '본문 제안'으로 들인다.
 * 옛 업무 맥락 묶음(workHandoff.prepareRun)을 대신한다. 테스트: pageHandoff.test.ts
 *
 * - 묶음 안의 이름: P1 = 이 페이지, P2… = 하위 페이지(트리 순서). 실제 id 는 기록(PageRun)으로 되짚는다.
 * - 하위가 많으면(공고 500개) 한 줄 다이제스트(P#: 제목 · 작은 값 · 본문 길이)를 넣고, 본문은 예산 안에서 앞쪽 몇 개만.
 *   MCP 를 쓰면 llmwiki_read(children: digest | full, cursor)로 나머지를 나눠 읽는다(같은 함수).
 * - 실행자마다 예산이 다르다(executors.ts — Claude · Codex 2만 자, Gemma 5천 자). 넘치면 자르고 몇 개를 뺐는지 적는다.
 * - 결과는 ```llmwiki-page``` 블록 {run, page, body, note, refs}(여럿이면 pages: [...]). 들일 때 검사한다:
 *   목록 보기도 같은 블록으로 — view: {columns: [{key, label, kind}], summary, unit, note} 와 하위마다 props: {키: 값} → 보기 제안 하나(pageView.ts).
 *   묶음 밖 페이지 · 다른 범주(cross_workspace) · 확정 필드 · 다른 묶음의 결과 · 지시문. 들이는 것은 언제나 제안 — 받기 · 빼기는 사람.
 * - 제안의 baseHash 는 묶음을 만들 때의 본문 지문 — 그 사이 사람이 고쳤으면 받을 때 낡음(stale)으로 잡힌다.
 * 묶음의 고정 문구는 앱이 번역 파일에서 넘긴다(PagePackLabels).
 */
import { executorOf } from "./executors.ts";
import { hashText, normalizeResult } from "./hash.ts";
import { scanInjection } from "./inject.ts";
import { ancestors, childrenOf, pageOf, proposeBody, type BodyFlag, type BodyProposal, type BodySkip, type PageMeta, type PageState } from "./pages.ts";
import { proposeView, type ViewProposal, type ViewSkip } from "./pageView.ts";
import { newId } from "./types.ts";
import type { AiTool, WorkManifest } from "./work.ts";

export interface PageRun {
  id: string;
  pageId: string;
  workspaceId: string;
  tool: AiTool;
  /** P1, P2 … 순서대로의 페이지 id */
  refKeys: string[];
  /** 묶음을 만들 때 각 페이지 본문 지문 — 제안의 baseHash */
  baseHashes: Record<string, string>;
  startedAt: string;
  finishedAt?: string | null;
  rawHash?: string | null;
  counts?: { added: number; skipped: number } | null;
}

export interface PagePackLabels {
  /** {title} */
  title: string;
  /** {run} · {at} · {count} · {workspace} */
  meta: string;
  intro: string;
  /** {path} */
  path: string;
  /** 거른 하위만 넣을 때 — {query} · {count} · {total} */
  filtered?: string;
  page: string;
  children: string;
  /** {count} */
  childrenMore: string;
  bodies: string;
  /** {count} */
  bodiesMore: string;
  scope: string;
  rulesTitle: string;
  /** 줄마다 하나 */
  rules: string;
  returnFormat: string;
  returnGuide: string;
}

const DEFAULT_BUDGET = { excerptBudget: 20000, excerptMax: 4000 };
const MAX_RUNS = 20;
/** 하위 본문을 넣을 때 하나라도 이만큼은 — 이보다 적게 남으면 그만 넣는다 */
const MIN_BODY = 300;
/** MCP 전문 읽기 한 번의 분량 · 하위 하나의 최소 몫 */
export const FULL_CHUNK = 40_000;
const FULL_MIN_EACH = 1_500;

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => (v[k] != null ? String(v[k]) : `{${k}}`));

/** 하위 페이지 한 줄 — 제목 · 작은 값 · 본문 길이 · 그 아래 수 */
export function digestLine(pages: PageMeta[], p: PageMeta, ref: string): string {
  const props = Object.entries(p.props ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(" · ");
  const kids = childrenOf(pages, p.workspaceId, p.id).length;
  return `- [${ref}] ${p.title || "-"}${props ? ` · ${props}` : ""} (${p.bodyLen}자${kids ? ` · 하위 ${kids}` : ""})`;
}

/**
 * 하위 전문을 나눠 읽기(MCP llmwiki_read full) — cursor 번째 하위부터 한 번에 약 4만 자.
 * 하위 하나는 max(1500, 40000/n) 자까지만(많을수록 짧게, 너무 짧지는 않게).
 */
export function fullChunk(children: PageMeta[], bodyOf: (p: PageMeta) => string | null, cursor = 0, refOf: (i: number) => string = (i) => `P${i + 2}`): { text: string; next: number | null } {
  const each = Math.max(FULL_MIN_EACH, Math.floor(FULL_CHUNK / Math.max(1, children.length)));
  const out: string[] = [];
  let used = 0;
  let i = Math.max(0, cursor);
  for (; i < children.length; i++) {
    const p = children[i];
    const body = bodyOf(p) ?? "";
    const cut = body.length > each;
    const part = `### [${refOf(i)}] ${p.title}\n\n${body.slice(0, each)}${cut ? "\n…" : ""}\n`;
    if (out.length && used + part.length > FULL_CHUNK) break;
    out.push(part);
    used += part.length;
  }
  return { text: out.join("\n"), next: i < children.length ? i : null };
}

function template(runId: string) {
  return { run: runId, view: { unit: "", summary: "", columns: [], note: "" }, pages: [{ page: "P1", body: "", note: "", refs: ["P2"] }, { page: "P2", props: {} }] };
}

/**
 * 페이지 묶음을 만든다 — 매니페스트에 기록(PageRun)을 더해 돌려준다(저장은 부르는 쪽이).
 * bodies: 이 페이지와 하위 본문(있는 것만 — 앱은 앞쪽 몇 개만 읽어 넘긴다). 없는 본문은 다이제스트로만.
 */
export function preparePageRun(
  state: PageState,
  pageId: string,
  input: { tool: AiTool; scope: string; childIds?: string[] | null; query?: string },
  L: PagePackLabels,
  nowIso: string,
  bodies: Map<string, string>,
): { manifest: WorkManifest; run: PageRun; markdown: string; droppedBodies: number; droppedLines: number } | null {
  const page = pageOf(state.pages, pageId);
  if (!page || page.trashedAt) return null;
  const ws = state.manifest.workspaces.find((w) => w.id === page.workspaceId);
  const all = childrenOf(state.pages, page.workspaceId, page.id);
  // 거른 하위만(펼쳐 보기에서 고른 조건 그대로 — 그 순서로). 이 페이지의 하위가 아닌 id 는 뺀다
  const byId = new Map(all.map((k) => [k.id, k]));
  const kids = input.childIds ? input.childIds.map((id) => byId.get(id)).filter((k): k is PageMeta => !!k) : all;
  const runId = newId();
  const limits = executorOf(input.tool) ?? DEFAULT_BUDGET;
  let budget = limits.excerptBudget;
  const refKeys = [page.id, ...kids.map((k) => k.id)];
  const baseHashes = Object.fromEntries([page, ...kids].map((p) => [p.id, p.bodyHash]));
  const path = [...ancestors(state.pages, page.id).map((a) => a.title), page.title].join(" / ");

  const lines: string[] = [`# ${fill(L.title, { title: page.title })}`, `> ${fill(L.meta, { run: runId, at: nowIso, count: refKeys.length, workspace: ws?.name ?? page.workspaceId })}`, "", L.intro, "", fill(L.path, { path }), ""];
  if (input.childIds && L.filtered) lines.push(`> ${fill(L.filtered, { query: input.query || "-", count: kids.length, total: all.length })}`, "");
  const own = bodies.get(page.id) ?? "";
  const ownPart = own.slice(0, Math.min(budget, limits.excerptMax * 2));
  budget -= ownPart.length;
  lines.push(`## [P1] ${L.page}`, "", "```markdown", ownPart + (ownPart.length < own.length ? "\n…" : ""), "```", "");

  let droppedLines = 0;
  if (kids.length) {
    lines.push(`## ${L.children}`);
    kids.forEach((k, i) => {
      const line = digestLine(state.pages, k, `P${i + 2}`);
      if (budget - line.length < MIN_BODY) return void droppedLines++;
      lines.push(line);
      budget -= line.length + 1;
    });
    if (droppedLines) lines.push(`> ${fill(L.childrenMore, { count: droppedLines })}`);
    lines.push("");
  }

  let droppedBodies = 0;
  const withBody = kids.map((k, i) => ({ k, i, body: bodies.get(k.id) })).filter((x) => x.body != null);
  if (withBody.length) {
    lines.push(`## ${L.bodies}`, "");
    withBody.forEach(({ k, i, body }, n) => {
      const share = Math.min(limits.excerptMax, Math.floor(budget / Math.max(1, withBody.length - n)));
      if (share < MIN_BODY) return void droppedBodies++;
      const text = (body as string).slice(0, share);
      const part = `### [P${i + 2}] ${k.title}\n\n${text}${text.length < (body as string).length ? "\n…" : ""}\n`;
      budget -= part.length;
      lines.push(part);
    });
    if (droppedBodies) lines.push(`> ${fill(L.bodiesMore, { count: droppedBodies })}`, "");
  }

  lines.push(`## ${L.scope}`, input.scope.trim() || "-", "");
  lines.push(`## ${L.rulesTitle}`, ...L.rules.split("\n").filter(Boolean).map((r) => `- ${r}`), "");
  lines.push(`## ${L.returnFormat}`, L.returnGuide, "", "```llmwiki-page", JSON.stringify(template(runId), null, 2), "```");

  const run: PageRun = { id: runId, pageId: page.id, workspaceId: page.workspaceId, tool: input.tool, refKeys, baseHashes, startedAt: nowIso, finishedAt: null };
  const pageRuns = [...(state.manifest.pageRuns ?? []), run].slice(-MAX_RUNS);
  return { manifest: { ...state.manifest, pageRuns }, run, markdown: lines.join("\n"), droppedBodies, droppedLines };
}

/* ───────────────────────── 해석 · 들이기 ───────────────────────── */

export interface ParsedPageResult {
  run?: string;
  entries: { page: string; body: string; note?: string; refs: string[]; props?: Record<string, unknown> }[];
  /** 목록 보기 칸(view.columns) — 그대로 넘기고 proposeView 가 거른다 */
  columns?: unknown[];
  /** 왜 이 칸인지(view.note) */
  viewNote?: string;
  /** 전체 요약 · 세는 말(view.summary · view.unit) */
  summary?: string;
  unit?: string;
  /** 확정 · 적용을 시도한 필드(무시한다) */
  forbidden: string[];
  found: boolean;
}

const FORBIDDEN = new Set(["status", "completed", "confirm", "confirmed", "final", "approve", "approved", "apply", "applied", "accepted", "accept", "delete", "remove", "move", "trash"]);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x).trim()).filter(Boolean) : typeof v === "string" && v.trim() ? [v.trim()] : []);

export function parsePageResult(text: string): ParsedPageResult {
  const t = normalizeResult(text);
  const out: ParsedPageResult = { entries: [], forbidden: [], found: false };
  const forbidden = new Set<string>();
  for (const b of t.matchAll(/```\s*(llmwiki-page|json)\s*\n([\s\S]*?)\n```/gi)) {
    let o: unknown;
    try {
      o = JSON.parse(b[2]);
    } catch {
      continue;
    }
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    const obj = o as Record<string, unknown>;
    const view = obj.view && typeof obj.view === "object" ? (obj.view as Record<string, unknown>) : null;
    const list = Array.isArray(obj.pages) ? (obj.pages as Record<string, unknown>[]) : "body" in obj || "props" in obj ? [obj] : view ? [] : null;
    if (!list) continue;
    out.found = true;
    if (view && Array.isArray(view.columns) && view.columns.length) out.columns = view.columns;
    if (view && str(view.note).trim()) out.viewNote = str(view.note).trim();
    if (view && str(view.summary).trim()) out.summary = str(view.summary).trim();
    if (view && str(view.unit).trim()) out.unit = str(view.unit).trim();
    out.run ??= str(obj.run).trim() || undefined;
    for (const k of Object.keys(obj)) if (FORBIDDEN.has(k.toLowerCase())) forbidden.add(k);
    for (const x of list) {
      if (!x || typeof x !== "object") continue;
      for (const k of Object.keys(x)) if (FORBIDDEN.has(k.toLowerCase())) forbidden.add(k);
      const body = str(x.body);
      const props = x.props && typeof x.props === "object" && !Array.isArray(x.props) && Object.keys(x.props).length ? (x.props as Record<string, unknown>) : undefined;
      // 템플릿을 그대로 돌려준 빈 칸은 버린다
      if (!body.trim() && !props) continue;
      out.entries.push({ page: str(x.page).trim() || "P1", body, note: str(x.note).trim() || undefined, refs: strs(x.refs), ...(props ? { props } : {}) });
    }
  }
  out.forbidden = [...forbidden];
  return out;
}

export type PageResultSkip = BodySkip | ViewSkip | "out_of_scope";
export type PageResultWarning = "forbidden_fields" | "run_mismatch" | "injection" | "no_block";

export type PageResultImport =
  | { kind: "no_run" }
  | { kind: "duplicate"; runId: string }
  | {
      kind: "imported";
      manifest: WorkManifest;
      runId: string;
      rawHash: string;
      /** 들인 제안과 그 본문(원문은 raw/{rawHash}.txt 로 — 부르는 쪽이 쓴다) */
      added: { proposal: BodyProposal; body: string }[];
      /** 목록 보기 제안(칸 · 하위 값) — 묶음마다 하나까지 */
      views: ViewProposal[];
      skipped: { index: number; reason: PageResultSkip }[];
      warnings: PageResultWarning[];
    };

/**
 * 결과를 본문 제안으로 들인다 — 같은 원문은 한 번만. 형식을 못 읽어도 버리지 않고 경고와 함께 0개.
 * 묶음에 넣은 페이지(P1 · P2 …)만, 묶음 범주 안에서만. 사람이 붙여 넣은 것이라 비공개 범주 묶음도 받는다(묶음을 만든 것도 사람).
 */
export function importPageResult(state: PageState, text: string, nowIso: string, opts: { runId?: string | null; tool?: AiTool | null } = {}): PageResultImport {
  const parsed = parsePageResult(text);
  const runs = state.manifest.pageRuns ?? [];
  const want = opts.runId ?? parsed.run ?? null;
  const run = runs.find((r) => r.id === want) ?? (parsed.run ? runs.find((r) => r.id === parsed.run) : undefined);
  if (!run) return { kind: "no_run" };
  const rawHash = hashText(normalizeResult(text));
  if (run.rawHash === rawHash) return { kind: "duplicate", runId: run.id };

  const warnings: PageResultWarning[] = [];
  if (!parsed.found) warnings.push("no_block");
  if (parsed.forbidden.length) warnings.push("forbidden_fields");
  if (parsed.run && parsed.run !== run.id) warnings.push("run_mismatch");
  if (scanInjection(text).length) warnings.push("injection");
  const runFlags: BodyFlag[] = [...(parsed.forbidden.length ? (["forbidden_fields"] as BodyFlag[]) : []), ...(parsed.run && parsed.run !== run.id ? (["run_mismatch"] as BodyFlag[]) : [])];

  const resolve = (label: string) => {
    const m = /^P(\d+)$/i.exec(label);
    return m ? (run.refKeys[Number(m[1]) - 1] ?? label) : label;
  };
  const known = new Set(run.refKeys);
  let manifest = state.manifest;
  const added: { proposal: BodyProposal; body: string }[] = [];
  const skipped: { index: number; reason: PageResultSkip }[] = [];
  const values: Record<string, Record<string, unknown>> = {};
  parsed.entries.forEach((e, index) => {
    const pageId = resolve(e.page);
    if (!known.has(pageId)) return skipped.push({ index, reason: pageOf(state.pages, pageId) ? "out_of_scope" : "unknown_page" });
    if (e.props && pageId !== run.pageId) values[pageId] = e.props;
    if (!e.body.trim()) return;
    const refs = e.refs.filter((r) => /^P\d+(:\d+(-\d+)?)?$/i.test(r) && Number(/^P(\d+)/i.exec(r)?.[1]) <= run.refKeys.length);
    const flags: BodyFlag[] = [...runFlags, ...(refs.length < e.refs.length ? (["bad_refs"] as BodyFlag[]) : [])];
    const r = proposeBody({ manifest, pages: state.pages }, { pageId, body: e.body, note: e.note, refs, tool: opts.tool ?? run.tool, runId: run.id, baseHash: run.baseHashes[pageId] ?? null, flags }, nowIso, { workspaceId: run.workspaceId, includePrivate: true });
    if (r.kind === "skipped") return skipped.push({ index, reason: r.reason });
    manifest = r.manifest;
    added.push({ proposal: r.proposal, body: r.body });
  });
  const views: ViewProposal[] = [];
  if (parsed.columns?.length || Object.keys(values).length || parsed.summary) {
    const note = parsed.viewNote ?? parsed.entries.find((e) => resolve(e.page) === run.pageId)?.note;
    const v = proposeView({ manifest, pages: state.pages }, { pageId: run.pageId, columns: parsed.columns, values, summary: parsed.summary, unit: parsed.unit, note, tool: opts.tool ?? run.tool, runId: run.id, flags: runFlags }, nowIso, { workspaceId: run.workspaceId, includePrivate: true });
    if (v.kind === "ok") {
      manifest = v.manifest;
      views.push(v.proposal);
    } else skipped.push({ index: -1, reason: v.reason });
  }
  const count = added.length + views.length;
  const pageRuns = (manifest.pageRuns ?? []).map((x) => (x.id === run.id ? { ...x, finishedAt: nowIso, rawHash, counts: { added: count, skipped: skipped.length } } : x));
  return { kind: "imported", manifest: { ...manifest, pageRuns }, runId: run.id, rawHash, added, views, skipped, warnings };
}

/** 실행 도구(tools/handoff/run.mjs)가 결과 맨 앞에 붙이는 한 줄 — 모델 · 걸린 시간. 없으면 null */
export function runMeta(text: string): { executor?: string; model?: string; latencyMs?: number } | null {
  const m = /^\s*<!--\s*llmwiki-run\s+(\{[^\n]*\})\s*-->/.exec(text);
  if (!m) return null;
  try {
    const o = JSON.parse(m[1]) as Record<string, unknown>;
    return {
      ...(typeof o.executor === "string" ? { executor: o.executor.slice(0, 40) } : {}),
      ...(typeof o.model === "string" ? { model: o.model.slice(0, 120) } : {}),
      ...(typeof o.latencyMs === "number" && o.latencyMs >= 0 ? { latencyMs: Math.round(o.latencyMs) } : {}),
    };
  } catch {
    return null;
  }
}
