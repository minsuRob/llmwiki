import { test } from "node:test";
import assert from "node:assert/strict";

import { emptyState, type AppState } from "./types.ts";
import {
  backlinks,
  buildVault,
  DEFAULT_GRAPH_SETTINGS,
  filterVault,
  groupColor,
  layoutVault,
  linkTargets,
  localGraph,
  matchQuery,
  normalizeSettings,
  outgoingLinks,
  parseWikiLinks,
  scrapTitle,
  showLabelAt,
} from "./vault.ts";

const T = "2026-10-19T10:00:00.000Z";

function sample(): AppState {
  const s = emptyState();
  s.tasks = [
    { id: "t1", title: "LLM 공부", done: false, createdAt: T },
    { id: "t2", title: "오픈 헤르메스 개발", notes: "[[LLM 공부]] 와 같이 본다", done: false, createdAt: T },
    { id: "t3", title: "지운 일", done: false, createdAt: T, deletedAt: T },
  ];
  s.scraps = [
    { id: "s1", text: "INDEX\n[[LLM 공부]] [[오픈 헤르메스 개발|헤르메스]] [[에이전트 활용법]]", label: "메모", createdAt: T },
    { id: "s2", text: "카파시 영상 메모 #llm", label: "정보", createdAt: T },
    { id: "s3", text: "혼자 있는 메모", label: "메모", createdAt: T },
    { id: "s4", text: "[[INDEX]] 다시 보기", label: "메모", createdAt: T },
    { id: "s5", text: "숙소 정리 #여행", label: "메모", createdAt: T },
    { id: "s6", text: "야시장 [[숙소 정리]] 근처", label: "메모", createdAt: T },
  ];
  s.nodes = [{ id: "n1", name: "llm", kind: "tag", refs: [{ type: "scrap", id: "s2" }, { type: "task", id: "t1" }, { type: "task", id: "t3" }], updatedAt: T }];
  return s;
}

test("[[링크]] 읽기 — 별칭 · 소제목은 떼고, 같은 제목은 한 번만", () => {
  assert.deepEqual(parseWikiLinks("[[A]] 와 [[B|비]] 그리고 [[C#절]] 또 [[a]]"), ["A", "B", "C"]);
  assert.deepEqual(parseWikiLinks("링크 없음 [[]] [단일]"), []);
});

test("기록 제목 — 첫 줄, [[ ]] 는 벗기고 별칭이 있으면 별칭", () => {
  assert.equal(scrapTitle("\n  [[LLM 공부|공부]] 정리\n둘째 줄"), "공부 정리");
  assert.equal(scrapTitle("가".repeat(50)).length, 41);
  assert.equal(scrapTitle("대만 여행 숙소 정리 #여행"), "대만 여행 숙소 정리", "#태그는 제목이 아니다");
});

test("볼트 그래프 — 할일 제목 · 기록 첫 줄로 링크가 이어지고, 없는 대상은 아직 없는 노트", () => {
  const g = buildVault(sample());
  const ids = g.nodes.map((n) => n.id);
  assert.ok(!ids.includes("task:t3"), "지운 할일은 빠진다");
  assert.ok(g.links.some((l) => l.kind === "link" && l.source === "scrap:s1" && l.target === "task:t1"));
  assert.ok(g.links.some((l) => l.kind === "link" && l.source === "scrap:s1" && l.target === "task:t2"), "별칭 링크도 제목으로 잇는다");
  assert.ok(g.links.some((l) => l.kind === "link" && l.source === "task:t2" && l.target === "task:t1"), "할일 메모 속 링크");
  assert.ok(g.links.some((l) => l.source === "scrap:s4" && l.target === "scrap:s1"), "기록 첫 줄(INDEX)로 잇는다");
  assert.ok(g.links.some((l) => l.source === "scrap:s6" && l.target === "scrap:s5"), "태그를 뺀 제목으로도 잇는다");
  const missing = g.nodes.find((n) => n.kind === "missing");
  assert.equal(missing?.name, "에이전트 활용법");
  // 개념은 지운 글 쪽 선 없이 붙는다
  const conceptLinks = g.links.filter((l) => l.kind === "concept");
  assert.deepEqual(conceptLinks.map((l) => l.source).sort(), ["scrap:s2", "task:t1"]);
});

test("백링크 · 나가는 링크", () => {
  const g = buildVault(sample());
  assert.deepEqual(backlinks(g, "task:t1").map((n) => n.id).sort(), ["scrap:s1", "task:t2"]);
  assert.deepEqual(outgoingLinks(g, "scrap:s1").map((n) => n.name), ["LLM 공부", "오픈 헤르메스 개발", "에이전트 활용법"]);
  assert.deepEqual(backlinks(g, "scrap:s1").map((n) => n.id), ["scrap:s4"]);
  const targets = linkTargets(g, "scrap:s1");
  assert.equal(targets.get("오픈 헤르메스 개발"), "task:t2");
  assert.equal(targets.get("에이전트 활용법"), "missing:에이전트 활용법");
});

