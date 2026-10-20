import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveJudgments, judgmentStats, toJsonl } from "./judgments.ts";
import { acceptProposal, addDecision, confirmDecision, createWorkItem, defaultManifest, linkSource, newSource, rejectDecision, rejectProposal, type WorkItem, type WorkState } from "./work.ts";
import { importResult, prepareRun, runMeta, type HandoffLabels } from "./workHandoff.ts";

const NOW = "2026-10-20T09:00:00.000Z";
const LATER = "2026-10-20T10:00:00.000Z";
const DECIDE = "2026-10-20T11:00:00.000Z";
const L = Object.fromEntries(
  ["title", "meta", "goal", "doneCriteria", "status", "summaryNone", "summaryStale", "decisions", "decisionsNone", "sources", "sourcesNone", "sourceAccess", "sourceNoExcerpt", "excludedCross", "scope", "taskDone", "openQuestions", "openNone", "nextActions", "returnFormat", "returnGuide", "rules", "rulesTitle", "droppedBudget"].map((k) => [k, k]),
) as unknown as HandoffLabels;
const manifest = () => defaultManifest({ personal: "개인", company: "회사", areas: { jobChange: "이직준비", personal: "개인업무", dev: "개발", sideJob: "부업", general: "공통" } });

const RESULT = (run: string) =>
  `<!-- llmwiki-run {"executor":"gemma","model":"gemma-4-E4B q4_0","latencyMs":461100} -->
요약입니다.

\`\`\`llmwiki-result
${JSON.stringify({ run, summary: "s", tasks: [{ title: "씨그로 지원", due: "2026-11-06", refs: ["S1:1"] }, { title: "역 확인" }], decisions: [{ text: "IT 공고 먼저", reason: "목표", refs: ["S1:1"] }] })}
\`\`\``;

function setup(workspaceId = "ws-personal"): { state: WorkState; item: WorkItem } {
  let item = createWorkItem({ workspaceId, areaId: workspaceId === "ws-personal" ? "area-jobChange" : "area-general", title: "지원 정리" }, NOW);
  const src = newSource({ workspaceId, provider: "note", title: "메모", text: "- 씨그로: 2026-11-06 마감" }, NOW);
  const r = linkSource(item, src, NOW);
  if (r.kind === "linked") item = r.item;
  const p = prepareRun(item, [src], manifest().workspaces, { tool: "gemma", scope: "정리" }, L, NOW);
  const imp = importResult(p.item, RESULT(p.run.id), LATER, { runId: p.run.id, tool: "gemma", lines: () => ["- 씨그로: 2026-11-06 마감"] });
  assert.equal(imp.kind, "imported");
  item = imp.kind === "imported" ? imp.item : item;
  return { item, state: { manifest: manifest(), items: [item], sources: [src] } };
}

test("실행 머리줄 — 모델 · 걸린 시간을 읽어 실행 기록에 남긴다", () => {
  assert.deepEqual(runMeta(RESULT("r")), { executor: "gemma", model: "gemma-4-E4B q4_0", latencyMs: 461100 });
  assert.equal(runMeta("머리줄 없음"), null);
  const { item } = setup();
  assert.equal(item.runs[0].model, "gemma-4-E4B q4_0");
  assert.equal(item.runs[0].latencyMs, 461100);
});

test("판단 기록 — 제안 · AI 결정이 한 행씩, 사람의 판단과 시각이 들어간다", () => {
  const { item, state } = setup();
  const [t0, t1] = item.proposals.filter((p) => p.kind === "task");
  let it = acceptProposal(item, t0.id, DECIDE);
  it = rejectProposal(it, t1.id, DECIDE);
  it = confirmDecision(it, it.decisions[0].id, DECIDE);
  it = addDecision(it, { text: "사람이 직접 정함", reason: "" }, DECIDE);
  const rows = deriveJudgments({ ...state, items: [it] });
  assert.equal(rows.length, 3, "사람이 직접 남긴 결정은 빠진다");
  const byText = Object.fromEntries(rows.map((r) => [r.output.text, r]));
  assert.deepEqual(byText["씨그로 지원"].review, { action: "approved", at: DECIDE });
  assert.equal(byText["씨그로 지원"].output.due, "2026-11-06");
  assert.deepEqual(byText["씨그로 지원"].refs, ["S1:1"]);
  assert.deepEqual(byText["역 확인"].review, { action: "rejected", at: DECIDE });
  assert.deepEqual(byText["역 확인"].flags, ["no_evidence"]);
  assert.equal(byText["IT 공고 먼저"].task, "decision");
  assert.equal(byText["IT 공고 먼저"].review.action, "approved");
  for (const r of rows) {
    assert.equal(r.executor, "gemma");
    assert.equal(r.model, "gemma-4-E4B q4_0");
    assert.deepEqual(r.consent, { train: false, fewShot: false });
    assert.equal(r.sourceRefs.length, 1);
    assert.ok(!JSON.stringify(r).includes("2026-11-06 마감"), "자료 본문은 들어가지 않는다");
  }
});

test("판단 기록 — 회사 작업실은 기본으로 빼고, 거절한 결정 · 대기도 센다", () => {
  const company = setup("ws-company");
  assert.equal(deriveJudgments(company.state).length, 0);
  assert.equal(deriveJudgments(company.state, { includeCompany: true }).length, 3);
  const { item, state } = setup();
  const it = rejectDecision(item, item.decisions[0].id, DECIDE);
  const s = judgmentStats(deriveJudgments({ ...state, items: [it] }));
  assert.deepEqual(s.all, { total: 3, approved: 0, rejected: 1, pending: 2, acceptRate: 0, flaggedButApproved: 0 });
  assert.equal(s.byExecutor.gemma.total, 3);
});

test("판단 기록 — 채택률 · 경고가 붙었는데 받아들인 수, JSONL 은 한 줄에 하나", () => {
  const { item, state } = setup();
  const [t0, t1] = item.proposals.filter((p) => p.kind === "task");
  const it = acceptProposal(acceptProposal(item, t0.id, DECIDE), t1.id, DECIDE);
  const rows = deriveJudgments({ ...state, items: [it] });
  const s = judgmentStats(rows).all;
  assert.equal(s.acceptRate, 1);
  assert.equal(s.flaggedButApproved, 1, "근거 없음 경고가 붙은 '역 확인'을 받아들였다");
  const lines = toJsonl(rows).trim().split("\n");
  assert.equal(lines.length, 3);
  assert.equal(JSON.parse(lines[0]).workItemId, it.id);
  assert.equal(toJsonl([]), "");
});
