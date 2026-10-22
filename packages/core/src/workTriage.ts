/**
 * 받은 것 정리 묶음 — 정리 대기 조각을 Claude · Codex 에게 보내고, 돌아온 정리 제안을 들인다.
 * 업무 맥락 묶음(workHandoff.ts)과 같은 원칙:
 * - 조각 발췌에는 줄 번호(S1:3)를 붙이고 AI 는 refs 로 근거를 댄다. 없는 줄을 대면 그 근거를 빼고 표시한다.
 * - 조각 · 페이지는 묶음 안의 이름(S1 · P1)으로만 가리킨다. 실제 id 는 앱이 기록(TriageRun)으로 되짚는다(옛 W1 도 받는다).
 * - 이 범주(주제)의 조각과 페이지만 넣는다. 다른 범주는 보이지도 않는다(Claude 는 범주를 넘지 않는다).
 * - 페이지는 색인만 — 'P#: 경로/제목'. 자식이 많은 페이지(공고 500개)는 아래를 펼치지 않고 수만 적는다.
 * - 결과에 확정 · 완료 필드가 오면 무시하고, 지시문으로 보이는 말은 표시만 한다 — 들이는 것은 언제나 제안.
 * 묶음의 고정 문구는 앱이 번역 파일에서 넘긴다(TriageLabels).
 */
import { executorOf } from "./executors.ts";
import { scanInjection } from "./inject.ts";
import { ancestors, childrenOf, type PageMeta } from "./pages.ts";
import { newId } from "./types.ts";
import {
  hashText,
  inboxSources,
  normalizeResult,
  proposeTriage,
  type AiTool,
  type Source,
  type TriageFlag,
  type TriageInput,
  type TriageKind,
  type TriageProposal,
  type TriageRun,
  type TriageSkip,
  type TriageState,
  type WorkManifest,
} from "./work.ts";

export interface TriageLabels {
  /** {workspace} */
  title: string;
  /** {run} · {at} · {count} */
  meta: string;
  intro: string;
  fragments: string;
  works: string;
  worksNone: string;
  concepts: string;
  conceptsNone: string;
  rulesTitle: string;
  /** 줄마다 하나 */
  rules: string;
  returnFormat: string;
  returnGuide: string;
  /** {titles} */
  droppedBudget: string;
}

const MAX_RUNS = 20;
const MAX_FRAGMENTS = 30;
const DEFAULT_BUDGET = { excerptBudget: 20000, excerptMax: 4000 };

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => (v[k] != null ? String(v[k]) : `{${k}}`));

function numbered(ref: string, text: string, max: number): { body: string; count: number; cut: boolean } {
  const src = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < src.length; i++) {
    const line = `${ref}:${i + 1}| ${src[i]}`;
    if (used + line.length + 1 > max && out.length) return { body: out.join("\n"), count: out.length, cut: true };
    out.push(line.length > max ? line.slice(0, max) : line);
    used += line.length + 1;
  }
  return { body: out.join("\n"), count: out.length, cut: false };
}

function template(runId: string) {
  return {
    run: runId,
    triage: [
      { kind: "file_source", sources: ["S1"], page: "P1", note: "", refs: ["S1:1"] },
      { kind: "new_page", sources: ["S2"], title: "", parent: "P1", note: "", refs: ["S2:1"] },
      { kind: "concept_link", sources: ["S1"], concept: "", refs: ["S1:1"] },
    ],
  };
}

/** 묶음에 넣을 페이지 수 — 자식이 이보다 많은 페이지는 아래를 펼치지 않는다 */
const MAX_PAGES = 150;
const WIDE = 30;

/** 이 범주의 살아 있는 페이지를 트리 순서로(넓은 페이지의 아래는 빼고) — P1, P2 … */
export function triagePages(pages: PageMeta[], workspaceId: string): { page: PageMeta; path: string; hidden: number }[] {
  const out: { page: PageMeta; path: string; hidden: number }[] = [];
  const walk = (parentId: string | null) => {
    for (const p of childrenOf(pages, workspaceId, parentId)) {
      if (out.length >= MAX_PAGES) return;
      const kids = childrenOf(pages, workspaceId, p.id).length;
      const path = [...ancestors(pages, p.id).map((a) => a.title), p.title].join("/");
      out.push({ page: p, path, hidden: kids > WIDE ? kids : 0 });
      if (kids && kids <= WIDE) walk(p.id);
    }
  };
  walk(null);
  return out;
}

/**
 * 정리 묶음을 만든다. 조각이 없으면 null. 매니페스트에 기록(TriageRun)을 더해 돌려준다 — 저장은 부르는 쪽이.
 * excerpt: 조각 본문(메모 · 붙여 넣기는 text, Drive 자료는 기기 캐시). 없으면 제목 · 링크만 넣는다.
 */
