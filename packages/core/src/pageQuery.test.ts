/**
 * 하위 페이지 거르기 · 정렬 · 표 데이터 가져오기 — 공고든 무엇이든 같은 길.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { preparePageRun, type PagePackLabels } from "./pageHandoff.ts";
import { describeQuery, facetsOf, parseWhere, queryPages } from "./pageQuery.ts";
import { createPage, importPlan, keysBetween, rowsToEntries, setPageProps, type PageMeta } from "./pages.ts";
import { defaultManifest } from "./work.ts";

const NOW = "2026-10-22T09:00:00.000Z";

function kids(n = 60): PageMeta[] {
  const keys = keysBetween(null, null, n);
  return keys.map((order, i) => ({
    id: `p${i}`,
    workspaceId: "ws-personal",
    parentId: "top",
    order,
    title: `회사${i} — ${i % 3 === 0 ? "AI 엔지니어" : "백엔드"}`,
    createdAt: NOW,
    updatedAt: `2026-10-${String(10 + (i % 10)).padStart(2, "0")}T00:00:00.000Z`,
    rev: 0,
    bodyHash: `h${i}`,
    bodyLen: 100,
    bodyRef: "file" as const,
    props: {
      source: i % 2 ? "inthiswork" : "groupby",
      dev: i % 5 ? "true" : "false",
      company: `회사${i}`,
      ...(i % 4 ? { dueDate: `2026-${i % 2 ? "10" : "11"}-${String((i % 28) + 1).padStart(2, "0")}` } : {}),
      ...(i % 7 === 0 ? { career: "신입" } : {}),
      score: String(i % 13),
    },
  }));
}

test("거를 키 — 값이 적은 키는 칩(enum), 날짜는 date, 값이 제각각인 키는 글로만(text)", () => {
  const f = facetsOf(kids());
  const kind = Object.fromEntries(f.map((x) => [x.key, x.kind]));
  assert.deepEqual(kind, { source: "enum", dev: "enum", company: "text", dueDate: "date", score: "enum", career: "enum" });
  assert.deepEqual(f.find((x) => x.key === "source")?.values, [
    { value: "groupby", count: 30 },
    { value: "inthiswork", count: 30 },
  ]);
  assert.equal(f[0].count, 60, "많이 쓰인 키부터");
});

test("거르기 — 같은 키 안은 또는 · 키끼리는 그리고 · 날짜는 이후만(없는 값은 남김) · 낱말은 제목 · 값 · 본문", () => {
  const ps = kids();
  const g = queryPages(ps, { where: { source: ["groupby"], dev: ["true"] } });
  assert.ok(g.length > 0 && g.every((p) => p.props?.source === "groupby" && p.props?.dev === "true"));
  assert.equal(queryPages(ps, { where: { source: ["groupby", "inthiswork"] } }).length, 60);
  const fut = queryPages(ps, { from: { dueDate: "2026-11-01" } });
  assert.ok(fut.every((p) => !p.props?.dueDate || p.props.dueDate >= "2026-11-01"));
  assert.ok(fut.some((p) => !p.props?.dueDate), "마감이 없는 것은 지난 것이 아니다");
  assert.equal(queryPages(ps, { text: "ai 엔지니어" }).length, 20);
  assert.deepEqual(queryPages(ps, { text: "신입 회사7 " }).map((p) => p.id), ["p7"]);
  assert.equal(queryPages(ps, { text: "피트인" }, (p) => (p.id === "p3" ? "피트인 출신 팀" : undefined)).length, 1, "본문까지 찾기");
});

test("정렬 — 아무 키로, 숫자는 수로, 없는 값은 늘 뒤로 · 제목 · 고친 때", () => {
  const ps = kids();
  const byDue = queryPages(ps, { sort: { key: "dueDate", dir: "asc" } });
  const dues = byDue.map((p) => p.props?.dueDate);
  const firstMissing = dues.findIndex((d) => !d);
  assert.ok(dues.slice(0, firstMissing).every((d, i, a) => !i || (a[i - 1] as string) <= (d as string)));
  assert.ok(dues.slice(firstMissing).every((d) => !d), "없는 값은 뒤로");
  const desc = queryPages(ps, { sort: { key: "dueDate", dir: "desc" } });
  assert.ok(!desc.at(-1)?.props?.dueDate, "내림차순이어도 없는 값은 뒤로");
  const score = queryPages(ps, { sort: { key: "score", dir: "desc" } }).map((p) => Number(p.props?.score));
  assert.equal(score[0], 12, "숫자는 수로(12 > 9)");
  assert.equal(queryPages(ps, { sort: { key: "updatedAt", dir: "desc" } })[0].updatedAt.slice(0, 10), "2026-10-19");
  assert.deepEqual(parseWhere("source=groupby, dev=true; source = inthiswork"), { source: ["groupby", "inthiswork"], dev: ["true"] });
  assert.equal(describeQuery({ where: { source: ["groupby"] }, from: { dueDate: "2026-11-01" }, text: "AI" }), 'source=groupby · dueDate≥2026-11-01 · "AI"');
});

test("표 데이터 가져오기 — JSON · CSV 어느 쪽이든 제목 · 본문 · 바깥 id 칸을 찾고 나머지는 작은 값", () => {
  const json = rowsToEntries(JSON.stringify([
    { id: 1, 제목: "피트인", 본문: "## 주요 업무\n\nLLM", 마감: "2026-11-30", 태그: ["AI", "백엔드"], 상세: { 깊은: 1 } },
    { id: 2, 제목: "그룹바이", 본문: "", 마감: "" },
  ]));
  assert.deepEqual(json, [
    { title: "피트인", markdown: "## 주요 업무\n\nLLM", externalId: "row:1", props: { 마감: "2026-11-30", 태그: "AI, 백엔드" } },
    { title: "그룹바이", markdown: "", externalId: "row:2", props: {} },
  ]);
  const csv = rowsToEntries('name,company,note\n"백엔드, 신입",피트인,"줄 하나\n줄 둘"\n데이터 엔지니어,그룹바이,"""인용"""\n');
  assert.deepEqual(csv?.map((e) => [e.title, e.props?.company, e.props?.note]), [
    ["백엔드, 신입", "피트인", "줄 하나\n줄 둘"],
    ["데이터 엔지니어", "그룹바이", '"인용"'],
  ]);
  assert.match(csv?.[0].externalId ?? "", /^row:/, "id 칸이 없으면 제목 지문");
  assert.equal(rowsToEntries("# 마크다운\n본문"), null, "표가 아니면 null — 마크다운으로");
  assert.equal(rowsToEntries("{깨진"), null);
  const parent = createPage([], { workspaceId: "ws-personal", title: "지원" }, NOW);
  if (parent.kind !== "ok" || !json) return assert.fail();
  const plan = importPlan(parent.pages, "ws-personal", parent.page.id, json, NOW);
  assert.ok(!("kind" in plan) && plan.create.length === 2);
});

test("작은 값 고치기(사람) · 거른 하위만 AI 에게", () => {
  const top = createPage([], { workspaceId: "ws-personal", title: "지원", id: "top" }, NOW);
  if (top.kind !== "ok") return assert.fail();
  const pages = [...top.pages, ...kids(12)];
  const edited = setPageProps(pages, "p1", { source: "groupby", 메모: " 1순위 ", 빈칸: "" }, NOW);
  assert.deepEqual(edited.find((p) => p.id === "p1")?.props, { source: "groupby", 메모: "1순위" });
  assert.equal(setPageProps(edited, "p1", { 메모: "1순위", source: "groupby" }, NOW).find((p) => p.id === "p1")?.rev, edited.find((p) => p.id === "p1")?.rev, "같은 값이면 바꾸지 않는다");
  const L = { title: "{title}", meta: "{run}", intro: "", path: "{path}", page: "본문", children: "하위", childrenMore: "{count}", bodies: "본문들", bodiesMore: "{count}", scope: "범위", rulesTitle: "규칙", rules: "", returnFormat: "형식", returnGuide: "", filtered: "거른 하위만: {query} · {count}/{total}" } satisfies PagePackLabels;
  const picked = queryPages(pages.filter((p) => p.parentId === "top"), { where: { source: ["groupby"] } });
  const r = preparePageRun({ manifest: defaultManifest({ personal: "개인", company: "회사", dev: "개발", reading: "독서" }), pages }, "top", { tool: "claude", scope: "", childIds: [...picked.map((p) => p.id), "남의-페이지"], query: "source=groupby" }, L, NOW, new Map());
  assert.ok(r);
  assert.equal(r?.run.refKeys.length, picked.length + 1, "거른 것 + 이 페이지만(모르는 id 는 뺀다)");
  assert.match(r?.markdown ?? "", /거른 하위만: source=groupby · 6\/12/);
  assert.doesNotMatch(r?.markdown ?? "", /inthiswork/);
});
