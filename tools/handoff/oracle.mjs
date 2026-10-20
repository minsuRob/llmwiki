// Gemma 실행 — 오라클 서버 작업 큐(jobd)에 맥락 묶음을 올리고, 끝나면 답을 받아 온다. 의존성 없음.
// 접속은 ~/.ssh/config 의 호스트 별칭(기본 oci-a1)을 쓴다. 서버는 정해진 작업 종류(handoff_gemma)만 돌린다.
import { execFile } from 'node:child_process';
import { basename } from 'node:path';

export const HOST = process.env.OCI_JOBS_HOST ?? 'oci-a1';
const ID = /^[0-9]{4}-[0-9]{6}-[0-9a-f]{4}$/;

const run = (cmd, args, timeout = 120_000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, maxBuffer: 16 << 20 }, (err, stdout, stderr) => resolve({ ok: !err, stdout, stderr: stderr || String(err ?? '') }));
});
const jobd = (...args) => run('ssh', ['-o', 'ConnectTimeout=10', HOST, 'python3', '~/lwe/jobd/jobd.py', ...args]);
const json = (r) => { try { return JSON.parse(r.stdout); } catch { return { error: r.stderr || r.stdout } } };

/** 묶음 파일을 서버 jobs/in 에 올리고 handoff_gemma 작업을 넣는다 → { id, jobs_ahead } */
export async function submitGemma(bundlePath) {
  const name = `${Date.now()}-${basename(bundlePath).replace(/[^\w.-]/g, '_').slice(-60)}`;
  const up = await run('scp', ['-q', '-o', 'ConnectTimeout=10', bundlePath, `${HOST}:lwe/jobs/in/${name}`]);
  if (!up.ok) throw new Error(`묶음을 서버에 올리지 못했다: ${up.stderr.trim()}`);
  const r = json(await jobd('submit', 'handoff_gemma', '--input', `~/lwe/jobs/in/${name}`));
  if (!ID.test(r.id ?? '')) throw new Error(`작업을 넣지 못했다: ${r.error ?? JSON.stringify(r)}`);
  return r;
}

export async function statusOf(id) {
  if (!ID.test(id)) throw new Error('id 형식 오류');
  return json(await jobd('status', id));
}

/** 끝난 작업의 답 글. 아직이면 null */
export async function outputOf(id) {
  if (!ID.test(id)) throw new Error('id 형식 오류');
  const r = await jobd('output', id);
  if (!r.ok) throw new Error(r.stderr.trim());
  if (r.stdout.startsWith('{') && /"error"/.test(r.stdout.slice(0, 200))) return null;
  return r.stdout;
}

/** 넣고 끝날 때까지 기다린다(onTick 으로 진행 상태) */
export async function runGemma(bundlePath, { timeoutMs = 45 * 60_000, everyMs = 10_000, onTick } = {}) {
  const job = await submitGemma(bundlePath);
  onTick?.({ id: job.id, status: 'queued', ahead: job.jobs_ahead });
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, everyMs));
    const s = await statusOf(job.id);
    onTick?.({ id: job.id, status: s.status, ahead: job.jobs_ahead });
    if (s.status === 'done') return { id: job.id, text: await outputOf(job.id), job: s };
    if (s.status === 'failed') {
      const out = await jobd('result', job.id);
      throw new Error(`Gemma 작업 실패(${job.id}): ${out.stdout.slice(-800)}`);
    }
  }
  throw new Error(`시간 초과 — 작업 ${job.id} 은 서버에서 계속 돈다. 나중에: node tools/handoff/run.mjs gemma --fetch ${job.id}`);
}
