/**
 * Claude · Codex 와 일을 주고받는 길 — 내보내기(맥락 묶음)와 가져오기(결과 해석).
 *
 * - 대화 전체를 넣지 않는다. 이번 작업에 필요한 목표 · 상태 · 확정 결정 · 자료 발췌 · 범위만 묶는다.
 * - AI 가 Drive 링크를 직접 열 수 있다고 가정하지 않는다 — 접근 방법과 한계를 함께 적는다.
 * - 다른 작업실 자료는 기본으로 빼고, 뺐다는 사실만 적는다.
 * - 결과는 구조화된 블록(llmwiki-result)을 먼저 읽고, 없으면 제목(##) 으로, 그것도 안 되면 원문만 남긴다.
 * - AI 가 "완료했다" 고 써도 업무 · 할 일을 완료 처리하지 않는다. 결정 · 할 일 · 최신본은 제안으로만 들어온다.
 * - 실행자(Claude · Codex · Gemma)마다 자료 예산이 다르다(executors.ts). 넘치는 자료는 통째로 빼고 이름을 남긴다.
 * - 자료 발췌에는 줄 번호(S1:12)를 붙여, AI 가 근거를 대게 한다. 가져올 때 코드가 검사한다:
 *   없는 자료 · 줄 참조, 근거 줄에 없는 마감, 확정 · 완료 필드, 다른 요청의 결과, 지시문으로 보이는 말.
 *   문제가 있어도 결과를 버리지 않고 경고(flags · attention)로 보인다 — 판단은 사람이 한다.
 * 묶음의 고정 문구(제목 · 안내)는 앱이 번역 파일에서 넘긴다(HandoffLabels).
 */
import { executorOf } from "./executors.ts";
import { scanInjection } from "./inject.ts";
import { newId } from "./types.ts";
import {
  hashText,
  normalizeResult,
  withChange,
  type AiRun,
  type AiTool,
  type Decision,
  type Msg,
  type Output,
  type Proposal,
  type ProposalFlag,
  type RunFlag,
  type Source,
  type WorkItem,
  type Workspace,
} from "./work.ts";

export interface HandoffLabels {
  title: string;
  meta: string;
  goal: string;
  doneCriteria: string;
  status: string;
  summaryNone: string;
  summaryStale: string;
  decisions: string;
  decisionsNone: string;
  sources: string;
  sourcesNone: string;
  sourceAccess: string;
  sourceNoExcerpt: string;
  excludedCross: string;
  scope: string;
  taskDone: string;
  openQuestions: string;
  openNone: string;
  nextActions: string;
  returnFormat: string;
  returnGuide: string;
  /** 볼 수 있는 범위와 지킬 것 — 줄마다 한 항목 */
  rules: string;
  rulesTitle: string;
  /** 예산 때문에 발췌를 넣지 못한 자료({titles}) */
  droppedBudget: string;
}

/** 실행자를 모를 때(다른 AI) — Claude · Codex 와 같은 예산 */
const DEFAULT_BUDGET = { excerptBudget: 20000, excerptMax: 4000 };
/** 이보다 적게 남으면 자료를 반쯤 자르지 않고 통째로 뺀다 */
const MIN_EXCERPT = 300;

export interface PrepareInput {
  tool: AiTool;
  scope: string;
  doneCriteria?: string;
  includeCross?: boolean;
  /** 지금 상태의 이름(번역된 말). 없으면 상태 값 그대로 */
  statusLabel?: string;
}

const fill = (s: string, params: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));

/**
 * 맥락 묶음을 만들고, 업무에 "준비됨" AI 작업을 남긴다.
 * excerpt(sourceId, version) 는 기기 캐시에서 원본 발췌를 돌려준다(없으면 링크만).
 */
