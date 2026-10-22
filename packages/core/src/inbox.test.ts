/** 받은 것(인박스) — 던지고, Claude 가 제안하고, 사람이 엮는다. 규칙: work.ts "받은 것" 절 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createPage, newDoc, type PageDoc, type PageMeta } from "./pages.ts";
import {
  acceptTriage,
  defaultManifest,
  dismissSource,
  fileSource,
  fragmentState,
  inboxSources,
  mergeTriage,
  moveSource,
  newSource,
  openTriage,
  proposeTriage,
  rejectTriage,
  restoreSource,
  sourceTriage,
  upgradeManifest,
  type Source,
  type TriageState,
} from "./work.ts";

const NOW = "2026-10-22T09:00:00.000Z";
const LATER = "2026-10-22T10:00:00.000Z";

type World = TriageState & { a: Source; b: Source; c: Source; items: PageMeta[]; docs: Map<string, PageDoc> };

function setup(): World {
  const manifest = defaultManifest({ personal: "개인", company: "회사", dev: "개발", reading: "독서" });
  const p1 = createPage([], { workspaceId: "ws-personal", title: "그룹바이 지원 후보 정리" }, NOW);
  if (p1.kind !== "ok") throw new Error();
  const p2 = createPage(p1.pages, { workspaceId: "ws-company", title: "10월 실적 보고" }, NOW);
  if (p2.kind !== "ok") throw new Error();
  const item = p1.page;
  const company = p2.page;
  const a = newSource({ workspaceId: "ws-personal", provider: "paste", title: "피트인은 2027년 1월 부평구로 이전", text: "피트인은 2027년 1월 부평구로 이전 예정\n출퇴근 40분", triage: "inbox", origin: { via: "mcp", tool: "claude" } }, NOW);
  const b = newSource({ workspaceId: "ws-personal", provider: "link", title: "https://example.com/job/13289", url: "https://example.com/job/13289", triage: "inbox", origin: { via: "app" } }, LATER);
  const c = newSource({ workspaceId: "ws-company", provider: "note", title: "회사 메모", text: "회사 메모", triage: "inbox" }, NOW);
  return { manifest, pages: p2.pages, items: [item, company], docs: new Map([[item.id, p1.doc], [company.id, p2.doc]]), sources: [a, b, c], a, b, c };
}

test("기본 범주는 개인 · 회사 · 개발 · 독서 넷이고 회사만 비공개, 영역은 없다", () => {
  const m = defaultManifest({ personal: "개인", company: "회사", dev: "개발", reading: "독서" });
  assert.deepEqual(m.workspaces.map((w) => [w.name, w.private]), [["개인", false], ["회사", true], ["개발", false], ["독서", false]]);
  assert.equal(m.workspaces.some((w) => "areas" in w), false);
  assert.deepEqual(m.triage, []);
});

test("던진 조각은 정리 대기로 — 범주별 · 최신 위, 출처가 남는다. 옛 자료(값 없음)는 엮인 것으로 본다", () => {
  const st = setup();
  assert.deepEqual(inboxSources(st, "ws-personal").map((s) => s.id), [st.b.id, st.a.id]);
  assert.deepEqual(inboxSources(st, "ws-company").map((s) => s.id), [st.c.id]);
  assert.deepEqual(st.a.origin, { via: "mcp", tool: "claude" });
  const old = newSource({ workspaceId: "ws-personal", provider: "note", title: "옛 메모", text: "옛 메모" }, NOW);
  assert.equal(old.triage, undefined);
  assert.equal(sourceTriage(old), "filed");
});

test("정리 제안 — 범주를 넘지 않고, 없는 조각 · 페이지 · 빈 칸 · 같은 제안은 들이지 않고, 근거 없으면 표시한다", () => {
  const st = setup();
  const [item, company] = st.items;
  const r = proposeTriage(
    st,
    [
      { kind: "file_source", sourceIds: [st.a.id], itemId: item.id, note: "지원 후보의 근무지 정보", refs: ["S1:1"] },
      { kind: "new_page", sourceIds: [st.b.id], title: "13289 공고 검토" },
      { kind: "concept_link", sourceIds: [st.a.id], concept: "부평구", refs: ["S1:1"] },
      { kind: "file_source", sourceIds: [st.a.id], itemId: company.id, refs: ["S1:1"] },
      { kind: "new_page", sourceIds: [st.a.id, st.c.id], title: "섞기" },
      { kind: "file_source", sourceIds: ["없음"], itemId: item.id },
      { kind: "file_source", sourceIds: [st.a.id], itemId: "없는 페이지" },
      { kind: "new_page", sourceIds: [st.b.id], title: "  " },
      { kind: "concept_link", sourceIds: [] , concept: "x" },
      { kind: "file_source", sourceIds: [st.a.id], itemId: item.id, refs: ["S1:2"] },
      { kind: "new_page", sourceIds: [st.a.id], title: "다른 범주 아래", parentId: company.id, refs: ["S1:1"] },
      { kind: "new_work", sourceIds: [st.a.id], title: "옛 형식", goal: "목표는 메모로", refs: ["S1:1"] },
    ],
    NOW,
    { runId: "run-1", tool: "claude" },
  );
  assert.equal(r.added.length, 4);
  assert.deepEqual(
    r.skipped.map((x) => [x.index, x.reason]),
    [
      [3, "cross_workspace"],
      [4, "cross_workspace"],
      [5, "unknown_source"],
      [6, "unknown_item"],
      [7, "missing_field"],
      [8, "no_source"],
      [9, "duplicate"],
      [10, "cross_workspace"],
    ],
  );
  assert.deepEqual([r.added[3].kind, r.added[3].note], ["new_page", "목표는 메모로"], "옛 new_work 는 new_page 로, 목표는 메모로");
  assert.deepEqual(r.added[1].flags, ["no_evidence"], "근거 없는 제안은 들이되 표시한다");
  assert.equal(r.added[0].flags, undefined);
  assert.ok(r.added.every((p) => p.status === "open" && p.workspaceId === "ws-personal" && p.runId === "run-1" && p.tool === "claude"));

  // 이미 열린 제안은 다시 들이지 않는다
  const again = proposeTriage({ ...st, manifest: r.manifest }, [{ kind: "concept_link", sourceIds: [st.a.id], concept: " 부평구 " }], LATER);
  assert.deepEqual(again.skipped, [{ index: 0, reason: "duplicate" }]);

  const next = { ...st, manifest: r.manifest };
  assert.equal(openTriage(r.manifest, "ws-personal").length, 4);
  assert.equal(openTriage(r.manifest, "ws-company").length, 0);
  assert.equal(fragmentState(st.a, r.manifest), "proposed");
  assert.equal(fragmentState(st.c, next.manifest), "waiting");
});

test("받아들이기 — 페이지에 잇기 · 새 페이지(부모 아래) · 개념. 조각은 엮임이 되고, 제안은 판단 기록으로 남는다", () => {
  const st = setup();
  const [item] = st.items;
  const r = proposeTriage(
    st,
    [
      { kind: "file_source", sourceIds: [st.a.id], itemId: item.id, refs: ["S1:1"] },
      { kind: "new_page", sourceIds: [st.b.id], title: "13289 공고 검토", parentId: item.id, refs: ["S2:1"] },
      { kind: "concept_link", sourceIds: [st.a.id], concept: "부평구", refs: ["S1:1"] },
    ],
    NOW,
  );
  let state: TriageState = { manifest: r.manifest, pages: st.pages, sources: st.sources };
  const docs = st.docs;
  const apply = (x: ReturnType<typeof acceptTriage>) => {
    assert.equal(x.kind, "ok");
    if (x.kind !== "ok") return;
    if (x.doc) docs.set(x.doc.id, x.doc);
    const sources = new Map(state.sources.map((s) => [s.id, s]));
    for (const s of x.sources) sources.set(s.id, s);
    state = { manifest: x.manifest, pages: x.pages ?? state.pages, sources: [...sources.values()] };
  };

  // 페이지에 잇기 — 문서가 있어야 한다(묶음 속 페이지면 앱이 먼저 읽는다)
  assert.deepEqual(acceptTriage(state, r.added[0].id, LATER), { kind: "needs_doc", pageId: item.id });
  apply(acceptTriage(state, r.added[0].id, LATER, { doc: docs.get(item.id) }));
  assert.deepEqual(docs.get(item.id)?.sourceIds, [st.a.id]);
  assert.deepEqual(state.pages.find((p) => p.id === item.id)?.sourceIds, [st.a.id], "색인에도 사본");
  assert.equal(state.sources.find((s) => s.id === st.a.id)?.triage, "filed");

  // 새 페이지 — 사람이 제목을 고쳐서, 제안한 부모 아래
  const nw = acceptTriage(state, r.added[1].id, LATER, { title: "13289 지원 결정" });
  apply(nw);
  if (nw.kind !== "ok") return;
  const created = state.pages.find((p) => p.id === nw.createdPageId);
  assert.equal(created?.title, "13289 지원 결정");
  assert.equal(created?.parentId, item.id);
  assert.deepEqual(docs.get(created?.id ?? "")?.sourceIds, [st.b.id]);

  // 개념 — 같은 이름은 한 번만
  apply(acceptTriage(state, r.added[2].id, LATER));
  assert.deepEqual(state.sources.find((s) => s.id === st.a.id)?.concepts, ["부평구"]);

  assert.deepEqual(state.manifest.triage.map((p) => p.status), ["accepted", "accepted", "accepted"]);
  assert.ok(state.manifest.triage.every((p) => p.decidedAt === LATER));
  assert.deepEqual(acceptTriage(state, r.added[0].id, LATER, { doc: docs.get(item.id) }), { kind: "gone" }, "두 번 받지 않는다");
  assert.deepEqual(inboxSources(state, "ws-personal"), []);
});

test("[다른 곳] — 사람이 고른 페이지에 잇는다. 다른 범주면 확인을 거친다", () => {
  const st = setup();
  const [item, company] = st.items;
  const r = proposeTriage(st, [{ kind: "new_page", sourceIds: [st.a.id], title: "새 페이지", refs: ["S1:1"] }], NOW);
  const state = { ...st, manifest: r.manifest };
  assert.deepEqual(acceptTriage(state, r.added[0].id, LATER, { pageId: company.id }), { kind: "needs_confirm" });
  const ok = acceptTriage(state, r.added[0].id, LATER, { pageId: company.id, confirmCross: true, doc: st.docs.get(company.id) });
  assert.equal(ok.kind, "ok");
  const same = acceptTriage(state, r.added[0].id, LATER, { pageId: item.id, doc: st.docs.get(item.id) });
  assert.equal(same.kind, "ok");
  if (same.kind === "ok") {
    assert.equal(same.createdPageId, undefined, "다른 곳을 고르면 새 페이지를 만들지 않는다");
    assert.deepEqual(same.doc?.sourceIds, [st.a.id]);
  }
});

test("빼기 · 되돌리기 · 손으로 잇기 · 범주 옮기기", () => {
  const st = setup();
  const [item, company] = st.items;
  const r = proposeTriage(st, [{ kind: "file_source", sourceIds: [st.a.id], itemId: item.id, refs: ["S1:1"] }], NOW);

  // 제안을 빼면 조각은 정리 대기로 남는다
  const m2 = rejectTriage(r.manifest, r.added[0].id, LATER);
  assert.equal(m2.triage[0].status, "rejected");
  assert.equal(fragmentState(st.a, m2), "waiting");

  // 조각 빼기 · 되돌리기(지우지 않는다)
  const d = dismissSource(st.a, LATER);
  assert.equal(fragmentState(d, m2), "dismissed");
  assert.equal(restoreSource(d, LATER).triage, "inbox");

  // 손으로 잇기 — 같은 범주는 바로, 다른 범주는 확인. 묶음 속 페이지(rev 0 문서)도 같다
  const f = fileSource(item, newDoc(item.id, item.workspaceId, "", NOW), st.a, LATER);
  assert.equal(f.kind, "filed");
  if (f.kind === "filed") {
    assert.equal(f.source.triage, "filed");
    assert.ok(f.doc.sourceIds.includes(st.a.id));
    assert.deepEqual(f.meta.sourceIds, [st.a.id]);
  }
  assert.deepEqual(fileSource(company, newDoc(company.id, company.workspaceId, "", NOW), st.a, LATER), { kind: "needs_confirm" });

  // 잘못 던진 조각을 다른 범주로 — 그 조각에 걸린 열린 제안은 닫는다
  const mv = moveSource(r.manifest, st.a, "ws-dev", LATER);
  assert.equal(mv.source.workspaceId, "ws-dev");
  assert.equal(mv.manifest.triage[0].status, "rejected");
  assert.equal(moveSource(r.manifest, st.a, "ws-personal", LATER).manifest, r.manifest, "같은 범주면 그대로");
});

test("스키마 3 이행 — 열린 new_work 제안은 new_page 로(목표는 메모로), 정한 것은 그대로", () => {
  const fallback = defaultManifest({ personal: "개인", company: "회사", dev: "개발", reading: "독서" });
  const raw = {
    schemaVersion: 2,
    workspaces: fallback.workspaces,
    triage: [
      { id: "t1", kind: "new_work", status: "open", workspaceId: "ws-personal", sourceIds: ["s1"], title: "새 일", goal: "목표", createdAt: NOW },
      { id: "t2", kind: "new_work", status: "accepted", workspaceId: "ws-personal", sourceIds: ["s2"], title: "옛 일", goal: "목표2", createdAt: NOW, decidedAt: NOW },
    ],
  };
  const m = upgradeManifest(raw, fallback);
  assert.equal(m.schemaVersion, 3);
  assert.deepEqual([m.triage[0].kind, m.triage[0].note, m.triage[0].goal], ["new_page", "목표", undefined]);
  assert.equal(m.triage[1].kind, "new_work");
  assert.deepEqual(m.bodyProposals, []);
});

test("정한 제안은 최근 100개만 남기고 열린 제안은 모두 남긴다", () => {
  const st = setup();
  let manifest = st.manifest;
  for (let i = 0; i < 105; i++) {
    const r = proposeTriage({ ...st, manifest }, [{ kind: "concept_link", sourceIds: [st.a.id], concept: `개념${i}`, refs: ["S1:1"] }], NOW);
    manifest = rejectTriage(r.manifest, r.added[0].id, `2026-10-22T09:${String(i % 60).padStart(2, "0")}:${String(Math.floor(i / 60)).padStart(2, "0")}.000Z`);
  }
  const open = proposeTriage({ ...st, manifest }, [{ kind: "concept_link", sourceIds: [st.a.id], concept: "열린 것", refs: ["S1:1"] }], NOW);
  assert.equal(open.manifest.triage.filter((p) => p.status !== "open").length, 100);
  assert.equal(open.manifest.triage.filter((p) => p.status === "open").length, 1);
});

test("정리 제안 합치기 — 상대가 더한 것은 남기고, 같은 제안은 정한 쪽이 이긴다", () => {
  const st = setup();
  const [item] = st.items;
  const base = proposeTriage(st, [{ kind: "file_source", sourceIds: [st.a.id], itemId: item.id, refs: ["S1:1"] }], NOW).manifest;
  // 상대(MCP)는 제안 하나를 더하고, 나(앱)는 첫 제안을 뺐다
  const theirs = proposeTriage({ ...st, manifest: base }, [{ kind: "concept_link", sourceIds: [st.a.id], concept: "부평구", refs: ["S1:1"] }], LATER).manifest;
  const mine = rejectTriage(base, base.triage[0].id, LATER);
  const merged = mergeTriage(theirs, mine);
  assert.equal(merged.triage.length, 2);
  assert.equal(merged.triage.find((p) => p.id === base.triage[0].id)?.status, "rejected");
  assert.equal(merged.triage.find((p) => p.concept === "부평구")?.status, "open");
  // 거꾸로 — 열린 내 것이 상대의 정한 것을 덮지 않는다
  assert.equal(mergeTriage(mine, base).triage[0].status, "rejected");
});
