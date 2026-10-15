import { test } from "node:test";
import assert from "node:assert/strict";

import { runTool, newLedger } from "./engine.ts";
import { planLocal } from "./local.ts";
import { degree, extractConcepts, mergeConcepts, neighbors, normalizeTerm, rebuildGraph, recall } from "./synapse.ts";
import { emptyState, type AppState } from "./types.ts";

const NOW = new Date(2026, 9, 15, 10, 0);

/** 서버 길처럼 "기로 했다" 는 결정 라벨을 붙인다 — 라벨이 개념으로 새지 않는지까지 본다 */
function withScraps(texts: string[]): AppState {
  const s = emptyState();
  s.scraps = texts.map((text, i) => ({ id: `s${i}`, text, label: /기로\s*했/.test(text) ? ("결정" as const) : ("메모" as const), createdAt: NOW.toISOString() }));
  return s;
}

test("말 다듬기 — 조사를 떼고, 동사꼴 · 흔한 말은 뺀다", () => {
  assert.equal(normalizeTerm("채용을"), "채용");
  assert.equal(normalizeTerm("디자이너와"), "디자이너");
  assert.equal(normalizeTerm("발표에서"), "발표");
  assert.equal(normalizeTerm("늘리기로"), null);
  assert.equal(normalizeTerm("했다"), null);
  assert.equal(normalizeTerm("오늘"), null);
});

test("개념 뽑기 — 감정은 표준 이름으로 모은다", () => {
  const a = extractConcepts("발표가 너무 기대된다");
  const b = extractConcepts("발표 생각하면 설레");
  assert.ok(a.some((c) => c.name === "설렘" && c.kind === "emotion"));
  assert.ok(b.some((c) => c.name === "설렘" && c.kind === "emotion"));
  assert.ok(a.some((c) => c.name === "발표" && c.kind === "topic"));
  assert.ok(extractConcepts("#회고 남기기").some((c) => c.name === "회고" && c.kind === "tag"));
  assert.ok(extractConcepts("기분이 좋다").some((c) => c.name === "기쁨"));
  assert.ok(!extractConcepts("리허설을 하면 좋겠다").some((c) => c.kind === "emotion"), "바람은 감정이 아니다");
});

test("그래프 다시 계산 — 두 글 이상에 나온 주제만 남고, 같은 글의 개념은 이어진다", () => {
  const s = withScraps(["채용 공고를 다음 주에 올린다", "채용 면접이 걱정된다", "디자이너 채용은 천천히", "점심은 김밥"]);
  const g = rebuildGraph(s, NOW);
  const names = g.nodes.map((n) => n.name).sort();
  assert.ok(names.includes("채용"));
  assert.ok(names.includes("불안"), "감정은 한 번만 나와도 남는다");
  assert.ok(!names.includes("김밥"), "한 번 나온 주제는 아직 개념이 아니다");
  const hire = g.nodes.find((n) => n.name === "채용")!;
  assert.equal(hire.refs.length, 3);
  assert.ok(neighbors(g, hire.id).some((x) => x.node.name === "불안"), "감정은 원인과 이어진다");
  assert.ok(degree(g, hire.id) > 3);
});

test("다시 계산해도 같은 이름의 노드 id 는 지킨다", () => {
  const s = withScraps(["채용 공고", "채용 면접"]);
  const g1 = rebuildGraph(s, NOW);
  const s2 = { ...s, ...g1, scraps: [...s.scraps, { id: "s9", text: "채용 마감", label: "메모" as const, createdAt: NOW.toISOString() }] };
  const g2 = rebuildGraph(s2, NOW);
  assert.equal(g2.nodes.find((n) => n.name === "채용")!.id, g1.nodes.find((n) => n.name === "채용")!.id);
});

test("모델 길 합치기 — 관계 이름을 엣지에 단다", () => {
  const g = mergeConcepts([], [], { type: "scrap", id: "x" }, [{ name: "야근", kind: "topic" }, { name: "지침", kind: "emotion" }], [{ from: "야근", to: "지침", relation: "원인" }], NOW);
  assert.equal(g.nodes.length, 2);
  assert.equal(g.edges[0].relation, "원인");
});

