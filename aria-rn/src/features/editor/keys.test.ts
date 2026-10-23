/// <reference types="node" />
/**
 * 단축키 조합(keys.ts) — Windows · Linux 쪽(Node 에는 navigator 가 없어 Lexical 의 IS_APPLE 이 false). Mac 쪽은 브라우저에서 확인한다.
 * 실행: npm run test:editor
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { comboLabel, isCombo, TURN_INTO } from "./keys";

const key = (init: KeyboardEventInit & { code?: string; key?: string }) =>
  ({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, isComposing: false, code: "", key: "", ...init }) as unknown as KeyboardEvent;

test("mod 는 Ctrl — Meta(Windows 키)는 아니다", () => {
  assert.equal(isCombo(key({ ctrlKey: true, code: "KeyD", key: "d" }), "KeyD", { mod: true }), true);
  assert.equal(isCombo(key({ metaKey: true, code: "KeyD", key: "d" }), "KeyD", { mod: true }), false);
  assert.equal(isCombo(key({ ctrlKey: true, shiftKey: true, code: "KeyD", key: "D" }), "KeyD", { mod: true }), false);
});

test("한글 입력 중에도 자리(code)로 걸린다 — key 가 ㅇ 이어도 Ctrl+D", () => {
  assert.equal(isCombo(key({ ctrlKey: true, code: "KeyD", key: "ㅇ" }), "KeyD", { mod: true }), true);
  assert.equal(isCombo(key({ ctrlKey: true, code: "KeyB", key: "ㅠ" }), "KeyB", { mod: true }), true);
});

test("code 가 빈 이벤트는 key 로 맞춰 본다", () => {
  assert.equal(isCombo(key({ ctrlKey: true, key: "D" }), "KeyD", { mod: true }), true);
  assert.equal(isCombo(key({ key: "ArrowUp" }), "ArrowUp"), true);
});

test("블록 바꾸기는 Windows 에서 Ctrl+Shift+숫자(Notion)", () => {
  assert.deepEqual(TURN_INTO, { mod: true, shift: true });
  assert.equal(isCombo(key({ ctrlKey: true, shiftKey: true, code: "Digit1", key: "!" }), "Digit1", TURN_INTO), true);
  assert.equal(isCombo(key({ ctrlKey: true, altKey: true, code: "Digit1", key: "1" }), "Digit1", TURN_INTO), false);
});

test("단축키 표시 — Ctrl+Shift+K", () => {
  assert.equal(comboLabel({ mod: true, shift: true }, "K"), "Ctrl+Shift+K");
  assert.equal(comboLabel({ mod: true }, "B"), "Ctrl+B");
});