export function prepareRun(
  item: WorkItem,
  sources: Source[],
  workspaces: Workspace[],
  input: PrepareInput,
  L: HandoffLabels,
  nowIso: string,
  excerpt: (s: Source) => string | null = (s) => s.text ?? null,
): { item: WorkItem; run: AiRun; markdown: string; excluded: Source[]; dropped: Source[] } {
  const linked = sources.filter((s) => item.sourceIds.includes(s.id));
  const included = linked.filter((s) => s.workspaceId === item.workspaceId || input.includeCross);
  const excluded = linked.filter((s) => !included.includes(s));
  const ws = workspaces.find((w) => w.id === item.workspaceId);
  const runId = newId();

  const lines: string[] = [];
  lines.push(`## ${L.goal}`, item.goal || "-", "");
  if (item.doneCriteria.length) lines.push(`## ${L.doneCriteria}`, ...item.doneCriteria.map((c) => `- ${c}`), "");
  lines.push(`## ${L.status}`, `- ${input.statusLabel ?? item.status}`);
  if (item.summary) {
    lines.push(item.summary.text);
    const stale = linked.filter((s) => item.summary?.basedOn[s.id] && s.remoteVersion && item.summary.basedOn[s.id] !== s.remoteVersion);
    if (stale.length) lines.push(`> ${fill(L.summaryStale, { titles: stale.map((s) => s.title).join(", ") })}`);
  } else lines.push(L.summaryNone);
  lines.push("");
  const open = item.actions.filter((a) => !a.done);
  if (open.length) lines.push(`## ${L.nextActions}`, ...open.map((a) => `- ${a.title}${a.due ? ` (${a.due})` : ""}`), "");

  const confirmed = item.decisions.filter((d) => d.status === "confirmed");
  lines.push(`## ${L.decisions}`);
  if (confirmed.length) for (const d of confirmed) lines.push(`- ${d.text}${d.reason ? ` — ${d.reason}` : ""}`);
  else lines.push(L.decisionsNone);
  lines.push("");

  lines.push(`## ${L.sources}`);
  if (!included.length) lines.push(L.sourcesNone);
  const limits = executorOf(input.tool) ?? DEFAULT_BUDGET;
  let budget = limits.excerptBudget;
  const versions: Record<string, string> = {};
  const refKeys: string[] = [];
  const refLines: Record<string, number> = {};
  const dropped: Source[] = [];
  included.forEach((s, i) => {
    const ref = `S${i + 1}`;
    refKeys.push(ref);
    if (s.remoteVersion) versions[s.id] = s.remoteVersion;
    const link = s.url ? ` <${s.url}>` : "";
    lines.push(`### [${ref}] ${s.title}${link}`);
    lines.push(`- ${s.provider} · ${s.format}${s.remoteVersion ? ` · v${s.remoteVersion}` : ""}${s.remoteModifiedAt ? ` · ${s.remoteModifiedAt}` : ""}`);
    if (s.provider === "drive" || s.provider === "link") lines.push(`- ${L.sourceAccess}`);
    const text = excerpt(s);
    if (text && budget >= Math.min(MIN_EXCERPT, text.length)) {
      const { body, count, cut } = numberedExcerpt(ref, text, Math.min(limits.excerptMax, budget));
      budget -= body.length;
      refLines[ref] = count;
      lines.push("", "```text", body + (cut ? "\n…" : ""), "```");
    } else {
      if (text) dropped.push(s);
      lines.push(`- ${L.sourceNoExcerpt}`);
    }
    lines.push("");
  });
  if (excluded.length) lines.push(`> ${fill(L.excludedCross, { count: excluded.length })}`, "");
  if (dropped.length) lines.push(`> ${fill(L.droppedBudget, { titles: dropped.map((s) => s.title).join(", ") })}`, "");

  lines.push(`## ${L.scope}`, input.scope.trim() || "-", "");
  lines.push(`## ${L.taskDone}`, (input.doneCriteria ?? "").trim() || "-", "");
  const pending = [...item.decisions.filter((d) => d.status === "proposed").map((d) => d.text), ...item.runs.flatMap((r) => r.unverified)];
  lines.push(`## ${L.openQuestions}`, ...(pending.length ? pending.map((p) => `- ${p}`) : [L.openNone]), "");

  lines.push(`## ${L.rulesTitle}`, ...L.rules.split("\n").filter(Boolean).map((r) => `- ${r}`), "");
  lines.push(`## ${L.returnFormat}`, L.returnGuide, "", "```llmwiki-result", JSON.stringify(resultTemplate(runId), null, 2), "```");

  const body = lines.join("\n");
  const contextVersion = `r${item.rev}-${hashText(body).slice(0, 10)}`;
  const head = [`# ${fill(L.title, { title: item.title })}`, `> ${fill(L.meta, { workspace: ws?.name ?? item.workspaceId, version: contextVersion, run: runId, at: nowIso })}`, ""];
  const markdown = [...head, body].join("\n");

  const run: AiRun = {
    id: runId,
    tool: input.tool,
    goal: input.scope.trim(),
    scope: input.scope.trim(),
    contextVersion,
    inputSourceIds: included.map((s) => s.id),
    inputSourceVersions: versions,
    status: "prepared",
    done: [],
    outputIds: [],
    remaining: [],
    unverified: [],
    refKeys,
    refLines,
    startedAt: nowIso,
    finishedAt: null,
  };
  return { item: { ...item, runs: [...item.runs, run], updatedAt: nowIso }, run, markdown, excluded, dropped };
}

