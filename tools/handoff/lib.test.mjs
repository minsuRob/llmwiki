// node --test tools/handoff/*.test.mjs — 실행 본문(lib.mjs)을 가짜 CLI · 가짜 ssh 로 시험한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HandoffError, runHandoff, withRunHead } from './lib.mjs';
import { createOracle } from './oracle.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-cli.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'llmwiki-lib-'));
const bundle = join(dir, 'b-ai.md');
writeFileSync(bundle, '# 묶음\n\n```llmwiki-result\n{"run":"mabc12-xyz"}\n```\n');
const env = (mode) => ({ ...process.env, FAKE_MODE: mode });
const fails = (code) => (e) => e instanceof HandoffError && e.code === code;

test('claude — 답 · 모델을 읽고 머리줄을 붙인다', async () => {
  const r = await runHandoff({ executor: 'claude', bundlePath: bundle, bin: FAKE, env: env('ok'), stderr: 'pipe' });
  assert.match(r.text, /^<!-- llmwiki-run \{"executor":"claude","model":"fake-model-1","latencyMs":\d+\} -->\n/);
  assert.match(r.text, /"run":"mabc12-xyz"/);
  assert.equal(r.model, 'fake-model-1');
});

test('codex — JSONL 이벤트에서 마지막 답을 찾는다', async () => {
  const r = await runHandoff({ executor: 'codex', bundlePath: bundle, bin: FAKE, env: env('codex'), stderr: 'pipe' });
  assert.match(r.text, /^<!-- llmwiki-run \{"executor":"codex","latencyMs":\d+\} -->/);
  assert.match(r.text, /llmwiki-result/);
});

test('머리줄 — 없으면 붙이고 있으면 그대로', () => {
  const t = withRunHead('답', { executor: 'gemma', model: 'm', latencyMs: 5 });
  assert.equal(t, '<!-- llmwiki-run {"executor":"gemma","model":"m","latencyMs":5} -->\n답');
  assert.equal(withRunHead(t, { executor: 'claude', latencyMs: 9 }), t);
});

test('실패 · 시간 제한 · 취소 · 출력 상한 · 빈 답 · 없는 실행 파일', async () => {
  const base = { executor: 'claude', bundlePath: bundle, bin: FAKE, stderr: 'pipe' };
  await assert.rejects(runHandoff({ ...base, env: env('fail') }), (e) => fails('exec_failed')(e) && /가짜 실패/.test(e.stderrTail));
  await assert.rejects(runHandoff({ ...base, env: env('sleep'), timeoutMs: 300 }), fails('timeout'));
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 200);
  await assert.rejects(runHandoff({ ...base, env: env('sleep'), signal: ac.signal }), fails('cancelled'));
  await assert.rejects(runHandoff({ ...base, env: env('huge') }), fails('exec_failed'));
  await assert.rejects(runHandoff({ ...base, env: env('empty') }), fails('no_result'));
  await assert.rejects(runHandoff({ ...base, bin: join(dir, 'no-such-cli') }), fails('unavailable'));
  await assert.rejects(runHandoff({ executor: 'grok', bundlePath: bundle }), fails('unavailable'));
});

/** 가짜 서버 — jobd 명령마다 정해 둔 응답 */
function fakeServer({ steps = ['running', 'done'], output = '답\n```llmwiki-result\n{}\n```', failRc = 1, upload = true } = {}) {
  const calls = [];
  let i = 0;
  const run = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'scp') return upload ? { ok: true, stdout: '', stderr: '' } : { ok: false, stdout: '', stderr: 'Permission denied' };
    const sub = args[args.indexOf('~/lwe/jobd/jobd.py') + 1];
    const reply = (o) => ({ ok: true, stdout: typeof o === 'string' ? o : JSON.stringify(o), stderr: '' });
    if (sub === 'submit') return reply({ id: '1020-120000-abcd', jobs_ahead: 1 });
    if (sub === 'status' && args.length > args.indexOf('status') + 1) return reply({ status: steps[Math.min(i++, steps.length - 1)] });
    if (sub === 'status') return reply({ queue: [{}], running: [{ id: '1020-110000-0000' }], done: [], gemma_up: true });
    if (sub === 'output') return reply(output);
    if (sub === 'result') return reply({ job: { steps: [{ rc: failRc }] }, log_tail: ['끝'] });
    if (sub === 'cancel') return reply({ cancelled: '1020-120000-abcd' });
    return { ok: false, stdout: '', stderr: 'unknown' };
  };
  return { oracle: createOracle({ run, host: 'fake' }), calls };
}
const fast = (oracle) => ({ ...oracle, runGemma: (p, o) => oracle.runGemma(p, { ...o, everyMs: 5 }) });

test('gemma — 올리고 · 넣고 · 기다려 받는다, 작업 id 를 바로 알린다', async () => {
  const { oracle, calls } = fakeServer();
  const seen = [];
  let submitted = null;
  const r = await runHandoff({ executor: 'gemma', bundlePath: bundle, oracle: fast(oracle), onProgress: (s) => seen.push(s.status), onSubmitted: (id) => { submitted = id; } });
  assert.equal(r.jobId, '1020-120000-abcd');
  assert.equal(submitted, '1020-120000-abcd');
  assert.match(r.text, /^<!-- llmwiki-run \{"executor":"gemma","model":"gemma-4-E4B/);
  assert.deepEqual(seen, ['queued', 'running', 'done']);
  assert.ok(calls.every((c) => !c.startsWith('ssh') || c.includes('BatchMode=yes')), '비밀번호 묻기로 멈추지 않게');
  assert.ok(calls.some((c) => c.includes('submit handoff_gemma --input')));
});

test('gemma — 실패 · 너무 김 · 업로드 실패 · 취소 · 이어 받기', async () => {
  await assert.rejects(runHandoff({ executor: 'gemma', bundlePath: bundle, oracle: fast(fakeServer({ steps: ['failed'] }).oracle) }), fails('exec_failed'));
  await assert.rejects(runHandoff({ executor: 'gemma', bundlePath: bundle, oracle: fast(fakeServer({ steps: ['failed'], failRc: 3 }).oracle) }), (e) => fails('too_long_for_gemma')(e) && e.jobId === '1020-120000-abcd');
  await assert.rejects(runHandoff({ executor: 'gemma', bundlePath: bundle, oracle: fast(fakeServer({ upload: false }).oracle) }), fails('unavailable'));
  const s = fakeServer({ steps: ['running'] });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 30);
  await assert.rejects(runHandoff({ executor: 'gemma', bundlePath: bundle, oracle: fast(s.oracle), signal: ac.signal }), fails('cancelled'));
  assert.ok(s.calls.some((c) => c.endsWith('cancel 1020-120000-abcd')), '서버 작업도 취소한다');
  const resume = fakeServer();
  const r = await runHandoff({ executor: 'gemma', bundlePath: bundle, oracle: fast(resume.oracle), resumeId: '1020-120000-abcd' });
  assert.equal(r.jobId, '1020-120000-abcd');
  assert.ok(!resume.calls.some((c) => c.startsWith('scp')), '이어 받을 때는 다시 올리지 않는다');
});

test('gemma 대기열 요약', async () => {
  assert.deepEqual(await fakeServer().oracle.queueStatus(), { reachable: true, queue: 1, running: '1020-110000-0000', gemma: 'on' });
  const down = createOracle({ run: async () => ({ ok: false, stdout: '', stderr: 'timeout' }) });
  assert.deepEqual(await down.queueStatus(), { reachable: false });
});
