// 위임 1건 = run 1건. 묶음 파일을 실행자에 넘기고, 돌아온 결과를 검증해 '제안'으로만 기록한다.
// 업무 상태는 여기서 절대 바꾸지 않는다(확정은 사람이 검토 카드에서).
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EXECUTORS } from './executors.mjs';
import { validate } from './handoff.mjs';

/**
 * @param {object} o
 * @param {string} o.executor  'claude' | 'codex' | ...
 * @param {string} o.bundlePath  맥락 묶음(.md)
 * @param {object} o.ctx  검증 맥락(runId, taskId, contextVersion, lineCounts, postIds, sourceLines)
 * @param {string} o.runsDir  run 기록을 남길 폴더
 * @param {boolean} [o.dryRun]  true 면 명령만 만들고 실행하지 않는다(외부 전송 없음)
 * @param {object} [o.commandOverride]  시험용: {cmd,args} 로 실제 CLI 대신 가짜 실행자를 쓴다
 */
export async function runDelegation({ executor, bundlePath, ctx, runsDir, dryRun = false, timeoutMs = 30 * 60_000, commandOverride, ...opts }) {
  const ex = EXECUTORS[executor];
  if (!ex) throw new Error(`모르는 실행자: ${executor}`);
  const base = commandOverride ?? ex.command({ bundlePath, ...opts });
  const record = {
    run_id: ctx.runId, task_id: ctx.taskId, context_version: ctx.contextVersion, executor, status: 'queued',
    command: { cmd: base.cmd, args: base.args }, started_at: new Date().toISOString(),
  };
  if (dryRun) {
    record.status = 'dry_run';
    return persist(runsDir, record);
  }
  record.status = 'running';
  const out = await exec(base.cmd, base.args, base.stdinFile ?? bundlePath, timeoutMs);
  record.ended_at = new Date().toISOString();
  record.exit_code = out.code;
  record.timed_out = out.timedOut;
  const { text, meta } = ex.readOutput(out.stdout);
  record.executor_meta = meta;
  record.raw_output_chars = text.length;
  record.validation = validate(text, ctx);
  // 결과가 검증을 통과해도 '검토 대기'일 뿐이다.
  record.status = out.code === 0 && record.validation.schema_ok ? 'review_pending' : 'needs_attention';
  record.raw_output = text;
  return persist(runsDir, record);
}

function exec(cmd, args, stdinFile, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(e), timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    if (stdinFile) createReadStream(stdinFile).pipe(child.stdin); else child.stdin.end();
  });
}

async function persist(dir, record) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${record.run_id}.json`), JSON.stringify(record, null, 1));
  return record;
}