/** 줄마다 "S1:12| " 를 붙여 max 글자 안에서 줄 단위로 자른다 */
function numberedExcerpt(ref: string, text: string, max: number): { body: string; count: number; cut: boolean } {
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

function resultTemplate(runId: string) {
  return {
    run: runId,
    summary: "",
    done: [""],
    outputs: [{ title: "", url: "", refs: ["S1:1"] }],
    decisions: [{ text: "", reason: "", replaces: "", refs: ["S1:1"] }],
    tasks: [{ title: "", due: "YYYY-MM-DD", refs: ["S1:1"] }],
    unverified: [""],
    remaining: [""],
  };
}

// 지시문 검사는 inject.ts 로 옮겼다 — 예전 import 길을 위해 다시 내보낸다
export { composeJamo, scanInjection } from "./inject.ts";

/* ───────────────────────── 해석 ───────────────────────── */

export interface ParsedResult {
  structured: "json" | "headings" | "none";
  run?: string;
  summary?: string;
  done: string[];
  outputs: { title: string; url?: string; refs?: string[] }[];
  decisions: { text: string; reason: string; replaces?: string; refs?: string[] }[];
  tasks: { title: string; due?: string | null; refs?: string[] }[];
  unverified: string[];
  remaining: string[];
  /** 확정 · 완료를 시도한 필드 이름(무시한다) */
  forbidden?: string[];
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean) : typeof v === "string" && v.trim() ? [v.trim()] : []);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

/** 결과에 있으면 안 되는 필드 — 확정 · 완료는 사람이 한다 */
const FORBIDDEN = new Set(["status", "completed", "confirm", "confirmed", "final", "approve", "approved", "apply", "accepted"]);

function* keysDeep(o: unknown): Generator<string> {
  if (Array.isArray(o)) for (const v of o) yield* keysDeep(v);
  else if (o && typeof o === "object")
    for (const [k, v] of Object.entries(o)) {
      yield k;
      yield* keysDeep(v);
    }
}

type Obj = Record<string, unknown>;
const refsOf = (x: Obj): string[] | undefined => {
  const r = strs(x?.refs ?? x?.source_refs);
  return r.length ? r : undefined;
};

/**
 * 예전 위임 형식(run_id · artifacts · decision_proposals · todo_proposals · unverified[{text, why}]) —
 * 로컬 모델 검증(tools/local-model-eval)에서 쓰던 모양도 받는다.
 */
function fromLegacy(o: Obj): Obj {
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Obj[]) : []);
  return {
    run: o.run_id,
    summary: arr(o.artifacts).map((a) => str(a?.summary)).filter(Boolean).join("\n") || undefined,
    outputs: arr(o.artifacts).map((a) => ({ title: a?.title, url: a?.url, refs: a?.source_refs })),
    decisions: arr(o.decision_proposals),
    tasks: arr(o.todo_proposals).map((t) => ({ title: t?.text ?? t?.title, due: t?.due, refs: t?.source_refs })),
    unverified: arr(o.unverified).map((u) => (typeof u === "string" ? u : [str(u?.text), str(u?.why)].filter(Boolean).join(" — "))),
    remaining: o.remaining,
  };
}