test("필터 — 태그(개념) · 없는 노트 · 미연결 노트를 옵시디언처럼 켜고 끈다", () => {
  const g = buildVault(sample());
  const base = { search: "", showTags: false, hideUnresolved: false, showOrphans: true };
  assert.ok(!filterVault(g, base).nodes.some((n) => n.kind === "concept"), "태그 꺼짐 → 개념 없음");
  assert.ok(filterVault(g, { ...base, showTags: true }).nodes.some((n) => n.kind === "concept"));
  assert.ok(!filterVault(g, { ...base, hideUnresolved: true }).nodes.some((n) => n.kind === "missing"));
  const noOrphans = filterVault(g, { ...base, showOrphans: false }).nodes.map((n) => n.id);
  assert.ok(!noOrphans.includes("scrap:s3"), "혼자인 기록은 빠진다");
  assert.ok(!noOrphans.includes("scrap:s2"), "개념을 숨기면 개념으로만 이어진 기록도 미연결이다");
  assert.ok(filterVault(g, { ...base, showOrphans: false, showTags: true }).nodes.some((n) => n.id === "scrap:s2"));
});

test("검색 문법 — 말 · tag: · path: · 빼기", () => {
  const g = buildVault(sample());
  const byId = (id: string) => g.nodes.find((n) => n.id === id)!;
  assert.ok(matchQuery(g, byId("task:t1"), "공부"));
  assert.ok(matchQuery(g, byId("scrap:s2"), "tag:#llm"));
  assert.ok(matchQuery(g, byId("task:t1"), "tag:llm path:할일"));
  assert.ok(!matchQuery(g, byId("scrap:s2"), "path:할일"));
  assert.ok(matchQuery(g, byId("scrap:s3"), "-tag:llm"));
  const searched = filterVault(g, { search: "tag:llm", showTags: true, hideUnresolved: false, showOrphans: true });
  assert.deepEqual(searched.nodes.map((n) => n.id).sort(), ["concept:n1", "scrap:s2", "task:t1"]);
});

test("로컬 그래프 — 깊이만큼 퍼진다", () => {
  const g = buildVault(sample());
  const one = localGraph(g, "task:t1", 1).nodes.map((n) => n.id).sort();
  assert.deepEqual(one, ["concept:n1", "scrap:s1", "task:t1", "task:t2"]);
  const two = localGraph(g, "task:t1", 2).nodes.map((n) => n.id);
  assert.ok(two.includes("scrap:s4") && two.includes("scrap:s2") && two.includes("missing:에이전트 활용법"));
  assert.ok(!two.includes("scrap:s3"));
  assert.deepEqual(localGraph(g, "없음", 2), { nodes: [], links: [] });
});

test("그룹 색 — 위 그룹이 먼저", () => {
  const g = buildVault(sample());
  const t1 = g.nodes.find((n) => n.id === "task:t1")!;
  const groups = [
    { query: "path:할일", color: "#f00" },
    { query: "tag:llm", color: "#0f0" },
  ];
  assert.equal(groupColor(g, t1, groups), "#f00");
  assert.equal(groupColor(g, g.nodes.find((n) => n.id === "scrap:s2")!, groups), "#0f0");
  assert.equal(groupColor(g, g.nodes.find((n) => n.id === "scrap:s3")!, groups), null);
});

test("힘 배치 — 같은 입력은 같은 결과, 이어진 점은 떨어진 점보다 가깝다, 링크 거리를 따른다", () => {
  const g = buildVault(sample());
  const a = layoutVault(g, DEFAULT_GRAPH_SETTINGS);
  const b = layoutVault(g, DEFAULT_GRAPH_SETTINGS);
  assert.deepEqual([...a.entries()], [...b.entries()]);
  for (const p of a.values()) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  const d = (x: string, y: string) => Math.hypot(a.get(x)!.x - a.get(y)!.x, a.get(x)!.y - a.get(y)!.y);
  assert.ok(d("task:t1", "task:t2") < d("task:t1", "scrap:s3"), "이어진 점이 더 가깝다");
  const near = layoutVault(g, { ...DEFAULT_GRAPH_SETTINGS, linkDistance: 60 });
  const far = layoutVault(g, { ...DEFAULT_GRAPH_SETTINGS, linkDistance: 450 });
  const dist = (m: Map<string, { x: number; y: number }>) => Math.hypot(m.get("task:t1")!.x - m.get("task:t2")!.x, m.get("task:t1")!.y - m.get("task:t2")!.y);
  assert.ok(dist(near) < dist(far));
});

test("설정 — 저장된 값의 범위를 맞추고 빠진 값은 기본값", () => {
  const s = normalizeSettings({ repelStrength: 99, depth: 2.6, groups: [{ query: "a", color: "#fff" }, { bad: 1 }], showTags: true });
  assert.equal(s.repelStrength, 20);
  assert.equal(s.depth, 3);
  assert.equal(s.groups.length, 1);
  assert.equal(s.showTags, true);
  assert.equal(s.linkDistance, 250);
  assert.deepEqual(normalizeSettings("망가짐"), DEFAULT_GRAPH_SETTINGS);
});

test("이름 표시 — 텍스트 표시 시작점이 클수록 작게 봐도 보인다", () => {
  assert.ok(showLabelAt(1, 0));
  assert.ok(!showLabelAt(0.3, 0));
  assert.ok(showLabelAt(0.3, 1));
});
