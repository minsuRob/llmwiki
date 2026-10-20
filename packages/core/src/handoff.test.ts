import { test } from "node:test";
import assert from "node:assert/strict";

import { ACCESS_LIMITS, buildBundle, splitSections, validateResult, type ResultContext } from "./handoff.ts";

const DOC = [
  "# 그룹바이 진행 현황",
  "",
  "## 요약",
  "- 519건 중 513건 상세 조사 완료",
  "- 삭제되어 조사 불가 6건",
  "",
  "## 데이터 품질 메모",
  "- 씨그로: 2026-11-06 마감.",
  "- 가까운 역 정보는 대부분 추정이다.",
  "",
  "## 남은 일",
  "- 새 공고는 목록을 다시 수집해야 한다.",
].join("\n");

const CTX: ResultContext = {
  runId: "run-001", taskId: "task-b1", contextVersion: 3,
  sourceLines: { P: DOC.split("\n") }, knownIds: { post: new Set(["406905"]) },
};

const base = {
  run_id: "run-001", task_id: "task-b1", context_version: 3,
  artifacts: [{ title: "재수집 계획", summary: "새 공고만 조사", source_refs: ["P:12"] }],
  decision_proposals: [{ text: "기존 분류 기준 유지", reason: "일관성", source_refs: ["P:4"] }],
  todo_proposals: [{ text: "씨그로 지원 여부 결정", due: "2026-11-06", source_refs: ["P:8"] }],
  unverified: [{ text: "역 정보", why: "추정" }],
};
const block = (o: unknown) => "```llmwiki-result\n" + (typeof o === "string" ? o : JSON.stringify(o)) + "\n```";
const withField = (patch: Record<string, unknown>) => {
  const o: Record<string, unknown> = structuredClone(base);
  for (const [k, v] of Object.entries(patch)) v === undefined ? delete o[k] : (o[k] = v);
  return o;
};

test("묶음 자르기 — '## ' 제목 단위, 원문 줄 번호 유지", () => {
  const s = splitSections("P", DOC);
  assert.deepEqual(s.map((x) => x.title), ["(머리말)", "요약", "데이터 품질 메모", "남은 일"]);
  assert.equal(s[2]!.start, 7);
});

test("묶음 — 예산이 작아도 목표·기준·결정·한계·결과 형식은 남고, 자료만 빠진다", () => {
  const tok = (s: string) => Math.ceil(s.length / 1.36);
  const task = { goal: "새 그룹바이 공고를 다시 수집한다", criteria: ["5분 간격 유지"], decisions: ["기존 분류 기준 유지"] };
  const ids = { runId: "run-001", taskId: "task-b1", contextVersion: 3 };
  const sources = splitSections("P", DOC).filter((s) => s.title !== "(머리말)");
  const tiny = buildBundle(ids, task, sources, tok, 10);
  for (const must of [task.goal, ...task.criteria, ...task.decisions, ACCESS_LIMITS[0]!, "```llmwiki-result"]) assert.ok(tiny.text.includes(must), must);
  assert.equal(tiny.included.length, 0);
  assert.match(tiny.text, /예산 초과로 뺀 자료/);
  const roomy = buildBundle(ids, task, sources, tok, 100_000);
  assert.equal(roomy.dropped.length, 0);
  assert.match(roomy.text, /P:8\| - 씨그로/);
  const mid = buildBundle(ids, task, sources, tok, roomy.tokens - 20);
  assert.ok(mid.tokens <= roomy.tokens - 20, "자료를 빼면 예산 안에 든다");
});

test("결과 — 정상 블록은 통과해도 '제안'으로만 받는다", () => {
  const r = validateResult(block(base), CTX);
  assert.deepEqual([r.parse_ok, r.schema_ok, r.content_ok], [true, true, true]);
  assert.equal(r.accepted_as, "proposal");
  assert.equal(r.warnings.length, 0);
  assert.equal(validateResult(JSON.stringify(base), CTX).content_ok, true, "펜스 없이 JSON 만 와도 읽는다");
});

test("결과 — 확정·완료를 시도하는 필드는 막는다", () => {
  assert.equal(validateResult(block(withField({ status: "done" })), CTX).schema_ok, false);
  const nested = withField({ decision_proposals: [{ text: "x", confirmed: true, source_refs: [] }] });
  assert.match(validateResult(block(nested), CTX).errors[0]!, /금지 필드/);
});

test("결과 — 파싱 · 형식 · 내용 오류를 단계별로 구분한다", () => {
  const cases: [string, string, Partial<Record<"parse_ok" | "schema_ok" | "content_ok", boolean>>][] = [
    ["끝 쉼표", block('{"run_id": "run-001",}'), { parse_ok: false }],
    ["블록 없음", "다 했습니다.", { parse_ok: false }],
    ["모르는 필드", block(withField({ notes: "hi" })), { parse_ok: true, schema_ok: false }],
    ["run_id 빠짐", block(withField({ run_id: undefined })), { schema_ok: false }],
    ["버전이 문자열", block(withField({ context_version: "3" })), { schema_ok: false }],
    ["목록이 배열 아님", block(withField({ todo_proposals: { text: "x" } })), { schema_ok: false }],
    ["필수 누락", block(withField({ artifacts: [{ title: "t", source_refs: [] }] })), { schema_ok: false }],
    ["다른 run", block(withField({ run_id: "run-999" })), { schema_ok: true, content_ok: false }],
    ["낡은 맥락 버전", block(withField({ context_version: 2 })), { content_ok: false }],
    ["없는 줄", block(withField({ artifacts: [{ title: "t", summary: "s", source_refs: ["P:999"] }] })), { content_ok: false }],
    ["참조 모양 오류", block(withField({ artifacts: [{ title: "t", summary: "s", source_refs: ["진행현황 문서"] }] })), { content_ok: false }],
    ["없는 공고", block(withField({ artifacts: [{ title: "t", summary: "s", source_refs: ["post:1"] }] })), { content_ok: false }],
    ["있는 공고", block(withField({ artifacts: [{ title: "t", summary: "s", source_refs: ["post:406905"] }] })), { content_ok: true }],
    ["없는 날짜", block(withField({ todo_proposals: [{ text: "x", due: "2026-13-40", source_refs: ["P:8"] }] })), { content_ok: false }],
  ];
  for (const [name, text, want] of cases) {
    const r = validateResult(text, CTX);
    for (const [k, v] of Object.entries(want)) assert.equal(r[k as keyof typeof want], v, `${name}: ${k}`);
    assert.equal(r.accepted_as, "proposal", name);
  }
});

test("결과 — 근거 줄에 없는 기한·근거 없는 제안은 경고로 표시한다", () => {
  const made = validateResult(block(withField({ todo_proposals: [{ text: "재수집", due: "2026-10-25", source_refs: ["P:12"] }] })), CTX);
  assert.equal(made.content_ok, true);
  assert.match(made.warnings[0]!, /근거 없는 기한/);
  const noRef = validateResult(block(withField({ decision_proposals: [{ text: "x", reason: "y", source_refs: [] }] })), CTX);
  assert.match(noRef.warnings[0]!, /근거 참조 없음/);
});