function fromJson(raw: Obj): ParsedResult {
  const forbidden = [...new Set([...keysDeep(raw)].filter((k) => FORBIDDEN.has(k.toLowerCase())))].sort();
  const inner = raw.llmwiki_result && typeof raw.llmwiki_result === "object" ? (raw.llmwiki_result as Obj) : raw;
  const o = "artifacts" in inner || "decision_proposals" in inner || "todo_proposals" in inner ? fromLegacy(inner) : inner;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    structured: "json",
    run: str(o.run) || undefined,
    summary: str(o.summary) || undefined,
    done: strs(o.done),
    outputs: arr(o.outputs)
      .map((x) => (typeof x === "string" ? { title: x } : { title: str((x as Obj)?.title), url: /^https?:\/\/\S+$/i.test(str((x as Obj)?.url)) ? str((x as Obj)?.url) : undefined, refs: refsOf(x as Obj) }))
      .filter((x) => x.title || x.url)
      .map((x) => ({ ...x, title: x.title || (x.url as string) })),
    decisions: arr(o.decisions)
      .map((x) => (typeof x === "string" ? { text: x, reason: "" } : { text: str((x as Obj)?.text), reason: str((x as Obj)?.reason), replaces: str((x as Obj)?.replaces) || undefined, refs: refsOf(x as Obj) }))
      .filter((x) => x.text),
    tasks: arr(o.tasks)
      .map((x) => {
        if (typeof x === "string") return { title: x.trim(), due: null };
        const due = str((x as Obj)?.due);
        return { title: str((x as Obj)?.title), due: DATE.test(due) ? due : null, refs: refsOf(x as Obj) };
      })
      .filter((x) => x.title),
    unverified: strs(o.unverified),
    remaining: strs(o.remaining),
    ...(forbidden.length ? { forbidden } : {}),
  };
}

/** ## 제목 — 한국어 · 영어 둘 다 받는다 */
const HEADINGS: [keyof Omit<ParsedResult, "structured" | "run">, RegExp][] = [
  ["summary", /^(상태\s*요약|요약|현재\s*상태|summary|status)$/i],
  ["done", /^(수행한\s*내용|한\s*일|실제로\s*수행한\s*내용|done|what\s*i\s*did|completed)$/i],
  ["outputs", /^(결과물|생성한\s*결과물|outputs?|deliverables?|artifacts?)$/i],
  ["decisions", /^(결정\s*제안|제안한\s*결정|결정|decisions?|proposed\s*decisions?)$/i],
  ["tasks", /^(다음\s*할\s*일(\s*제안)?|할\s*일\s*제안|next\s*(steps|tasks|actions)|tasks?)$/i],
  ["unverified", /^(확인\s*(이\s*)?필요|확인되지\s*않은\s*내용|미확인|unverified|needs?\s*verification|open\s*questions)$/i],
  ["remaining", /^(남은\s*일|remaining|todo)$/i],
];

function fromHeadings(text: string): ParsedResult | null {
  const r: ParsedResult = { structured: "headings", done: [], outputs: [], decisions: [], tasks: [], unverified: [], remaining: [] };
  let cur: (typeof HEADINGS)[number][0] | null = null;
  let found = 0;
  const summary: string[] = [];
  for (const raw of text.split("\n")) {
    const h = /^#{1,4}\s+(.+?)\s*#*$/.exec(raw.trim());
    if (h) {
      const name = h[1].replace(/[:：]$/, "").trim();
      cur = HEADINGS.find(([, re]) => re.test(name))?.[0] ?? null;
      if (cur) found++;
      continue;
    }
    if (!cur) continue;
    const line = raw.trim();
    if (!line) continue;
    if (cur === "summary") {
      summary.push(line);
      continue;
    }
    const item = line.replace(/^([-*•]|\d+[.)]|\[[ xX]\])\s*/, "").trim();
    if (!item) continue;
    if (cur === "outputs") {
      const md = /\[([^\]]+)\]\((\S+?)\)/.exec(item);
      const url = md?.[2] ?? /(https?:\/\/\S+)/.exec(item)?.[1];
      r.outputs.push({ title: md?.[1] ?? (item.replace(url ?? "", "").replace(/[—:-]\s*$/, "").trim() || (url as string)), url });
    } else if (cur === "decisions") {
      const [t, ...why] = item.split(/\s+[—–]\s+|\s+-\s+|\s*\|\s*|\s*(?:이유|reason)\s*[:：]\s*/i);
      r.decisions.push({ text: t.trim(), reason: why.join(" ").trim() });
    } else if (cur === "tasks") {
      const due = /(\d{4}-\d{2}-\d{2})/.exec(item)?.[1] ?? null;
      r.tasks.push({ title: item.replace(/\(?\s*(마감|due)?\s*[:：]?\s*\d{4}-\d{2}-\d{2}\s*\)?/i, "").trim(), due });
    } else (r[cur] as string[]).push(item);
  }
  if (summary.length) r.summary = summary.join("\n");
  return found ? r : null;
}

