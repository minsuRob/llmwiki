import { test } from "node:test";
import assert from "node:assert/strict";

import { closeCard, findCard, finishTurn, newLedger, resolveOverdue, resolveSuggest, runTool, tasksInScope, undoChanges } from "./engine.ts";
import { planLocal, runLocalTurn } from "./local.ts";
import type { AppState, ChatMessage } from "./types.ts";

const NOW = new Date(2026, 9, 15, 10, 0); // 목
const empty = (): AppState => ({ tasks: [], events: [], scraps: [], messages: [] });

/** 턴 결과를 대화에 붙인다(앱의 store 가 하는 일) */
function withTurn(state: AppState, text: string, cards: ChatMessage["cards"]): AppState {
  const msg: ChatMessage = { id: `m${state.messages.length}`, role: "assistant", text, cards, createdAt: NOW.toISOString() };
  return { ...state, messages: [...state.messages, msg] };
}

test("add_task 는 같은 열린 할일을 두 번 만들지 않는다", () => {
  const ledger = newLedger();
  let s = runTool(empty(), "add_task", { title: "보고서 쓰기", due: "2026-10-16" }, ledger, NOW).state;
  const again = runTool(s, "add_task", { title: " 보고서  쓰기 " }, ledger, NOW);
  assert.match(again.output, /^Already exists/);
  s = again.state;
  assert.equal(s.tasks.length, 1);
  assert.equal(ledger.createdTaskIds.length, 1);
});

test("턴 끝 changes 카드 → 되돌리기: 만든 건 지우고, 끝낸 건 다시 열고, 그 사이 완료한 건 남긴다", () => {
  let s = empty();
  const l1 = newLedger();
  s = runTool(s, "add_task", { title: "우유 사기" }, l1, NOW).state;
  const old = s.tasks[0].id;
  s = withTurn(s, "", finishTurn(l1));

  const l2 = newLedger();
  s = runTool(s, "add_task", { title: "택배 보내기" }, l2, NOW).state;
  s = runTool(s, "add_task", { title: "화분 물 주기" }, l2, NOW).state;
  s = runTool(s, "complete_task", { task: "우유" }, l2, NOW).state; // 제목 일부로 찾는다
  const cards = finishTurn(l2);
  assert.equal(cards[0].kind, "changes");
  s = withTurn(s, "", cards);

  // 사용자가 '화분 물 주기' 는 그 사이 직접 끝냈다
  const plant = s.tasks.find((t) => t.title === "화분 물 주기")!;
  s = { ...s, tasks: s.tasks.map((t) => (t.id === plant.id ? { ...t, done: true } : t)) };

  s = undoChanges(s, cards[0].id, NOW);
  const byTitle = (x: string) => s.tasks.find((t) => t.title === x)!;
  assert.ok(byTitle("택배 보내기").deletedAt, "만든 할일은 휴지통으로");
  assert.equal(byTitle("화분 물 주기").deletedAt ?? null, null, "그 사이 완료한 할일은 남긴다");
  assert.equal(s.tasks.find((t) => t.id === old)!.done, false, "끝낸 할일은 다시 연다");
  const card = findCard(s, cards[0].id);
  assert.ok(card && card.kind === "changes" && card.undone);
  // 두 번 되돌려도 그대로
  assert.deepEqual(undoChanges(s, cards[0].id, NOW), s);
});

test("기한 지난 할일 카드 — 완료 · 오늘로(시각 유지) · 삭제, 다 하면 닫힌다", () => {
  let s = empty();
  const l = newLedger();
  s = runTool(s, "add_task", { title: "견적서", due: "2026-10-13" }, l, NOW).state;
  s = runTool(s, "add_task", { title: "거래처 전화", due: "2026-10-14T10:00" }, l, NOW).state;
  s = runTool(s, "add_task", { title: "회의록", due: "2026-10-12" }, l, NOW).state;
  s = runTool(s, "add_task", { title: "오늘 일", due: "2026-10-15" }, l, NOW).state;
  const l2 = newLedger();
  const out = runTool(s, "propose_overdue", {}, l2, NOW);
  assert.match(out.output, /3 rows/);
  s = withTurn(out.state, "", finishTurn(l2));
  const card = l2.cards[0];
  assert.equal(card.kind, "overdue");
  if (card.kind !== "overdue") return;
  const id = (title: string) => s.tasks.find((t) => t.title === title)!.id;

  s = resolveOverdue(s, card.id, id("견적서"), "complete", NOW);
  s = resolveOverdue(s, card.id, id("거래처 전화"), "today", NOW);
  assert.equal(s.tasks.find((t) => t.title === "거래처 전화")!.due, "2026-10-15T10:00");
  s = resolveOverdue(s, card.id, id("회의록"), "delete", NOW);
  const after = findCard(s, card.id);
  assert.ok(after && after.kind === "overdue" && after.closed);
  assert.deepEqual(tasksInScope(s, "overdue", NOW), []);
});

