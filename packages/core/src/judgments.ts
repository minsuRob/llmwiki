/**
 * 판단 기록 — AI 가 낸 제안 · 결정 하나와 그에 대한 사람의 판단을 한 행으로. 순수 함수(테스트: judgments.test.ts).
 *
 * 따로 저장하지 않는다. 업무 파일(Drive)에 이미 있는 것 — 제안 · 결정 · 실행 기록(실행자 · 모델 · 경고) ·
 * 사람의 수락 · 거절 · 확정과 그 시각 — 에서 그때그때 계산한다. 그래서 두 벌이 어긋나거나 저장이 늘지 않는다.
 * 되돌리기(undo)는 업무를 이전 모습으로 돌리므로, 기록도 '지금 상태' 기준이다(되돌린 판단은 다시 '대기').
 *
 * 쓰임: 실행자별 채택률(Gemma 요약을 사람이 얼마나 받아들였나), 주입 · 근거 경고의 오탐 확인, 나중의 평가 · 학습 자료.
 * 원칙(docs/architecture.md): 비공개 주제(옛 회사 작업실)는 기본으로 빼고, 학습 · few-shot 동의는 기본 꺼짐(consent false).
 * 자료 본문은 넣지 않는다 — 자료 id · 버전(내용 지문)만.
 */
import type { AiTool, WorkItem, WorkState } from "./work.ts";

export type JudgmentTask = "task" | "due_change" | "output_latest" | "cross_link" | "decision";
export type ReviewAction = "approved" | "rejected" | "pending";

export interface JudgmentRecord {
  id: string;
  /** AI 가 낸 시각 */
  createdAt: string;
  workItemId: string;
  workspaceId: string;
  /** 비공개 주제의 업무인가 */
  privateWorkspace: boolean;
  task: JudgmentTask;
  runId: string | null;
  executor: AiTool | null;
  model: string | null;
  latencyMs: number | null;
  contextVersion: string | null;
  /** 근거 자료(id · 그때 버전) — 본문은 넣지 않는다 */
  sourceRefs: { sourceId: string; version: string | null }[];
  /** AI 가 댄 근거 줄("S1:12") */
  refs: string[];
  output: { text: string; due?: string | null; reason?: string };
  /** 코드가 붙인 경고 — 제안 경고 + 그 결과의 경고 */
  flags: string[];
  review: { action: ReviewAction; at: string | null };
  consent: { train: boolean; fewShot: boolean };
  usage: "none";
}

export interface JudgmentOptions {
  /** 비공개 주제 업무도 넣을까(기본 아니오) */
  includePrivate?: boolean;
}

export function deriveJudgments(state: WorkState, opts: JudgmentOptions = {}): JudgmentRecord[] {
  const privateOf = new Map(state.manifest.workspaces.map((w) => [w.id, w.private]));
  const out: JudgmentRecord[] = [];
  for (const item of state.items) {
    const priv = privateOf.get(item.workspaceId) ?? false;
    if (priv && !opts.includePrivate) continue;
    const runOf = (id?: string | null) => (id ? item.runs.find((r) => r.id === id) : undefined);
    const base = (runId: string | null | undefined) => {
      const run = runOf(runId);
      return {
        workItemId: item.id,
        workspaceId: item.workspaceId,
        privateWorkspace: priv,
        runId: run?.id ?? runId ?? null,
        executor: run?.tool ?? null,
        model: run?.model ?? null,
        latencyMs: run?.latencyMs ?? null,
        contextVersion: run?.contextVersion || null,
        sourceRefs: (run?.inputSourceIds ?? []).map((id) => ({ sourceId: id, version: run?.inputSourceVersions[id] ?? null })),
        runFlags: (run?.flags ?? []) as string[],
        consent: { train: false, fewShot: false },
        usage: "none" as const,
      };
    };
    for (const p of item.proposals) {
      const { runFlags, ...b } = base(p.runId);
      out.push({
        ...b,
        id: `${item.id}:${p.id}`,
        createdAt: p.createdAt,
        task: p.kind,
        refs: p.refs ?? [],
        output: { text: p.title ?? "", ...(p.kind === "task" || p.kind === "due_change" ? { due: p.due ?? null } : {}) },
        flags: [...(p.flags ?? []), ...runFlags],
        review: { action: p.status === "accepted" ? "approved" : p.status === "rejected" ? "rejected" : "pending", at: p.decidedAt ?? null },
      });
    }
    for (const d of item.decisions) {
      if (d.origin !== "ai") continue; // 사람이 직접 남긴 결정은 AI 판단이 아니다
      const { runFlags, ...b } = base(d.runId);
      out.push({
        ...b,
        id: `${item.id}:${d.id}`,
        createdAt: d.createdAt,
        task: "decision",
        refs: d.refs ?? [],
        output: { text: d.text, reason: d.reason },
        flags: runFlags,
        // 확정했다가 나중 결정으로 대체된 것도 그때는 받아들인 것이다
        review: { action: d.status === "confirmed" || d.status === "superseded" ? "approved" : d.status === "rejected" ? "rejected" : "pending", at: d.decidedAt ?? null },
      });
    }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export interface JudgmentStats {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  /** 판단한 것 중 받아들인 비율(판단한 게 없으면 null) */
  acceptRate: number | null;
  /** 경고가 붙었는데 받아들인 수 — 경고가 지나쳤을 수 있는 것(오탐 후보) */
  flaggedButApproved: number;
}

function stat(rows: JudgmentRecord[]): JudgmentStats {
  const approved = rows.filter((r) => r.review.action === "approved").length;
  const rejected = rows.filter((r) => r.review.action === "rejected").length;
  return {
    total: rows.length,
    approved,
    rejected,
    pending: rows.length - approved - rejected,
    acceptRate: approved + rejected ? Math.round((approved / (approved + rejected)) * 1000) / 1000 : null,
    flaggedButApproved: rows.filter((r) => r.flags.length && r.review.action === "approved").length,
  };
}

/** 전체와 실행자별(claude · codex · gemma · other · 모름) */
export function judgmentStats(rows: JudgmentRecord[]): { all: JudgmentStats; byExecutor: Record<string, JudgmentStats> } {
  const groups = new Map<string, JudgmentRecord[]>();
  for (const r of rows) {
    const k = r.executor ?? "unknown";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return { all: stat(rows), byExecutor: Object.fromEntries([...groups].map(([k, v]) => [k, stat(v)])) };
}

/** 한 줄에 하나 */
export function toJsonl(rows: JudgmentRecord[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
}

/** 업무 하나만 볼 때 */
export function judgmentsOf(item: WorkItem, state: WorkState): JudgmentRecord[] {
  return deriveJudgments({ ...state, items: [item] }, { includePrivate: true });
}
