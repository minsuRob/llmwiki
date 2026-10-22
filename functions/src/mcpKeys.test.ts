import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanLabel, hashSecret, newMcpKey, parseMcpKey, verifyMcpSecret } from "./mcpKeys.ts";

test("MCP 열쇠 — 만들면 lwk_<id>.<secret>, 서버엔 해시만, 맞는 secret 만 통과", () => {
  const k = newMcpKey();
  assert.match(k.key, /^lwk_[0-9a-z]{12}\.[A-Za-z0-9_-]{43}$/);
  const p = parseMcpKey(`Bearer ${k.key}`);
  assert.ok(p);
  if (!p) return;
  assert.equal(p.id, k.id);
  assert.equal(k.hash, hashSecret(p.secret));
  assert.equal(k.key.includes(k.hash), false, "열쇠에 해시가 들어 있지 않다");
  assert.equal(verifyMcpSecret({ hash: k.hash }, p.secret), true);
  assert.equal(verifyMcpSecret({ hash: k.hash }, p.secret.replace(/.$/, (c) => (c === "A" ? "B" : "A"))), false);
  assert.notEqual(newMcpKey().id, k.id);
});

test("MCP 열쇠 — 모양이 틀리면 거른다", () => {
  for (const bad of ["", "lwk_", "lwk_abc.def", "xyz_aaaaaaaaaaaa." + "a".repeat(43), "lwk_AAAAAAAAAAAA." + "a".repeat(43), "lwk_aaaaaaaaaaaa." + "a".repeat(42), "lwk_aaaaaaaaaaaa." + "a".repeat(43) + ".x", null, undefined])
    assert.equal(parseMcpKey(bad), null, String(bad));
  assert.equal(cleanLabel("  내  맥북\n프로 "), "내 맥북 프로");
  assert.equal(cleanLabel(""), "MCP");
  assert.equal(cleanLabel("x".repeat(80)).length, 40);
});