export function prepareTriage(
  state: TriageState,
  workspaceId: string,
  input: { tool: AiTool },
  L: TriageLabels,
  nowIso: string,
  excerpt: (s: Source) => string | null = (s) => s.text ?? null,
): { manifest: WorkManifest; run: TriageRun; markdown: string; dropped: Source[] } | null {
  const frags = inboxSources(state, workspaceId).slice(0, MAX_FRAGMENTS).reverse(); // 오래된 것부터 S1
  if (!frags.length) return null;
  const ws = state.manifest.workspaces.find((w) => w.id === workspaceId);
  const pages = triagePages(state.pages, workspaceId);
  const concepts = [...new Set(state.sources.filter((s) => s.workspaceId === workspaceId).flatMap((s) => s.concepts ?? []))].slice(0, 100);
  const runId = newId();
  const limits = executorOf(input.tool) ?? DEFAULT_BUDGET;
  let budget = limits.excerptBudget;
  const refLines: Record<string, number> = {};
  const dropped: Source[] = [];

  const lines: string[] = [`# ${fill(L.title, { workspace: ws?.name ?? workspaceId })}`, `> ${fill(L.meta, { run: runId, at: nowIso, count: frags.length })}`, "", L.intro, ""];
  lines.push(`## ${L.fragments}`);
  frags.forEach((s, i) => {
    const ref = `S${i + 1}`;
    lines.push(`### [${ref}] ${s.title}${s.url ? ` <${s.url}>` : ""}`, `- ${s.provider} · ${s.createdAt}`);
    const text = excerpt(s) ?? (s.url ? s.url : null);
    if (text && budget > 0) {
      const { body, count, cut } = numbered(ref, text, Math.min(limits.excerptMax, budget));
      budget -= body.length;
      refLines[ref] = count;
      lines.push("", "```text", body + (cut ? "\n…" : ""), "```");
    } else if (text) dropped.push(s);
    lines.push("");
  });
  if (dropped.length) lines.push(`> ${fill(L.droppedBudget, { titles: dropped.map((s) => s.title).join(", ") })}`, "");

  lines.push(`## ${L.works}`);
  if (!pages.length) lines.push(L.worksNone);
  pages.forEach((x, i) => lines.push(`- [P${i + 1}] ${x.path}${x.hidden ? ` (+${x.hidden})` : ""}`));
  lines.push("", `## ${L.concepts}`, concepts.length ? concepts.join(", ") : L.conceptsNone, "");
  lines.push(`## ${L.rulesTitle}`, ...L.rules.split("\n").filter(Boolean).map((r) => `- ${r}`), "");
  lines.push(`## ${L.returnFormat}`, L.returnGuide, "", "```llmwiki-triage", JSON.stringify(template(runId), null, 2), "```");

  const run: TriageRun = { id: runId, workspaceId, tool: input.tool, sourceIds: frags.map((s) => s.id), itemIds: pages.map((x) => x.page.id), refLines, startedAt: nowIso, finishedAt: null };
  const runs = [...(state.manifest.triageRuns ?? []), run].slice(-MAX_RUNS);
  return { manifest: { ...state.manifest, triageRuns: runs }, run, markdown: lines.join("\n"), dropped };
}

/* ───────────────────────── 해석 · 가져오기 ───────────────────────── */

export interface ParsedTriage {
  run?: string;
  entries: { kind: TriageKind; sources: string[]; work?: string; parent?: string; title?: string; concept?: string; note?: string; refs: string[] }[];
  /** 확정 · 완료를 시도한 필드(무시한다) */
  forbidden: string[];
  found: boolean;
}

const KINDS = new Set<TriageKind>(["file_source", "new_page", "new_work", "concept_link"]);
const FORBIDDEN = new Set(["status", "completed", "confirm", "confirmed", "final", "approve", "approved", "apply", "accepted", "dismiss", "delete", "remove"]);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === "string" && v.trim() ? [v.trim()] : []);

