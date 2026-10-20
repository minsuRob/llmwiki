// node --test prototype/  — 외부 전송 없이 돈다(실제 Claude·Codex 는 부르지 않음).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validate } from './handoff.mjs';
import { EXECUTORS } from './executors.mjs';
import { runDelegation } from './runner.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const data = join(here, '..', 'data');
// data/ 는 개인 자료라 저장소에 없다(build_cases.py 로 로컬에서 만든다). 없으면 데이터가 필요한 시험만 건너뛴다.
const HAS_DATA = existsSync(join(data, 'result_cases.json'));
const P = HAS_DATA ? readFileSync(join(data, 'P.md'), 'utf8').split('\n') : [];
const O = HAS_DATA ? readFileSync(join(data, 'O.md'), 'utf8').split('\n') : [];
const fx = HAS_DATA ? JSON.parse(readFileSync(join(data, 'result_cases.json'), 'utf8')) : { ctx: { post_ids: [] }, cases: [] };
const ctx = {
  runId: fx.ctx.run_id, taskId: fx.ctx.task_id, contextVersion: fx.ctx.context_version,
  lineCounts: fx.ctx.line_counts, postIds: new Set(fx.ctx.post_ids), sourceLines: { P, O },
};

test('Python 검증기와 같은 결과 (20건)', { skip: !HAS_DATA && '로컬 실험 데이터 없음' }, () => {
  for (const c of fx.cases) {
    const r = validate(c.text, ctx);
    for (const [k, v] of Object.entries(c.expected)) {
      if (k === 'warn') assert.equal(r.warnings.length, v, `${c.name} warnings`);
      else assert.equal(r[k], v, `${c.name} ${k}`);
    }
    assert.equal(r.accepted_as, 'proposal', c.name);
  }
});

test('Claude 조사 위임: 읽기·웹 조사만 허용, 쓰기·셸 차단, 표준입력으로 묶음 전달', () => {
  const c = EXECUTORS.claude.command({ bundlePath: '/tmp/b.md', mcpConfig: '/tmp/mcp.json' });
  assert.equal(c.cmd, 'claude');
  assert.ok(c.args.includes('-p') && c.args.includes('--output-format'));
  assert.match(c.args[c.args.indexOf('--allowedTools') + 1], /WebSearch/);
  assert.match(c.args[c.args.indexOf('--disallowedTools') + 1], /Bash.*Edit.*Write/);
  assert.equal(c.args[c.args.indexOf('--mcp-config') + 1], '/tmp/mcp.json');
  assert.equal(c.stdinFile, '/tmp/b.md');
});

test('Codex 위임: 읽기 전용 샌드박스, 표준입력 프롬프트', () => {
  const c = EXECUTORS.codex.command({ bundlePath: '/tmp/b.md', workdir: '/tmp/w', lastMessagePath: '/tmp/last.txt' });
  assert.deepEqual(c.args.slice(0, 5), ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check']);
  assert.equal(c.args.at(-1), '-');
});

test('Grok·Muse 는 같은 모양의 자리만 있고 아직 실행하지 않는다', () => {
  for (const id of ['grok', 'muse']) {
    assert.equal(EXECUTORS[id].status, 'planned');
    assert.throws(() => EXECUTORS[id].command({}));
  }
});

test('dry-run 은 실행하지 않고 run 기록만 남긴다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'runs-'));
  const r = await runDelegation({ executor: 'claude', bundlePath: '/tmp/b.md', ctx, runsDir: dir, dryRun: true });
  assert.equal(r.status, 'dry_run');
  assert.ok(!('validation' in r));
});

test('가짜 실행자로 끝까지: 결과가 맞아도 검토 대기, 금지 필드면 주의 필요 — 업무 상태는 바꾸지 않는다', { skip: !HAS_DATA && '로컬 실험 데이터 없음' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'runs-'));
  const good = fx.cases.find((c) => c.name === 'ok_full').text;
  const bad = fx.cases.find((c) => c.name === 'forbidden_status_top').text;
  for (const [name, text, want] of [['good', good, 'review_pending'], ['bad', bad, 'needs_attention']]) {
    const script = join(dir, `${name}.sh`);
    writeFileSync(script, `#!/bin/sh\ncat > /dev/null\ncat <<'EOF'\n${JSON.stringify({ result: text, num_turns: 1 })}\nEOF\n`);
    chmodSync(script, 0o755);
    const r = await runDelegation({ executor: 'claude', bundlePath: join(data, 'P.md'), ctx, runsDir: dir, commandOverride: { cmd: script, args: [] } });
    assert.equal(r.status, want, name);
    assert.equal(r.validation.accepted_as, 'proposal');
  }
});
