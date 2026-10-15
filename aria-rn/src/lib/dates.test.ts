import { test } from "node:test";
import assert from "node:assert/strict";

import { formatWhen, isOverdue, parseKoreanWhen } from "./dates.ts";

// 2026-10-15 (목) 10:00
const NOW = new Date(2026, 9, 15, 10, 0);
const when = (s: string) => parseKoreanWhen(s, NOW)?.value ?? null;

test("상대 날짜", () => {
  assert.equal(when("오늘 장보기"), "2026-10-15");
  assert.equal(when("내일 보고서 쓰기"), "2026-10-16");
  assert.equal(when("모레 병원"), "2026-10-17");
  assert.equal(when("3일 후 택배"), "2026-10-18");
});

test("요일 — 월요일 시작 주", () => {
  assert.equal(when("금요일까지 견적"), "2026-10-16");
  assert.equal(when("월요일 회의"), "2026-10-19"); // 이번 주 월요일은 지났다 → 다음 주
  assert.equal(when("다음 주 화요일 약속"), "2026-10-20");
  assert.equal(when("이번 주 일요일"), "2026-10-18");
});

test("달력 날짜", () => {
  assert.equal(when("10월 20일 생일"), "2026-10-20");
  assert.equal(when("11/3 마감"), "2026-11-03");
  assert.equal(when("25일 월세"), "2026-10-25");
  assert.equal(when("3일 월세"), "2026-11-03"); // 이번 달 3일은 지났다
});

test("시각", () => {
  assert.equal(when("내일 오후 3시 회의"), "2026-10-16T15:00");
  assert.equal(when("내일 3시 반 미팅"), "2026-10-16T15:30");
  assert.equal(when("금요일 오전 9시 20분"), "2026-10-16T09:20");
  assert.equal(when("저녁 7시 약속"), "2026-10-15T19:00");
  assert.equal(when("8시 운동"), "2026-10-16T08:00"); // 오늘 8시는 지났다 → 내일
  assert.equal(when("14:30 통화"), "2026-10-15T14:30");
});

test("날짜 · 시각이 없으면 null", () => {
  assert.equal(when("우유 사기"), null);
});

test("표시 · 기한 지남", () => {
  assert.equal(formatWhen("2026-10-16T15:00", NOW), "내일 오후 3시");
  assert.equal(formatWhen("2026-10-20", NOW), "10/20(화)");
  assert.equal(isOverdue("2026-10-14", NOW), true);
  assert.equal(isOverdue("2026-10-15T08:00", NOW), false); // 오늘 것은 지남이 아니다
});
