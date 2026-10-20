import { test } from 'node:test';
import assert from 'node:assert/strict';

import { confirmBox } from '../src/confirm.mjs';
import { bundleSummary, validateRunRequest } from '../src/validate.mjs';

const ok = { runId: 'mgz1abcd-k3j2h1', itemId: 'mgz0aaaa-x1y2', executor: 'claude', bundleMarkdown: '# 업무\n\nS1:1| 내용' };

test('T6 입력 검증 — 실행자 · id · 크기 · 모델', () => {
  assert.deepEqual(validateRunRequest(ok), { ok: true, value: ok });
  for (const executor of ['bash', 'claude;rm -rf /', '', 'grok', null, 'Claude']) assert.deepEqual(validateRunRequest({ ...ok, executor }), { ok: false, code: 'invalid_input' }, String(executor));
  for (const runId of ['', '../../etc', 'ABC-def', 'a-b', `${'a'.repeat(15)}-x`, 7]) assert.equal(validateRunRequest({ ...ok, runId }).code, 'invalid_input', String(runId));
  assert.equal(validateRunRequest({ ...ok, itemId: '../x' }).code, 'invalid_input');
  assert.equal(validateRunRequest({ ...ok, bundleMarkdown: '   ' }).code, 'invalid_input');
  assert.equal(validateRunRequest({ ...ok, bundleMarkdown: 'a\0b' }).code, 'invalid_input');
  assert.equal(validateRunRequest({ ...ok, bundleMarkdown: 'x'.repeat(200_001) }).code, 'too_large');
  assert.equal(validateRunRequest({ ...ok, bundleMarkdown: '가'.repeat(70_000) }).code, 'too_large', '바이트로 센다');
  assert.equal(validateRunRequest({ ...ok, executor: 'gemma', bundleMarkdown: 'x'.repeat(20_001) }).code, 'too_long_for_gemma');
  assert.equal(validateRunRequest({ ...ok, model: 'opus' }).value.model, 'opus');
  assert.equal(validateRunRequest({ ...ok, model: '--dangerously-skip-permissions' }).value.model, undefined, '목록 밖 모델은 버린다');
  assert.equal(validateRunRequest(null).code, 'invalid_input');
});

test('확인 창 — 받는 곳 · 크기 · 자료 수, 기본은 취소', () => {
  assert.deepEqual(bundleSummary('# 업무: 지원 정리\n> meta\n\nS1:1| a\nS1:2| b\nS2:1| c\n'), { title: '업무: 지원 정리', chars: 44, sources: 2 });
  const b = confirmBox({ ...ok, executor: 'gemma' });
  assert.equal(b.buttons[b.defaultId], '취소');
  assert.equal(b.cancelId, 1);
  assert.match(b.detail, /오라클 서버/);
  assert.match(confirmBox(ok).detail, /Anthropic/);
});