test("제안 카드 — 누르기 전엔 할일이 없고, 추가하면 생긴다", () => {
  let s = empty();
  const l = newLedger();
  const out = runTool(s, "propose_tasks", { items: [{ title: "발표 자료", due: "2026-10-17" }, { title: "치과 예약" }, { title: "발표 자료" }], note: "다음 주 바쁨" }, l, NOW);
  assert.equal(out.state.tasks.length, 0);
  s = withTurn(out.state, "", finishTurn(l));
  const card = l.cards[0];
  assert.ok(card.kind === "suggest" && card.rows.length === 2, "같은 제목은 하나만");
  s = resolveSuggest(s, card.id, 0, "add", NOW);
  s = resolveSuggest(s, card.id, 1, "skip", NOW);
  assert.deepEqual(s.tasks.map((t) => [t.title, t.due]), [["발표 자료", "2026-10-17"]]);
  const after = findCard(s, card.id);
  assert.ok(after && after.kind === "suggest" && after.closed);
  assert.deepEqual(closeCard(s, card.id), s);
});

test("기기 안 길 — 문장 → 도구 호출", () => {
  assert.deepEqual(planLocal("내일 오후 3시 팀 회의", NOW).calls, [{ name: "add_event", input: { title: "팀 회의", start: "2026-10-16T15:00" } }]);
  assert.deepEqual(planLocal("금요일까지 견적서 보내기", NOW).calls, [{ name: "add_task", input: { title: "견적서 보내기", due: "2026-10-16" } }]);
  assert.deepEqual(planLocal("우유 사기 추가해줘", NOW).calls, [{ name: "add_task", input: { title: "우유 사기", due: undefined } }]);
  assert.deepEqual(planLocal("오늘 할 일 보여줘", NOW).calls, [{ name: "show_tasks", input: { scope: "today" } }]);
  assert.deepEqual(planLocal("밀린 할일 정리해줘", NOW).calls, [{ name: "propose_overdue", input: {} }]);
  assert.deepEqual(planLocal("보고서 다 했어", NOW).calls, [{ name: "complete_task", input: { task: "보고서" } }]);
  assert.deepEqual(planLocal("메모: 다음 분기엔 채용을 늘리기로 했다", NOW).calls, [{ name: "add_scrap", input: { text: "다음 분기엔 채용을 늘리기로 했다", label: "결정" } }]);
  const dump = planLocal("이번 주 할 거\n- 발표 자료 만들기 목요일\n- 치과 예약\n- 엄마 생신 선물 20일까지", NOW).calls;
  assert.equal(dump[0].name, "propose_tasks");
  assert.deepEqual((dump[0].input.items as { title: string }[]).map((i) => i.title), ["발표 자료 만들기", "치과 예약", "엄마 생신 선물"]);
  assert.deepEqual(planLocal("헬스장 등록", NOW).calls, [{ name: "add_task", input: { title: "헬스장 등록", due: undefined } }]);
  assert.equal(planLocal("방금 거 취소해", NOW).undoLast, true);
  assert.deepEqual(planLocal("10월 13일 회의록 정리", NOW).calls, [{ name: "add_task", input: { title: "회의록 정리", due: "2026-10-13" } }]);
});

test("기기 안 길도 같은 카드를 만든다", () => {
  const turn = runLocalTurn(empty(), "내일 보고서 쓰기, 우유 사기", NOW);
  assert.equal(turn.state.tasks.length, 2);
  assert.equal(turn.cards[0].kind, "changes");
  assert.match(turn.text, /할일 2개를 추가했어요/);
});
