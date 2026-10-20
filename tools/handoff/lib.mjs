// 위임 실행 본문 — 맥락 묶음을 실행자(Claude · Codex CLI, 오라클 Gemma 큐)에 넘기고 답 글을 돌려준다. 의존성 없음.
// 터미널 CLI(run.mjs)와 데스크톱 셸(desktop/ 메인)이 같이 쓴다. 답을 업무에 반영하지 않는다 — 앱의 가져오기가 검사해 '제안'으로만 넣는다.
import { spawn as nodeSpawn } from 'node:child_process';
import { createReadStream } from 'node:fs';

import { EXECUTORS } from './executors.mjs';
import * as defaultOracle from './oracle.mjs';

export const GEMMA_MODEL = process.env.GEMMA_MODEL ?? 'gemma-4-E4B q4_0 (llama.cpp, Oracle A1)';
export const DEFAULT_TIMEOUT_MS = { claude: 30 * 60_000, codex: 30 * 60_000, gemma: 45 * 60_000 };
export const MAX_OUTPUT_BYTES = 16 << 20;

/** 실패 이유를 코드로(데스크톱 브리지의 RunErrorCode 와 같은 이름) */
export class HandoffError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code; // 'unavailable' | 'timeout' | 'exec_failed' | 'cancelled' | 'too_long_for_gemma' | 'no_result'
    Object.assign(this, extra);
  }
}

/** 결과 맨 앞 한 줄 — 앱이 실행 기록(모델 · 걸린 시간)에 남기고, 판단 기록(채택률)에 쓴다. 이미 있으면 그대로 */
export function withRunHead(text, { executor, model, latencyMs }) {
  if (text.startsWith('<!-- llmwiki-run')) return text;
  const head = `<!-- llmwiki-run ${JSON.stringify({ executor, ...(model ? { model } : {}), latencyMs })} -->`;
  return `${head}\n${text}`;
}

/** 돌릴 명령(claude · codex) — run.mjs --dry-run 과 데스크톱이 같은 것을 본다 */
export function commandFor(executor, { bundlePath, model, mode = 'research', workdir }) {
  const ex = EXECUTORS[executor];
  if (!ex || ex.kind !== 'cli') throw new HandoffError('unavailable', `${executor} 는 CLI 실행자가 아니다`);
  return ex.command({ bundlePath, model, mode, workdir });
}

/**
 * 프로세스 하나 — 표준입력에 묶음, 표준출력을 모은다.
 * 시간 제한 · 취소(signal) 때 SIGTERM, 5초 뒤에도 살아 있으면 SIGKILL. 출력이 상한을 넘으면 끊는다.
 * stderr: 'inherit'(터미널) | 'pipe'(데스크톱 — 끝 500자만 오류 표시용으로 남기고 로그에 쓰지 않는다)
 */
export function exec(cmd, args, stdinFile, { timeoutMs = 30 * 60_000, signal, cwd, env, stderr = 'inherit', maxOutput = MAX_OUTPUT_BYTES, spawn = nodeSpawn } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['pipe', 'pipe', stderr], cwd, env, shell: false });
    } catch (e) {
      resolve({ code: -1, stdout: '', error: String(e) });
      return;
    }
    let stdout = '';
    let bytes = 0;
    let errTail = '';
    let why = null;
    let killer = null;
    const stop = (reason) => {
      if (why) return;
      why = reason;
      child.kill('SIGTERM');
      killer = setTimeout(() => child.kill('SIGKILL'), 5000);
    };
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    const onAbort = () => stop('cancelled');
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    const done = (r) => {
      clearTimeout(timer);
      clearTimeout(killer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ ...r, stdout, stderrTail: errTail, killed: why });
    };
    child.stdout.on('data', (d) => {
      bytes += d.length;
      if (bytes > maxOutput) return stop('too_much_output');
      stdout += d;
    });
    child.stderr?.on('data', (d) => { errTail = (errTail + d).slice(-500); });
    child.on('error', (e) => done({ code: -1, error: String(e) }));
    child.on('close', (code) => done({ code }));
    child.stdin.on('error', () => undefined); // 자식이 먼저 끝나면 EPIPE
    createReadStream(stdinFile).pipe(child.stdin);
  });
}

