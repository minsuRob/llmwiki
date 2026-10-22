/**
 * 줄 단위 비교 — 본문 제안 비교 화면.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { diffLines, diffStats } from "./textDiff.ts";

test("줄 비교 — 같은 줄 · 지운 줄 · 더한 줄, 아주 큰 본문도 멈추지 않는다", () => {
  const d = diffLines("a\nb\nc\nd", "a\nc\nx\nd");
  assert.deepEqual(d.map((x) => `${x.op[0]}${x.text}`), ["sa", "db", "sc", "ax", "sd"]);
  assert.deepEqual(diffStats(d), { added: 1, removed: 1 });
  const big = Array.from({ length: 3000 }, (_, i) => `줄 ${i}`).join("\n");
  const big2 = Array.from({ length: 3000 }, (_, i) => `새 줄 ${i}`).join("\n");
  const t = Date.now();
  const d2 = diffLines(`머리\n${big}\n꼬리`, `머리\n${big2}\n꼬리`);
  assert.ok(Date.now() - t < 2000);
  assert.deepEqual(diffStats(d2), { added: 3000, removed: 3000 });
  assert.equal(d2[0].op, "same");
  assert.equal(d2.at(-1)?.text, "꼬리");
});
