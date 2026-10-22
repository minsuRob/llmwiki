/**
 * 옛 업무(스키마 2) 파일 모양 — state/items/{id}.json. 지금은 읽어서 페이지로 옮길 때(pages.ts migrateToPages)와 시험만 쓴다.
 * 새로 쓰지 않는다. 앱이 처음 열 때 옮기고, 원본은 archive/v2/ 에 한 벌 남긴다(state/items/ 도 지우지 않는다).
 */
import type { Task } from "./types.ts";
import { newId } from "./types.ts";
import type { AiTool, ChangeEntry } from "./work.ts";

export type WorkStatus = "planned" | "active" | "waiting" | "blocked" | "done" | "archived";
export const WORK_STATUSES: WorkStatus[] = ["planned", "active", "waiting", "blocked", "done", "archived"];
export type Importance = "high" | "normal" | "low";

/** 업무 요약 — 누가 썼고 어느 자료 버전을 근거로 했나 */
export interface WorkSummary {
  text: string;
  origin: "user" | "ai";
  runId?: string;
  /** 자료 id → 이 요약이 근거로 한 그 자료의 버전 */
  basedOn: Record<string, string>;
  updatedAt: string;
}

export type DecisionStatus = "proposed" | "confirmed" | "superseded" | "rejected";

export interface Decision {
  id: string;
  text: string;
  reason: string;
  evidenceSourceIds: string[];
  status: DecisionStatus;
  origin: "user" | "ai";
  runId?: string;
  createdAt: string;
  decidedAt?: string | null;
  /** 이 결정이 바꾸려는(바꾼) 이전 결정 */
  supersedes?: string | null;
  supersededBy?: string | null;
  /** AI 가 댄 근거("S1:12") */
  refs?: string[];
}

export type RunStatus = "prepared" | "imported" | "parse_failed";

/**
 * 가져올 때 코드가 찾은 문제(workHandoff.importResult) — 화면이 경고로 보인다. 결과를 버리지는 않는다.
 * - forbidden_fields: status · confirmed 같은 확정 · 완료 필드가 있었다(무시했다)
 * - bad_refs: 묶음에 없는 자료 · 줄을 근거로 댔다
 * - run_mismatch: 결과의 run 이 고른 요청과 다르다
 * - injection_suspect: 결과 원문에 지시문으로 보이는 말이 있다
 */
export type RunFlag = "forbidden_fields" | "bad_refs" | "run_mismatch" | "injection_suspect";
/** 제안 하나에 붙는 경고 — due_unsupported: 근거 줄에 없는 마감 · no_evidence: 근거 참조 없음 */
export type ProposalFlag = "due_unsupported" | "no_evidence";

export interface AiRun {
  id: string;
  tool: AiTool;
  goal: string;
  scope: string;
  /** 넘긴 맥락의 버전 — 업무 rev + 맥락 해시 */
  contextVersion: string;
  inputSourceIds: string[];
  inputSourceVersions: Record<string, string>;
  status: RunStatus;
  resultSummary?: string;
  done: string[];
  outputIds: string[];
  remaining: string[];
  unverified: string[];
  /** 가져온 원문의 해시 — 같은 결과를 다시 가져오는지 본다. 원문은 저장소 raw/{hash}.txt */
  rawHash?: string;
  /** 넘긴 자료 순서(S1, S2 … 의 근거 참조를 풀 때 쓴다) — inputSourceIds 와 같은 순서 */
  refKeys?: string[];
  /** 자료 발췌를 몇 줄까지 넘겼나(S1 → 줄 수) — 없는 줄 참조를 잡는다 */
  refLines?: Record<string, number>;
  flags?: RunFlag[];
  /** 실행자가 남긴 모델 · 걸린 시간(결과 머리의 <!-- llmwiki-run {...} --> 에서) */
  model?: string | null;
  latencyMs?: number | null;
  startedAt: string;
  finishedAt?: string | null;
}

export type OutputStatus = "draft" | "review" | "final";

export interface Output {
  id: string;
  title: string;
  url?: string | null;
  /** Drive 파일 id 등 */
  externalId?: string | null;
  version?: string | null;
  runId?: string | null;
  status: OutputStatus;
  /** 이 업무의 최신본 — 사람이 정한다. 가장 최근 파일이라고 저절로 최신본이 되지 않는다 */
  isLatest: boolean;
  createdAt: string;
}

export type ProposalKind = "task" | "due_change" | "output_latest" | "cross_link";

export interface Proposal {
  id: string;
  kind: ProposalKind;
  status: "open" | "accepted" | "rejected";
  runId?: string | null;
  createdAt: string;
  /** task: 제목 · 마감 · 근거 / due_change: 할 일 · 새 마감 / output_latest: 결과물 / cross_link: 자료 */
  title?: string;
  due?: string | null;
  taskId?: string;
  outputId?: string;
  sourceId?: string;
  /** 판단 근거로 보여 줄 말(AI 가 쓴 문장 그대로) */
  note?: string;
  /** AI 가 댄 근거("S1:12") */
  refs?: string[];
  flags?: ProposalFlag[];
  /** 사람이 받아들이거나 뺀 시각 — 판단 기록(judgments.ts)에 쓴다 */
  decidedAt?: string | null;
}

export interface WorkItem {
  id: string;
  schemaVersion: number;
  /** 저장할 때마다 1씩 — 화면 · 저장소 · 맥락 버전이 같은 수를 본다 */
  rev: number;
  workspaceId: string;
  title: string;
  templateKey?: string | null;
  goal: string;
  doneCriteria: string[];
  status: WorkStatus;
  importance: Importance;
  due?: string | null;
  summary: WorkSummary | null;
  /** 이 업무의 할 일(Task 를 넓혀 쓴다) */
  actions: Task[];
  /** 이어 둔 자료 — 자료는 보관함에 한 벌만 있고 여기엔 id 만 */
  sourceIds: string[];
  decisions: Decision[];
  runs: AiRun[];
  outputs: Output[];
  proposals: Proposal[];
  changes: ChangeEntry[];
  createdAt: string;
  updatedAt: string;
}

/** 시험 · 이행 미리 보기용 — 빈 옛 업무 하나 */
export function createWorkItem(input: { workspaceId: string; title: string; goal?: string; due?: string | null; importance?: Importance }, nowIso: string): WorkItem {
  return {
    id: newId(),
    schemaVersion: 2,
    rev: 0,
    workspaceId: input.workspaceId,
    title: input.title.trim().slice(0, 200),
    templateKey: null,
    goal: (input.goal ?? "").trim(),
    doneCriteria: [],
    status: "active",
    importance: input.importance ?? "normal",
    due: input.due ?? null,
    summary: null,
    actions: [],
    sourceIds: [],
    decisions: [],
    runs: [],
    outputs: [],
    proposals: [],
    changes: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/** 옛 업무 파일을 읽을 수 있게 — 빠진 칸만 채우고 아무것도 지우지 않는다(영역 칸만 버린다) */
export function upgradeItem(raw: Record<string, unknown>): WorkItem {
  const it = { ...raw } as unknown as WorkItem;
  it.actions ??= [];
  it.sourceIds ??= [];
  it.decisions ??= [];
  it.runs ??= [];
  it.outputs ??= [];
  it.proposals ??= [];
  it.changes ??= [];
  it.doneCriteria ??= [];
  it.importance ??= "normal";
  it.summary ??= null;
  it.rev ??= 0;
  it.status ??= "active";
  // 2: 영역을 없앴다 — 값은 어디로도 옮기지 않는다
  delete (it as unknown as Record<string, unknown>).areaId;
  it.schemaVersion = 2;
  return it;
}
