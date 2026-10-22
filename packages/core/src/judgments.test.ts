import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveJudgments, judgmentStats, toJsonl } from "./judgments.ts";
import { acceptBodyProposal, createPage, proposeBody } from "./pages.ts";
import { defaultManifest, newSource, proposeTriage, rejectTriage, type WorkManifest } from "./work.ts";

const NOW = "2026-10-20T09:00:00.000Z";
const DECIDE = "2026-10-20T11:00:00.000Z";

function setup() {
  let manifest: WorkManifest = defaultManifest({ personal: "개인", company: "회사", dev: "개발", reading: "독서" });
  const page = createPage([], { workspaceId: "ws-personal", title: "지원 정리", body: "# 지원" }, NOW);
  const secret = createPage(page.kind === "ok" ? page.pages : [], { workspaceId: "ws-company", title: "회사 일", body: "비밀" }, NOW);
  if (page.kind !== "ok" || secret.kind !== "ok") throw new Error();
  const src = newSource({ workspaceId: "ws-personal", provider: "note", title: "메모", text: "- 씨그로: 2026-11-06 마감", triage: "inbox" }, NOW);
  const pages = secret.pages;
  const t = proposeTriage({ manifest, pages, sources: [src] }, [{ kind: "file_source", sourceIds: [src.id], itemId: page.page.id, refs: ["S1:1"] }, { kind: "concept_link", sourceIds: [src.id], concept: "씨그로" }], NOW, { runId: "r1", tool: "gemma" });
  manifest = rejectTriage(t.manifest, t.added[1].id, DECIDE);
  const b = proposeBody({ manifest, pages }, { pageId: page.page.id, body: "# 지원\n- 씨그로", tool: "claude", runId: "r2", note: "씨그로 더함" }, NOW);
  const c = proposeBody({ manifest: b.kind === "ok" ? b.manifest : manifest, pages }, { pageId: secret.page.id, body: "비밀 2", tool: "codex" }, NOW, { includePrivate: true });
  if (b.kind !== "ok" || c.kind !== "ok") throw new Error();
  const acc = acceptBodyProposal(c.manifest, page.page, page.doc, b.proposal.id, b.body, DECIDE);
  if (acc.kind !== "ok") throw new Error();
  return { manifest: acc.manifest, src, page: page.page };
}

test("판단 기록 — 정리 제안 · 본문 제안이 한 행씩, 사람의 판단과 시각이 들어가고 본문은 넣지 않는다", () => {
  const { manifest, src, page } = setup();
  const rows = deriveJudgments({ manifest, sources: [src] });
  assert.deepEqual(rows.map((r) => `${r.task}:${r.review.action}:${r.executor}`).sort(), ["body:approved:claude", "concept_link:rejected:gemma", "file_source:pending:gemma"]);
  const body = rows.find((r) => r.task === "body");
  assert.equal(body?.pageId, page.id);
  assert.equal(body?.output.text, "씨그로 더함");
  assert.ok(body?.output.bodyHash);
  assert.ok(!JSON.stringify(rows).includes("- 씨그로"), "본문 글은 들어가지 않는다");
  assert.deepEqual(rows.find((r) => r.task === "file_source")?.sourceRefs, [{ sourceId: src.id, version: src.remoteVersion }]);
  assert.ok(rows.every((r) => r.consent.train === false && r.usage === "none"));
});

test("비공개 주제는 기본으로 빼고, 실행자별 채택률을 낸다 · JSONL", () => {
  const { manifest } = setup();
  assert.equal(deriveJudgments({ manifest }).some((r) => r.privateWorkspace), false);
  const all = deriveJudgments({ manifest }, { includePrivate: true });
  assert.equal(all.filter((r) => r.privateWorkspace).length, 1);
  const s = judgmentStats(deriveJudgments({ manifest }));
  assert.deepEqual([s.all.approved, s.all.rejected, s.all.pending, s.all.acceptRate], [1, 1, 1, 0.5]);
  assert.deepEqual(s.byExecutor.gemma.acceptRate, 0);
  assert.deepEqual(s.byExecutor.claude.acceptRate, 1);
  assert.equal(toJsonl([]), "");
  assert.equal(toJsonl(all).trim().split("\n").length, all.length);
});
