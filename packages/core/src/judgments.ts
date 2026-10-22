/**
 * 판단 기록 — AI 가 낸 제안 하나와 그에 대한 사람의 판단을 한 행으로. 순수 함수(테스트: judgments.test.ts).
 *
 * 따로 저장하지 않는다. 매니페스트에 이미 있는 것 — 정리 제안(triage) · 페이지 본문 제안(bodyProposals),
 * 그 실행자 · 경고 · 사람의 받기 · 빼기와 그 시각 — 에서 그때그때 계산한다. 그래서 두 벌이 어긋나거나 저장이 늘지 않는다.
 *
 * 쓰임: 실행자별 채택률(Gemma 요약을 사람이 얼마나 받아들였나), 주입 · 근거 경고의 오탐 확인, 나중의 평가 · 학습 자료.
 * 원칙(docs/architecture.md): 비공개 주제(옛 회사 작업실)는 기본으로 빼고, 학습 · few-shot 동의는 기본 꺼짐(consent false).
 * 본문은 넣지 않는다 — 자료 id · 버전(내용 지문) · 본문 지문만.
 */
import type { AiTool, Source, WorkManifest } from "./work.ts";

/** 정리 제안 셋 + 본문 제안(옛 new_work 기록은 그대로 둔다) */
export type JudgmentTask = "file_source" | "new_page" | "new_work" | "concept_link" | "body";
export type ReviewAction = "approved" | "rejected" | "pending";

export interface JudgmentRecord {
  id: string;
  /** AI 가 낸 시각 */
  createdAt: string;
  /** 본문 제안의 페이지 · 정리 제안이 이을 페이지(없으면 null) */
  pageId: string | null;
  workspaceId: string;
  /** 비공개 주제의 것인가 */
  privateWorkspace: boolean;
  task: JudgmentTask;
  runId: string | null;
  executor: AiTool | null;
  /** 본문 제안이 근거로 한 본문 지문 */
  contextVersion: string | null;
  /** 근거 자료(id · 그때 버전) — 본문은 넣지 않는다 */
  sourceRefs: { sourceId: string; version: string | null }[];
  /** AI 가 댄 근거 줄("S1:12" · "P3") */
  refs: string[];
  /** 정리 제안: 제목 · 개념 · 메모 / 본문 제안: 메모와 새 본문 지문 */
  output: { text: string; bodyHash?: string };
  /** 코드가 붙인 경고 */
  flags: string[];
  review: { action: ReviewAction; at: string | null; forced?: boolean };
  consent: { train: boolean; fewShot: boolean };
  usage: "none";
}

export interface JudgmentOptions {
  /** 비공개 주제 것도 넣을까(기본 아니오) */
  includePrivate?: boolean;
}

const action = (status: "open" | "accepted" | "rejected"): ReviewAction => (status === "accepted" ? "approved" : status === "rejected" ? "rejected" : "pending");

export function deriveJudgments(state: { manifest: WorkManifest; sources?: Source[] }, opts: JudgmentOptions = {}): JudgmentRecord[] {
  const privateOf = new Map(state.manifest.workspaces.map((w) => [w.id, w.private]));
  const version = new Map((state.sources ?? []).map((s) => [s.id, s.remoteVersion ?? null]));
  const out: JudgmentRecord[] = [];
  const base = { consent: { train: false, fewShot: false }, usage: "none" as const };
  for (const p of state.manifest.triage) {
    const priv = privateOf.get(p.workspaceId) ?? false;
    if (priv && !opts.includePrivate) continue;
    out.push({
      ...base,
      id: `triage:${p.id}`,
      createdAt: p.createdAt,
      pageId: p.itemId ?? null,
      workspaceId: p.workspaceId,
      privateWorkspace: priv,
      task: p.kind,
      runId: p.runId ?? null,
      executor: p.tool ?? null,
      contextVersion: null,
      sourceRefs: p.sourceIds.map((id) => ({ sourceId: id, version: version.get(id) ?? null })),
      refs: p.refs ?? [],
      output: { text: [p.title, p.concept, p.note].filter(Boolean).join(" — ") },
      flags: p.flags ?? [],
      review: { action: action(p.status), at: p.decidedAt ?? null },
    });
  }
  for (const p of state.manifest.bodyProposals ?? []) {
    // 이행 제안은 AI 판단이 아니다(옛 기록을 옮긴 것)
    if (p.origin !== "ai") continue;
    const priv = privateOf.get(p.workspaceId) ?? false;
    if (priv && !opts.includePrivate) continue;
    out.push({
      ...base,
      id: `body:${p.id}`,
      createdAt: p.createdAt,
      pageId: p.pageId,
      workspaceId: p.workspaceId,
      privateWorkspace: priv,
      task: "body",
      runId: p.runId ?? null,
      executor: p.tool,
      contextVersion: p.baseHash,
      sourceRefs: [],
      refs: p.refs ?? [],
      output: { text: p.note ?? "", bodyHash: p.rawHash },
      flags: p.flags ?? [],
      review: { action: action(p.status), at: p.decidedAt ?? null, ...(p.outcome === "forced" ? { forced: true } : {}) },
    });
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