/**
 * 묶음 하나 실행 → { text(머리줄 포함), model, latencyMs, jobId? }. 실패는 HandoffError.
 * bin: 실행 파일 절대 경로(데스크톱 — 앱은 셸 PATH 를 받지 못한다). onProgress({ status, jobId?, ahead? }).
 * gemma 는 resumeId 로 끊긴 작업을 이어 받을 수 있고, onSubmitted(jobId) 가 작업 id 를 바로 알려 준다.
 */
export async function runHandoff({
  executor, bundlePath, model, mode = 'research', workdir, signal, onProgress, onSubmitted, resumeId,
  timeoutMs = DEFAULT_TIMEOUT_MS[executor], bin, env, stderr = 'inherit', oracle = defaultOracle, spawn,
}) {
  const started = Date.now();
  if (executor === 'gemma') {
    let r;
    try {
      r = await oracle.runGemma(bundlePath, {
        timeoutMs, signal, resumeId, onSubmitted,
        onTick: (s) => onProgress?.({ status: s.status, jobId: s.id, ahead: s.ahead }),
      });
    } catch (e) {
      throw new HandoffError(e.code ?? 'exec_failed', e.message, { jobId: e.jobId ?? null });
    }
    if (!r.text) throw new HandoffError('no_result', `작업 ${r.id} 은 끝났지만 답이 비었다`, { jobId: r.id });
    // 이어 받은 작업은 처음 시각을 모른다 — 걸린 시간은 이 셸이 기다린 만큼
    return { text: withRunHead(r.text, { executor, model: GEMMA_MODEL, latencyMs: Date.now() - started }), model: GEMMA_MODEL, latencyMs: Date.now() - started, jobId: r.id };
  }
  const ex = EXECUTORS[executor];
  if (!ex || ex.kind !== 'cli' || ex.status !== 'ready') throw new HandoffError('unavailable', `모르는 실행자: ${executor}`);
  const { cmd, args } = commandFor(executor, { bundlePath, model, mode, workdir });
  onProgress?.({ status: 'running' });
  const r = await exec(bin ?? cmd, args, bundlePath, { timeoutMs, signal, cwd: workdir, env, stderr, spawn });
  if (r.killed === 'cancelled') throw new HandoffError('cancelled', `${cmd} 실행을 취소했다`);
  if (r.killed === 'timeout') throw new HandoffError('timeout', `${cmd} 가 ${Math.round(timeoutMs / 60_000)}분 안에 끝나지 않았다`);
  if (r.killed === 'too_much_output') throw new HandoffError('exec_failed', `${cmd} 출력이 너무 크다(${MAX_OUTPUT_BYTES >> 20}MB 넘음)`);
  if (r.code !== 0) throw new HandoffError(r.code === -1 ? 'unavailable' : 'exec_failed', `${cmd} 가 실패했다(코드 ${r.code})${r.error ? `: ${r.error}` : ''}`, { stderrTail: r.stderrTail });
  const out = ex.readOutput(r.stdout);
  if (!out.text) throw new HandoffError('no_result', `${cmd} 가 답을 내지 않았다`);
  const used = model ?? out.meta?.model ?? null;
  const latencyMs = Date.now() - started;
  return { text: withRunHead(out.text, { executor, model: used, latencyMs }), model: used, latencyMs };
}

/** 기다리다 끊긴 Gemma 작업 받아 오기. 아직이면 null */
export async function fetchGemma(jobId, { oracle = defaultOracle, started = Date.now() } = {}) {
  const text = await oracle.outputOf(jobId);
  return text == null ? null : withRunHead(text, { executor: 'gemma', model: GEMMA_MODEL, latencyMs: Date.now() - started });
}
