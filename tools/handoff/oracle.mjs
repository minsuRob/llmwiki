// Gemma 실행 — 오라클 서버 작업 큐(jobd)에 묶음을 올리고, 끝나면 답을 받아 온다. 의존성 없음.
// 접속은 ~/.ssh/config 의 호스트 별칭(기본 oci-a1)을 쓴다. 서버는 정해진 작업 종류(handoff_gemma)만 돌린다.
// createOracle({ run }) 로 ssh · scp 를 바꿔 끼워 시험한다(lib.test.mjs). 기본 함수들은 MCP(oci-jobs-mcp.mjs) · run.mjs · 데스크톱이 같이 쓴다.
import { execFile } from 'node:child_process';
import { basename } from 'node:path';

export const HOST = process.env.OCI_JOBS_HOST ?? 'oci-a1';
export const JOB_ID = /^[0-9]{4}-[0-9]{6}-[0-9a-f]{4}$/;
const ID = JOB_ID;

/** 실패 이유를 코드로 — 데스크톱 브리지가 그대로 앱에 알린다 */
export class GemmaError extends Error {
  constructor(code, message, jobId) {
    super(message);
    this.code = code; // 'unavailable' | 'too_long_for_gemma' | 'exec_failed' | 'timeout' | 'cancelled'
    this.jobId = jobId ?? null;
  }
}

const defaultRun = (cmd, args, timeout = 120_000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, maxBuffer: 16 << 20 }, (err, stdout, stderr) => resolve({ ok: !err, stdout, stderr: stderr || String(err ?? '') }));
});
const SSH_OPTS = ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes'];
const json = (r) => { try { return JSON.parse(r.stdout); } catch { return { error: r.stderr || r.stdout } } };
const wait = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

export function createOracle({ run = defaultRun, host = HOST } = {}) {
  const jobd = (...args) => run('ssh', [...SSH_OPTS, host, 'python3', '~/lwe/jobd/jobd.py', ...args]);
  const checkId = (id) => { if (!ID.test(id ?? '')) throw new Error('id 형식 오류'); };

  /** 묶음 파일을 서버 jobs/in 에 올리고 handoff_gemma 작업을 넣는다 → { id, jobs_ahead } */
  async function submitGemma(bundlePath) {
    const name = `${Date.now()}-${basename(bundlePath).replace(/[^\w.-]/g, '_').slice(-60)}`;
    const up = await run('scp', ['-q', ...SSH_OPTS, bundlePath, `${host}:lwe/jobs/in/${name}`]);
    if (!up.ok) throw new GemmaError('unavailable', `묶음을 서버에 올리지 못했다: ${up.stderr.trim()}`);
    const r = json(await jobd('submit', 'handoff_gemma', '--input', `~/lwe/jobs/in/${name}`));
    if (!ID.test(r.id ?? '')) throw new GemmaError('unavailable', `작업을 넣지 못했다: ${r.error ?? JSON.stringify(r)}`);
    return r;
  }

  async function statusOf(id) {
    checkId(id);
    return json(await jobd('status', id));
  }

  /** 끝난 작업의 답 글. 아직이면 null */
  async function outputOf(id) {
    checkId(id);
    const r = await jobd('output', id);
    if (!r.ok) throw new Error(r.stderr.trim());
    if (r.stdout.startsWith('{') && /"error"/.test(r.stdout.slice(0, 200))) return null;
    return r.stdout;
  }

  /** 실패한 작업의 기록(단계별 종료 코드 · 로그 끝) */
  async function resultOf(id) {
    checkId(id);
    return json(await jobd('result', id));
  }

  async function cancelGemma(id) {
    checkId(id);
    const r = json(await jobd('cancel', id));
    return Boolean(r.cancelled || r.stopped);
  }

  /** 대기열 요약 — 서버에 닿는지 · 대기 수 · 실행 중 · Gemma 상주 여부 */
  async function queueStatus() {
    const r = await jobd('status');
    if (!r.ok) return { reachable: false };
    const s = json(r);
    if (s.error) return { reachable: false };
    return { reachable: true, queue: s.queue?.length ?? 0, running: s.running?.[0]?.id ?? null, gemma: s.gemma_up ? 'on' : 'off' };
  }

  async function failure(id) {
    const r = await resultOf(id).catch(() => ({}));
    // gemma_handoff.py 는 묶음이 문맥을 넘으면 돌리지 않고 종료 코드 3 으로 끝난다
    if ((r.job?.steps ?? []).some((s) => s.rc === 3)) return new GemmaError('too_long_for_gemma', '묶음이 Gemma 문맥(8K)보다 길다. 앱에서 Gemma 로 다시 묶거나 자료를 줄여 주세요.', id);
    return new GemmaError('exec_failed', `Gemma 작업 실패(${id}): ${(r.log_tail ?? []).join('\n').slice(-800)}`, id);
  }

  /**
   * 넣고(또는 resumeId 를 이어) 끝날 때까지 기다린다.
   * onSubmitted(id) 는 작업 id 가 생기자마자 — 끊겨도 이어 받을 수 있게 보관하라고.
   * signal 이 끊으면 서버 작업도 취소한다.
   */
  async function runGemma(bundlePath, { timeoutMs = 45 * 60_000, everyMs = 10_000, onTick, onSubmitted, signal, resumeId } = {}) {
    const job = resumeId ? { id: resumeId, jobs_ahead: undefined } : await submitGemma(bundlePath);
    onSubmitted?.(job.id);
    onTick?.({ id: job.id, status: 'queued', ahead: job.jobs_ahead });
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      await wait(everyMs, signal);
      if (signal?.aborted) {
        await cancelGemma(job.id).catch(() => false);
        throw new GemmaError('cancelled', `작업 ${job.id} 을 취소했다`, job.id);
      }
      const s = await statusOf(job.id);
      onTick?.({ id: job.id, status: s.status, ahead: job.jobs_ahead });
      if (s.status === 'done') return { id: job.id, text: await outputOf(job.id), job: s };
      if (s.status === 'failed') throw await failure(job.id);
      if (s.error) throw new GemmaError('exec_failed', `작업 ${job.id} 을 서버에서 찾지 못했다`, job.id);
    }
    throw new GemmaError('timeout', `시간 초과 — 작업 ${job.id} 은 서버에서 계속 돈다. 나중에: node tools/handoff/run.mjs gemma --fetch ${job.id}`, job.id);
  }

  return { submitGemma, statusOf, outputOf, resultOf, cancelGemma, queueStatus, runGemma };
}

export const { submitGemma, statusOf, outputOf, resultOf, cancelGemma, queueStatus, runGemma } = createOracle();
