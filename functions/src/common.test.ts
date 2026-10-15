import { test } from "node:test";
import assert from "node:assert/strict";

import { wallClock } from "./common.ts";

test("벽시계 — 날짜 계산은 사용자 시각, 저장 시각은 실제 순간", () => {
  const at = new Date("2026-10-15T15:30:00.000Z"); // 서울 10/16 00:30
  const { now } = wallClock("Asia/Seoul", at);
  assert.equal(now.getDate(), new Date(2026, 9, 16).getDate());
  assert.equal(now.getHours(), 0);
  assert.equal(now.toISOString(), at.toISOString());
  assert.equal(JSON.stringify({ t: now }), JSON.stringify({ t: at }));
});