export function parseTriage(text: string): ParsedTriage {
  const t = normalizeResult(text);
  const blocks = [...t.matchAll(/```\s*(llmwiki-triage|llmwiki-result|json)\s*\n([\s\S]*?)```/gi)].sort((a, b) => (a[1].toLowerCase() === "llmwiki-triage" ? -1 : b[1].toLowerCase() === "llmwiki-triage" ? 1 : 0));
  for (const b of blocks) {
    let o: unknown;
    try {
      o = JSON.parse(b[2]);
    } catch {
      continue;
    }
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    const obj = o as Record<string, unknown>;
    const list = Array.isArray(obj.triage) ? (obj.triage as Record<string, unknown>[]) : null;
    if (!list) continue;
    const forbidden = new Set<string>();
    for (const k of Object.keys(obj)) if (FORBIDDEN.has(k.toLowerCase())) forbidden.add(k);
    const entries: ParsedTriage["entries"] = [];
    for (const x of list) {
      if (!x || typeof x !== "object") continue;
      for (const k of Object.keys(x)) if (FORBIDDEN.has(k.toLowerCase())) forbidden.add(k);
      const raw = str(x.kind) as TriageKind;
      if (!KINDS.has(raw)) continue;
      // 옛 묶음 · 옛 MCP 의 new_work 는 new_page 로(목표는 note 에)
      const kind: TriageKind = raw === "new_work" ? "new_page" : raw;
      const goal = str(x.goal);
      const note = [str(x.note ?? x.reason), raw === "new_work" ? goal : ""].filter(Boolean).join(" — ");
      const e = { kind, sources: strs(x.sources ?? x.source), work: str(x.page ?? x.work ?? x.item) || undefined, parent: str(x.parent) || undefined, title: str(x.title) || undefined, concept: str(x.concept) || undefined, note: note || undefined, refs: strs(x.refs) };
      // 템플릿을 그대로 돌려준 빈 칸은 버린다
      if (kind === "new_page" && !e.title) continue;
      if (kind === "concept_link" && !e.concept) continue;
      entries.push(e);
    }
    return { run: str(obj.run) || undefined, entries, forbidden: [...forbidden], found: true };
  }
  return { entries: [], forbidden: [], found: false };
}

export type TriageImport =
  | { kind: "no_run" }
  | { kind: "duplicate"; runId: string }
  | {
      kind: "imported";
      manifest: WorkManifest;
      runId: string;
      rawHash: string;
      added: TriageProposal[];
      skipped: { index: number; reason: TriageSkip }[];
      /** 묶음 전체의 경고 — 확정 필드 · 다른 요청의 결과 · 지시문 · 형식 없음 */
      warnings: ("forbidden_fields" | "run_mismatch" | "injection" | "no_block")[];
    };

const REF = /^S(\d+):(\d+)(?:-(\d+))?$/;

/**
 * 정리 결과를 들인다. 같은 원문은 한 번만. 형식을 못 읽어도 실패로 버리지 않고 경고와 함께 0개를 돌려준다
 * (원문은 부르는 쪽이 raw/ 에 남긴다).
 */
export function importTriage(state: TriageState, text: string, nowIso: string, opts: { runId?: string | null; tool?: AiTool | null } = {}): TriageImport {
  const parsed = parseTriage(text);
  const runs = state.manifest.triageRuns ?? [];
  const runId = opts.runId ?? parsed.run ?? null;
  const run = runs.find((r) => r.id === runId) ?? (parsed.run ? runs.find((r) => r.id === parsed.run) : undefined);
  if (!run) return { kind: "no_run" };
  const rawHash = hashText(normalizeResult(text));
  if (run.rawHash === rawHash) return { kind: "duplicate", runId: run.id };

  const warnings: ("forbidden_fields" | "run_mismatch" | "injection" | "no_block")[] = [];
  if (!parsed.found) warnings.push("no_block");
  if (parsed.forbidden.length) warnings.push("forbidden_fields");
  if (parsed.run && parsed.run !== run.id) warnings.push("run_mismatch");
  if (scanInjection(text).length) warnings.push("injection");

  const src = (label: string) => {
    const m = /^S(\d+)$/i.exec(label);
    return m ? (run.sourceIds[Number(m[1]) - 1] ?? label) : label;
  };
  const page = (label?: string) => {
    if (!label) return null;
    const m = /^[PW](\d+)$/i.exec(label);
    return m ? (run.itemIds[Number(m[1]) - 1] ?? label) : label;
  };
  const inputs: TriageInput[] = parsed.entries.map((e) => {
    const flags: TriageFlag[] = [];
    const good = e.refs.filter((r) => {
      const m = REF.exec(r);
      if (!m) return false;
      const max = run.refLines[`S${m[1]}`] ?? 0;
      const from = Number(m[2]);
      const to = m[3] ? Number(m[3]) : from;
      return from >= 1 && to >= from && to <= max;
    });
    if (good.length < e.refs.length) flags.push("bad_refs");
    if (scanInjection([e.note, e.title, e.concept].filter(Boolean).join("\n")).length) flags.push("injection_suspect");
    return {
      kind: e.kind,
      sourceIds: e.sources.map(src),
      itemId: page(e.work),
      parentId: page(e.parent),
      title: e.title,
      concept: e.concept,
      note: e.note,
      refs: good,
      ...(flags.length ? { flags } : {}),
    };
  });
  const tool = opts.tool ?? run.tool;
  const r = proposeTriage(state, inputs, nowIso, { runId: run.id, tool });
  const triageRuns = (r.manifest.triageRuns ?? []).map((x) => (x.id === run.id ? { ...x, finishedAt: nowIso, rawHash, counts: { added: r.added.length, skipped: r.skipped.length } } : x));
  return { kind: "imported", manifest: { ...r.manifest, triageRuns }, runId: run.id, rawHash, added: r.added, skipped: r.skipped, warnings };
}