export function parseResult(text: string): ParsedResult {
  const t = normalizeResult(text);
  const block = /```\s*(?:llmwiki-result|json)\s*\n([\s\S]*?)```/i.exec(t);
  if (block) {
    try {
      const o = JSON.parse(block[1]) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) {
        const r = fromJson(o as Record<string, unknown>);
        // 템플릿을 그대로 돌려준 빈 칸은 버린다
        r.tasks = r.tasks.filter((x) => x.title);
        return r;
      }
    } catch {
      /* 아래 제목 해석으로 */
    }
  }
  return fromHeadings(t) ?? { structured: "none", done: [], outputs: [], decisions: [], tasks: [], unverified: [], remaining: [] };
}

/* ───────────────────────── 가져오기 ───────────────────────── */

export type ImportResult =
  | { kind: "duplicate"; runId: string }
  | { kind: "imported"; item: WorkItem; run: AiRun; parsed: ParsedResult; rawHash: string; counts: { outputs: number; decisions: number; tasks: number }; attention: Msg[] };

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/* ───────────────────────── 검사 ───────────────────────── */

const REF = /^S(\d+):(\d+)(?:-(\d+))?$/;

/** 마감 날짜가 그 줄에 쓰여 있나 — 2026-10-25 · 10월 25일 · 2026.10.25 · 10/25 */
function dueInLine(due: string, line: string): boolean {
  const [y, m, d] = due.slice(0, 10).split("-");
  const M = Number(m);
  const D = Number(d);
  const pats = [due.slice(0, 10), `${M}월 ${D}일`, `${M}월${D}일`, `${y}.${M}.${D}`, `${y}. ${M}. ${D}`, `${y}.${m}.${d}`, `${M}/${D}`, `${m}-${d}`];
  return pats.some((p) => line.includes(p));
}

interface RefCheck {
  /** 근거 줄 본문(찾을 수 있는 것만) */
  lines: string[];
  bad: number;
  /** 형식은 맞지만 본문을 읽지 못한 참조(기기 캐시에 없는 Drive 자료 등) — 이때는 마감을 판단하지 않는다 */
  unreadable: number;
}

function checkRefs(refs: string[] | undefined, run: AiRun, linesOf: ((sourceId: string) => string[] | null) | undefined): RefCheck {
  const out: RefCheck = { lines: [], bad: 0, unreadable: 0 };
  if (!refs?.length || !run.refKeys) return out;
  for (const r of refs) {
    const m = REF.exec(r.trim());
    const key = m ? `S${m[1]}` : null;
    const idx = key ? run.refKeys.indexOf(key) : -1;
    const from = m ? Number(m[2]) : 0;
    const to = m?.[3] ? Number(m[3]) : from;
    const max = key ? (run.refLines?.[key] ?? 0) : 0;
    if (!m || idx < 0 || from < 1 || to < from || to > max) {
      out.bad++;
      continue;
    }
    const src = linesOf?.(run.inputSourceIds[idx] ?? "");
    if (src) out.lines.push(...src.slice(from - 1, to));
    else out.unreadable++;
  }
  return out;
}

/**
 * 결과를 업무에 들인다. 원문 해시가 같으면 다시 들이지 않는다(저장소가 원문을 raw/{hash}.txt 로 따로 남긴다).
 * 바로 반영: 원문 · 수행 내용 · 요약 초안(되돌리기 가능). 제안으로: 결정 · 할 일 · 마감 변경 · 최신본.
 */
