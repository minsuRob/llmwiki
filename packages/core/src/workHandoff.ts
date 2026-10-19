/**
 * Claude · Codex 와 일을 주고받는 길 — 내보내기(맥락 묶음)와 가져오기(결과 해석).
 *
 * - 대화 전체를 넣지 않는다. 이번 작업에 필요한 목표 · 상태 · 확정 결정 · 자료 발췌 · 범위만 묶는다.
 * - AI 가 Drive 링크를 직접 열 수 있다고 가정하지 않는다 — 접근 방법과 한계를 함께 적는다.
 * - 다른 작업실 자료는 기본으로 빼고, 뺐다는 사실만 적는다.
 * - 결과는 구조화된 블록(llmwiki-result)을 먼저 읽고, 없으면 제목(##) 으로, 그것도 안 되면 원문만 남긴다.
 * - AI 가 "완료했다" 고 써도 업무 · 할 일을 완료 처리하지 않는다. 결정 · 할 일 · 최신본은 제안으로만 들어온다.
 * 묶음의 고정 문구(제목 · 안내)는 앱이 번역 파일에서 넘긴다(HandoffLabels).
 */
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
}

const EXCERPT_MAX = 4000;
const TOTAL_EXCERPT_MAX = 20000;

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
): { item: WorkItem; run: AiRun; markdown: string; excluded: Source[] } {
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
  let budget = TOTAL_EXCERPT_MAX;
  const versions: Record<string, string> = {};
  included.forEach((s, i) => {
    const ref = `S${i + 1}`;
    if (s.remoteVersion) versions[s.id] = s.remoteVersion;
    const link = s.url ? ` <${s.url}>` : "";
    lines.push(`### [${ref}] ${s.title}${link}`);
    lines.push(`- ${s.provider} · ${s.format}${s.remoteVersion ? ` · v${s.remoteVersion}` : ""}${s.remoteModifiedAt ? ` · ${s.remoteModifiedAt}` : ""}`);
    if (s.provider === "drive" || s.provider === "link") lines.push(`- ${L.sourceAccess}`);
    const text = excerpt(s);
    if (text && budget > 0) {
      const cut = text.slice(0, Math.min(EXCERPT_MAX, budget));
      budget -= cut.length;
      lines.push("", "```text", cut + (cut.length < text.length ? "\n…" : ""), "```");
    } else lines.push(`- ${L.sourceNoExcerpt}`);
    lines.push("");
  });
  if (excluded.length) lines.push(`> ${fill(L.excludedCross, { count: excluded.length })}`, "");

  lines.push(`## ${L.scope}`, input.scope.trim() || "-", "");
  lines.push(`## ${L.taskDone}`, (input.doneCriteria ?? "").trim() || "-", "");
  const pending = [...item.decisions.filter((d) => d.status === "proposed").map((d) => d.text), ...item.runs.flatMap((r) => r.unverified)];
  lines.push(`## ${L.openQuestions}`, ...(pending.length ? pending.map((p) => `- ${p}`) : [L.openNone]), "");

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
    startedAt: nowIso,
    finishedAt: null,
  };
  return { item: { ...item, runs: [...item.runs, run], updatedAt: nowIso }, run, markdown, excluded };
}

function resultTemplate(runId: string) {
  return {
    run: runId,
    summary: "",
    done: [""],
    outputs: [{ title: "", url: "" }],
    decisions: [{ text: "", reason: "", replaces: "" }],
    tasks: [{ title: "", due: "YYYY-MM-DD" }],
    unverified: [""],
    remaining: [""],
  };
}

/* ───────────────────────── 해석 ───────────────────────── */

export interface ParsedResult {
  structured: "json" | "headings" | "none";
  run?: string;
  summary?: string;
  done: string[];
  outputs: { title: string; url?: string }[];
  decisions: { text: string; reason: string; replaces?: string }[];
  tasks: { title: string; due?: string | null }[];
  unverified: string[];
  remaining: string[];
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean) : typeof v === "string" && v.trim() ? [v.trim()] : []);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