test("떠올리기 — 노드와 이웃의 글을 모으고, 없으면 본문에서 찾는다", () => {
  const s = withScraps(["채용 공고를 다음 주에 올린다", "채용 면접이 걱정된다", "회고: 이번 분기 매출 좋았다"]);
  Object.assign(s, rebuildGraph(s, NOW));
  const r = recall(s, "채용");
  assert.deepEqual(r.scrapIds.sort(), ["s0", "s1"]);
  assert.deepEqual(recall(s, "매출").scrapIds, ["s2"], "그래프에 없는 말은 본문에서");

  const ledger = newLedger();
  const out = runTool(s, "recall", { query: "채용" }, ledger, NOW);
  assert.match(out.output, /^Shown a recall card/);
  assert.equal(ledger.cards[0].kind, "recall");
  assert.match(runTool(s, "recall", { query: "우주여행" }, newLedger(), NOW).output, /없습니다/);
});

test("기기 안 길 — 떠올리기 질문을 recall 로", () => {
  assert.deepEqual(planLocal("전에 채용 얘기 뭐라고 했지?", NOW).calls, [{ name: "recall", input: { query: "채용" } }]);
  assert.deepEqual(planLocal("발표 관련 기록 찾아줘", NOW).calls, [{ name: "recall", input: { query: "발표" } }]);
  assert.equal(planLocal("메모: 채용 기록 정리", NOW).calls[0].name, "add_scrap");
});

/** 시냅스 묶음 시나리오 — 기록 10건이 발표 · 채용 · 운동 세 갈래로 묶이고, 사람과 감정이 갈래를 잇는다 */
export const TEN_MEMOS = [
  "다음 주 투자 발표 자료는 수요일까지 마무리하기로 했다 #발표",
  "투자 발표 리허설을 지민이랑 하면 좋겠다",
  "발표 생각하면 긴장된다",
  "디자이너 채용 공고를 이번 주에 올리기로 했다 #채용",
  "채용 면접 질문을 지민이 정리해 주기로 했다",
  "채용이 늦어져서 걱정이다",
  "아침 운동을 다시 시작하니 기분이 좋다 #운동",
  "운동 끝나고 발표 준비하니 집중이 잘 된다",
  "야근이 계속돼서 지쳤다, 운동을 못 했다",
  "지민이 채용 면접에 같이 들어가 주기로 했다",
];

test("기록 10건 — 세 갈래로 묶이고 사람 · 감정이 갈래를 잇는다", () => {
  const g = rebuildGraph(withScraps(TEN_MEMOS), NOW);
  const node = (name: string) => g.nodes.find((n) => n.name === name);
  const linked = (a: string, b: string) => neighbors(g, node(a)!.id).some((x) => x.node.name === b);

  // 세 갈래의 중심
  assert.equal(node("발표")?.refs.length, 4);
  assert.equal(node("채용")?.refs.length, 4);
  assert.equal(node("운동")?.refs.length, 3);
  // 태그는 같은 이름의 개념으로 모인다
  assert.equal(g.nodes.filter((n) => n.name.includes("발표")).length, 1);
  assert.ok(!g.nodes.some((n) => n.name.startsWith("#")));
  // 갈래 안
  assert.ok(linked("발표", "투자"));
  assert.ok(linked("채용", "면접"));
  assert.ok(linked("운동", "지침"));
  assert.ok(linked("운동", "기쁨"));
  // 갈래 사이를 잇는 것: 사람(지민) · 감정(불안) · 운동 뒤 발표 준비
  assert.ok(linked("지민", "발표") && linked("지민", "채용"));
  assert.ok(linked("불안", "발표") && linked("불안", "채용"));
  assert.ok(linked("운동", "발표"));
  // 한 번만 나온 말(디자이너 · 리허설 · 야근 …)은 아직 개념이 아니다
  assert.ok(!node("디자이너") && !node("리허설") && !node("야근"));
  assert.ok(!node("결정"), "라벨은 개념이 아니다");
  assert.ok(g.nodes.length >= 9 && g.nodes.length <= 12, `개념 수 ${g.nodes.length}`);

  // 떠올리기 — 채용 갈래의 기록만 모은다
  const s = { ...withScraps(TEN_MEMOS), ...g };
  const r = recall(s, "채용");
  assert.deepEqual(r.scrapIds.sort(), ["s3", "s4", "s5", "s9"]);
});
