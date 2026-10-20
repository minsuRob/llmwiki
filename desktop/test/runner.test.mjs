import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runHandoff as realRun } from '../../tools/handoff/lib.mjs';
import { createLog } from '../src/log.mjs';
import { Runner } from '../src/runner.mjs';
import { FAKE_CLI, fakeOracle } from '../src/fakes.mjs';

const BUNDLE = '# 업무: 지원 정리\n> run: mgz1abcd-k3j2h1\n\nS1:1| 비밀 같은 내용 ya29.SECRET\n\n```llmwiki-result\n{"run":"mgz1abcd-k3j2h1"}\n```\n';
const req = (o = {}) => ({ runId: 'mgz1abcd-k3j2h1', itemId: 'mgz0aaaa-x1y2', executor: 'claude', bundleMarkdown: BUNDLE, ...o });

function setup({ confirm = async () => true, oracle = fakeOracle({ delayMs: 40 }), fakeMode } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-runner-'));
  const events = [];
  const logDir = join(root, 'logs');
  const runs = [];
  const r = new Runner({
    runHandoff: (o) => { runs.push(o); return realRun(o); },
    confirm,
    emit: (e) => events.push(e),
    dir: join(root, 'runs'),
    tmp: root,
    execOpts: (ex) => (ex === 'gemma' ? { oracle } : { bin: FAKE_CLI, env: { ...process.env, FAKE_MODE: fakeMode ?? (ex === 'codex' ? 'codex' : 'ok') } }),
    log: createLog(logDir),
  });
  const until = async (pred) => { for (let i = 0; i < 400 && !pred(); i++) await new Promise((res) => setTimeout(res, 10)); };
  return { r, root, events, logDir, runs, until };
}

test('T3 실행 → 결과 보관 → 이벤트 → ack 로 지움, 임시 묶음은 남지 않는다', async () => {
  const { r, root, events, until, runs } = setup();
  await r.init();
  assert.deepEqual(await r.run(req()), { accepted: true });
  await until(() => events.some((e) => e.type === 'done'));
  const done = events.find((e) => e.type === 'done');
  assert.match(done.result.text, /^<!-- llmwiki-run \{"executor":"claude"/);
  assert.equal(done.result.itemId, 'mgz0aaaa-x1y2');
  assert.equal(runs[0].mode, 'web', '데스크톱은 웹 조사 모드');
  assert.deepEqual(events.map((e) => e.type), ['confirming', 'running', 'done']);
  const pending = await r.pending();
  assert.equal(pending.length, 1);
  assert.equal((statSync(join(root, 'runs', 'mgz1abcd-k3j2h1.json')).mode & 0o777), 0o600);
  await r.ack('mgz1abcd-k3j2h1');
  assert.equal((await r.pending()).length, 0);
  assert.deepEqual(readdirSync(root).filter((n) => n.startsWith('llmwiki-')), [], '묶음 임시 폴더를 지운다');
});

test('T6 거절 · 동시 실행 · 잘못된 입력 — 프로세스를 띄우지 않는다', async () => {
  const declined = setup({ confirm: async () => false });
  await declined.r.init();
  assert.deepEqual(await declined.r.run(req()), { accepted: false, code: 'declined' });
  assert.equal(declined.runs.length, 0);
  assert.equal(declined.events.at(-1).code, 'declined');

  const s = setup({ fakeMode: 'sleep' });
  await s.r.init();
  assert.equal((await s.r.run(req())).accepted, true);
  assert.deepEqual(await s.r.run(req()), { accepted: true }, '같은 실행에 다시 붙는다');
  assert.deepEqual(await s.r.run(req({ runId: 'mgz1abcd-other1' })), { accepted: false, code: 'busy' }, '실행자당 하나');
  assert.equal((await s.r.run(req({ runId: 'mgz1abcd-other2', executor: 'codex' }))).accepted, true);
  assert.deepEqual(await s.r.run(req({ runId: 'mgz1abcd-other3', executor: 'gemma' })), { accepted: false, code: 'busy' }, '전체 둘');
  assert.deepEqual(await s.r.run(req({ executor: 'bash' })), { accepted: false, code: 'invalid_input' });
  await s.until(() => s.runs.length === 2);
  assert.equal(s.runs.length, 2);
  assert.ok(await s.r.cancel('mgz1abcd-k3j2h1'));
  assert.ok(await s.r.cancel('mgz1abcd-other2'));
  await s.until(() => s.events.filter((e) => e.type === 'cancelled').length === 2);
  assert.equal(s.r.running().length, 0);
});

test('T10 Gemma — 끊긴 뒤 다시 켜면 같은 작업을 이어 받는다', async () => {
  const oracle = fakeOracle({ delayMs: 60 });
  const a = setup({ oracle });
  await a.r.init();
  await a.r.run(req({ executor: 'gemma' }));
  await a.until(() => a.events.some((e) => e.type === 'queued' && e.jobId));
  const active = JSON.parse(readFileSync(join(a.root, 'runs', 'active.json'), 'utf8'));
  assert.equal(active[0].runId, 'mgz1abcd-k3j2h1');
  // 셸이 꺼졌다고 치고 같은 폴더로 새 Runner
  const b = new Runner({ runHandoff: realRun, confirm: async () => { throw new Error('이어 받을 때는 묻지 않는다'); }, emit: () => {}, dir: join(a.root, 'runs'), tmp: a.root, execOpts: () => ({ oracle }), log: () => {} });
  await b.init();
  assert.equal(await b.resume(), 1);
  await a.until(() => b.running().length === 0);
  const got = await b.pending();
  assert.equal(got.length, 1);
  assert.equal(got[0].jobId, active[0].jobId);
  assert.match(got[0].text, /가짜 Gemma/);
  assert.deepEqual(JSON.parse(readFileSync(join(a.root, 'runs', 'active.json'), 'utf8')), [], '받은 뒤 진행 기록을 지운다');
});

test('T11 로그에 묶음 · 결과 원문 · 토큰이 없다', async () => {
  const { r, events, logDir, until } = setup();
  await r.init();
  await r.run(req());
  await until(() => events.some((e) => e.type === 'done'));
  await r.run(req({ runId: 'mgz1abcd-fail01', bundleMarkdown: BUNDLE }));
  const log = readFileSync(join(logDir, 'shell.log'), 'utf8');
  for (const bad of ['ya29.', 'refresh_token', '# 업무', 'llmwiki-result', '비밀 같은']) assert.ok(!log.includes(bad), bad);
  assert.match(log, /"event":"done"/);
});