function fromJson(o: Record<string, unknown>): ParsedResult {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    structured: "json",
    run: str(o.run) || undefined,
    summary: str(o.summary) || undefined,
    done: strs(o.done),
    outputs: arr(o.outputs)
      .map((x) => (typeof x === "string" ? { title: x } : { title: str((x as Record<string, unknown>)?.title), url: str((x as Record<string, unknown>)?.url) || undefined }))
      .filter((x) => x.title || x.url)
      .map((x) => ({ ...x, title: x.title || (x.url as string) })),
    decisions: arr(o.decisions)
      .map((x) => (typeof x === "string" ? { text: x, reason: "" } : { text: str((x as Record<string, unknown>)?.text), reason: str((x as Record<string, unknown>)?.reason), replaces: str((x as Record<string, unknown>)?.replaces) || undefined }))
      .filter((x) => x.text),
    tasks: arr(o.tasks)
      .map((x) => {
        if (typeof x === "string") return { title: x.trim(), due: null };
        const due = str((x as Record<string, unknown>)?.due);
        return { title: str((x as Record<string, unknown>)?.title), due: DATE.test(due) ? due : null };
      })
      .filter((x) => x.title),
    unverified: strs(o.unverified),
    remaining: strs(o.remaining),
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

/**
 * 결과를 업무에 들인다. 원문 해시가 같으면 다시 들이지 않는다(저장소가 원문을 raw/{hash}.txt 로 따로 남긴다).
 * 바로 반영: 원문 · 수행 내용 · 요약 초안(되돌리기 가능). 제안으로: 결정 · 할 일 · 마감 변경 · 최신본.
 */
export function importResult(item: WorkItem, text: string, nowIso: string, opts: { runId?: string | null; tool?: AiTool } = {}): ImportResult {
  const normalized = normalizeResult(text);
  const rawHash = hashText(normalized);
  const dup = item.runs.find((r) => r.rawHash === rawHash);
  if (dup) return { kind: "duplicate", runId: dup.id };

  const parsed = parseResult(normalized);
  const wantRun = opts.runId ?? parsed.run ?? null;
  const prepared = (wantRun ? item.runs.find((r) => r.id === wantRun && r.status === "prepared") : undefined) ?? null;
  const run: AiRun = prepared
    ? { ...prepared, outputIds: [] }
    : { id: newId(), tool: opts.tool ?? "other", goal: "", scope: "", contextVersion: "", inputSourceIds: [], inputSourceVersions: {}, status: "prepared", done: [], outputIds: [], remaining: [], unverified: [], startedAt: nowIso };

  const attention: Msg[] = [];
  const counts = { outputs: 0, decisions: 0, tasks: 0 };
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
    const out: Output = { id: pid("o", i), title: o.title, url: o.url ?? null, externalId: null, version: null, runId: run.id, status: "draft", isLatest: false, createdAt: nowIso };
    newOutputs.push(out);
    run.outputIds.push(out.id);
    newProposals.push({ id: pid("pl", i), kind: "output_latest", status: "open", runId: run.id, createdAt: nowIso, outputId: out.id, title: out.title });
    counts.outputs++;
  });

  parsed.decisions.forEach((d, i) => {
    if (item.decisions.some((x) => norm(x.text) === norm(d.text) && x.status !== "rejected")) return;
    const replaced = d.replaces ? item.decisions.find((x) => x.status === "confirmed" && (x.id === d.replaces || norm(x.text) === norm(d.replaces as string))) : undefined;
    newDecisions.push({ id: pid("d", i), text: d.text, reason: d.reason, evidenceSourceIds: run.inputSourceIds, status: "proposed", origin: "ai", runId: run.id, createdAt: nowIso, decidedAt: null, supersedes: replaced?.id ?? null });
    if (replaced) attention.push({ key: "attention.decisionChange", params: { title: replaced.text } });
    counts.decisions++;
  });

  parsed.tasks.forEach((t, i) => {
    const existing = item.actions.find((a) => !a.done && norm(a.title) === norm(t.title));
    if (existing) {
      if (t.due && t.due !== (existing.due ?? null)) {
        newProposals.push({ id: pid("dc", i), kind: "due_change", status: "open", runId: run.id, createdAt: nowIso, taskId: existing.id, title: existing.title, due: t.due, note: existing.due ?? "" });
        attention.push({ key: "attention.dueConflict", params: { title: existing.title, before: existing.due ?? "-", after: t.due } });
      }
      return;
    }
    if (item.proposals.some((p) => p.kind === "task" && p.status === "open" && norm(p.title ?? "") === norm(t.title))) return;
    newProposals.push({ id: pid("t", i), kind: "task", status: "open", runId: run.id, createdAt: nowIso, title: t.title, due: t.due ?? null });
    counts.tasks++;
  });

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