export { runMeta } from "./pageHandoff.ts";
import { runMeta } from "./pageHandoff.ts";

export interface ImportOptions {
  runId?: string | null;
  tool?: AiTool;
  /** 자료 본문 줄(묶음을 만들 때와 같은 발췌) — 근거 줄에 마감이 있는지 본다. 없으면 그 검사는 건너뛴다 */
  lines?: (sourceId: string) => string[] | null;
}

export function importResult(item: WorkItem, text: string, nowIso: string, opts: ImportOptions = {}): ImportResult {
  const normalized = normalizeResult(text);
  const rawHash = hashText(normalized);
  const dup = item.runs.find((r) => r.rawHash === rawHash);
  if (dup) return { kind: "duplicate", runId: dup.id };

  const parsed = parseResult(normalized);
  const meta = runMeta(normalized);
  const wantRun = opts.runId ?? parsed.run ?? null;
  const prepared = (wantRun ? item.runs.find((r) => r.id === wantRun && r.status === "prepared") : undefined) ?? null;
  const run: AiRun = prepared
    ? { ...prepared, outputIds: [] }
    : { id: newId(), tool: opts.tool ?? "other", goal: "", scope: "", contextVersion: "", inputSourceIds: [], inputSourceVersions: {}, status: "prepared", done: [], outputIds: [], remaining: [], unverified: [], startedAt: nowIso };

  const attention: Msg[] = [];
  const counts = { outputs: 0, decisions: 0, tasks: 0 };
  const flags = new Set<RunFlag>();
  let badRefs = 0;
  let dueUnsupported = 0;
  const refCheck = (refs: string[] | undefined) => {
    const r = checkRefs(refs, run, opts.lines);
    badRefs += r.bad;
    return r;
  };
  if (parsed.forbidden?.length) {
    flags.add("forbidden_fields");
    attention.push({ key: "attention.forbiddenFields", params: { fields: parsed.forbidden.join(", ") } });
  }
  if (opts.runId && parsed.run && parsed.run !== opts.runId && !/^\s*$/.test(parsed.run)) {
    flags.add("run_mismatch");
    attention.push({ key: "attention.runMismatch" });
  }
  // AI 가 '자료에 이런 지시문이 있었다' 고 unverified 에 보고한 것은 따로 — 결과 전체를 의심하지 않는다
  const reported = parsed.unverified.filter((u) => scanInjection(u).length);
  const rest = reported.reduce((t, u) => t.split(u).join(""), normalized);
  if (scanInjection(rest).length) {
    flags.add("injection_suspect");
    attention.push({ key: "attention.injection" });
  } else if (reported.length) attention.push({ key: "attention.injectionReported", params: { count: reported.length } });
  const newOutputs: Output[] = [];
  const newDecisions: Decision[] = [];
  const newProposals: Proposal[] = [];
  // 같은 결과에서 나온 것은 늘 같은 id — 재시도해도 겹치지 않는다
  const pid = (k: string, i: number) => `${run.id}-${k}${i}`;

  parsed.outputs.forEach((o, i) => {
    const same = item.outputs.find((x) => (o.url && x.url === o.url) || norm(x.title) === norm(o.title));
    if (same) {
      run.outputIds.push(same.id);
      return;
    }
    refCheck(o.refs);
    const out: Output = { id: pid("o", i), title: o.title, url: o.url ?? null, externalId: null, version: null, runId: run.id, status: "draft", isLatest: false, createdAt: nowIso };
    newOutputs.push(out);
    run.outputIds.push(out.id);
    newProposals.push({ id: pid("pl", i), kind: "output_latest", status: "open", runId: run.id, createdAt: nowIso, outputId: out.id, title: out.title });
    counts.outputs++;
  });

  parsed.decisions.forEach((d, i) => {
    if (item.decisions.some((x) => norm(x.text) === norm(d.text) && x.status !== "rejected")) return;
    const replaced = d.replaces ? item.decisions.find((x) => x.status === "confirmed" && (x.id === d.replaces || norm(x.text) === norm(d.replaces as string))) : undefined;
    refCheck(d.refs);
    newDecisions.push({ id: pid("d", i), text: d.text, reason: d.reason, evidenceSourceIds: run.inputSourceIds, status: "proposed", origin: "ai", runId: run.id, createdAt: nowIso, decidedAt: null, supersedes: replaced?.id ?? null, ...(d.refs ? { refs: d.refs } : {}) });
    if (replaced) attention.push({ key: "attention.decisionChange", params: { title: replaced.text } });
    counts.decisions++;
  });

  parsed.tasks.forEach((t, i) => {
    // 마감은 근거 줄에 그 날짜가 있어야 믿는다 — 없으면 '근거 없는 마감'(제안은 남긴다)
    const rc = refCheck(t.refs);
    const pflags: ProposalFlag[] = [];
    if (!t.refs?.length && run.refKeys?.length) pflags.push("no_evidence");
    if (t.due && run.refKeys?.length && opts.lines && !rc.unreadable && !rc.lines.some((l) => dueInLine(t.due as string, l))) {
      pflags.push("due_unsupported");
      dueUnsupported++;
    }
    const extra = { ...(t.refs ? { refs: t.refs } : {}), ...(pflags.length ? { flags: pflags } : {}) };
    const existing = item.actions.find((a) => !a.done && norm(a.title) === norm(t.title));
    if (existing) {
      if (t.due && t.due !== (existing.due ?? null)) {
        newProposals.push({ id: pid("dc", i), kind: "due_change", status: "open", runId: run.id, createdAt: nowIso, taskId: existing.id, title: existing.title, due: t.due, note: existing.due ?? "", ...extra });
        attention.push({ key: "attention.dueConflict", params: { title: existing.title, before: existing.due ?? "-", after: t.due } });
      }
      return;
    }
    if (item.proposals.some((p) => p.kind === "task" && p.status === "open" && norm(p.title ?? "") === norm(t.title))) return;
    newProposals.push({ id: pid("t", i), kind: "task", status: "open", runId: run.id, createdAt: nowIso, title: t.title, due: t.due ?? null, ...extra });
    counts.tasks++;
  });

  if (badRefs) {
    flags.add("bad_refs");
    attention.push({ key: "attention.badRefs", params: { count: badRefs } });
  }
  if (dueUnsupported) attention.push({ key: "attention.dueUnsupported", params: { count: dueUnsupported } });
  if (parsed.unverified.length) attention.push({ key: "attention.unverified", params: { count: parsed.unverified.length } });
  if (parsed.structured === "none") attention.push({ key: "attention.unparsed" });

  const finished: AiRun = {
    ...run,
    status: parsed.structured === "none" ? "parse_failed" : "imported",
    resultSummary: parsed.summary ?? (parsed.structured === "none" ? normalized.slice(0, 300) : undefined),
    done: parsed.done,
    remaining: parsed.remaining,
    unverified: parsed.unverified,
    rawHash,
    finishedAt: nowIso,
    ...(flags.size ? { flags: [...flags].sort() } : {}),
    ...(meta?.model ? { model: meta.model } : {}),
    ...(meta?.latencyMs != null ? { latencyMs: meta.latencyMs } : {}),
  };

  const msg: Msg = parsed.structured === "none" ? { key: "change.importRaw" } : { key: "change.import", params: { ...counts, summary: parsed.summary ? 1 : 0 } };
  const next = withChange(
    item,
    msg,
    nowIso,
    (d) => ({
      ...d,
      runs: prepared ? d.runs.map((r) => (r.id === run.id ? finished : r)) : [...d.runs, finished],
      outputs: [...d.outputs, ...newOutputs],
      decisions: [...d.decisions, ...newDecisions],
      proposals: [...d.proposals, ...newProposals],
      // 요약 초안 — AI 가 쓴 것으로 표시하고, 어느 자료 버전을 근거로 했는지 남긴다
      summary: parsed.summary ? { text: parsed.summary, origin: "ai", runId: run.id, basedOn: { ...finished.inputSourceVersions }, updatedAt: nowIso } : d.summary,
    }),
    attention,
  );
  return { kind: "imported", item: next, run: finished, parsed, rawHash, counts, attention };
}
