// 실행 큐 — 확인 창 → 임시 파일 → tools/handoff/lib.mjs → 결과 보관 → 이벤트. Electron 에 묶이지 않게 의존성은 주입한다(test/runner.test.mjs).
//
// 보관(userData/runs/, 원칙 6 · Q4): 앱이 받기 전 결과 원문 <runId>.json, 진행 중 Gemma 작업 active.json.
// 앱이 받으면(ack) 바로 지우고, 늦어도 30일. 로그에는 원문을 쓰지 않는다(log.mjs).
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { LIMITS, validRunId, validateRunRequest } from './validate.mjs';

const KEEP_MS = 30 * 24 * 3600_000;

export class Runner {
  /**
   * @param {object} d
   * @param {(opts: object) => Promise<{text: string, model?: string|null, latencyMs: number, jobId?: string}>} d.runHandoff  lib.mjs runHandoff
   * @param {(req: object) => Promise<boolean>} d.confirm  외부 전송 확인(사람)
   * @param {(e: object) => void} d.emit  RunEvent 를 웹으로
   * @param {string} d.dir  보관 폴더(userData/runs)
   * @param {string} d.tmp  임시 폴더 뿌리(OS temp)
   * @param {(executor: string) => object} [d.execOpts]  실행자별 bin · env 등
   * @param {(event: string, fields: object) => void} [d.log]
   */
  constructor({ runHandoff, confirm, emit, dir, tmp, execOpts = () => ({}), log = () => {} }) {
    Object.assign(this, { runHandoff, confirm, emit, dir, tmp, execOpts, log });
    /** runId → { executor, ctrl, promise } */
    this.active = new Map();
  }

  async init() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await this.prune();
  }

  /** 웹의 runHandoff — 확인 창 결과까지 기다려 받아들임 여부를 돌려주고, 실행은 이벤트로 */
  async run(raw) {
    const v = validateRunRequest(raw);
    if (!v.ok) {
      this.log('rejected', { code: v.code });
      return { accepted: false, code: v.code };
    }
    const req = v.value;
    if (this.active.has(req.runId)) return { accepted: true }; // 같은 실행에 다시 붙는다(중복 실행 없음)
    const busyExec = [...this.active.values()].some((a) => a.executor === req.executor);
    if (busyExec || this.active.size >= LIMITS.maxConcurrent) return { accepted: false, code: 'busy' };

    const ctrl = new AbortController();
    const slot = { executor: req.executor, ctrl, itemId: req.itemId };
    this.active.set(req.runId, slot); // 확인 창이 떠 있는 동안에도 자리를 잡는다
    this.emit({ runId: req.runId, type: 'confirming' });
    let ok = false;
    try {
      ok = await this.confirm(req);
    } catch {
      ok = false;
    }
    if (!ok || ctrl.signal.aborted) {
      this.active.delete(req.runId);
      this.log('declined', { runId: req.runId, executor: req.executor });
      this.emit({ runId: req.runId, type: 'failed', code: 'declined', message: '보내지 않았어요.' });
      return { accepted: false, code: 'declined' };
    }
    slot.promise = this.#execute(req, ctrl);
    return { accepted: true };
  }

  async #execute(req, ctrl, resumeId) {
    const { runId, itemId, executor } = req;
    const started = Date.now();
    let work = null;
    try {
      work = await mkdtemp(join(this.tmp, `llmwiki-${runId}-`)); // 0700
      const bundlePath = join(work, 'bundle.md');
      const cwd = join(work, 'cwd'); // Claude · Codex 가 도는 빈 폴더
      await mkdir(cwd, { mode: 0o700 });
      if (!resumeId) await writeFile(bundlePath, req.bundleMarkdown, { mode: 0o600 });
      this.log('start', { runId, executor, bytes: resumeId ? 0 : Buffer.byteLength(req.bundleMarkdown), jobId: resumeId });
      const r = await this.runHandoff({
        executor,
        bundlePath,
        model: req.model,
        mode: 'web',
        workdir: cwd,
        signal: ctrl.signal,
        stderr: 'pipe',
        timeoutMs: LIMITS.timeoutMs[executor],
        resumeId,
        onSubmitted: (jobId) => this.#remember({ runId, itemId, executor, jobId, submittedAt: new Date().toISOString() }),
        onProgress: (s) => {
          const elapsedMs = Date.now() - started;
          if (s.status === 'queued') this.emit({ runId, type: 'queued', jobId: s.jobId, ahead: s.ahead });
          else if (s.status === 'running') this.emit({ runId, type: 'running', elapsedMs });
        },
        ...this.execOpts(executor),
      });
      const result = { runId, itemId, executor, text: r.text, latencyMs: r.latencyMs, ...(r.model ? { model: r.model } : {}), ...(r.jobId ? { jobId: r.jobId } : {}), finishedAt: new Date().toISOString() };
      await writeFile(join(this.dir, `${runId}.json`), JSON.stringify(result), { mode: 0o600 });
      await this.#forget(runId);
      this.log('done', { runId, executor, ms: Date.now() - started, bytes: Buffer.byteLength(r.text), jobId: r.jobId });
      this.emit({ runId, type: 'done', result });
    } catch (e) {
      const code = e?.code ?? 'exec_failed';
      // 시간 초과한 Gemma 는 서버에서 계속 돈다 — 기록을 남겨 다음 시작 때 이어 받는다
      if (!(code === 'timeout' && e?.jobId)) await this.#forget(runId);
      this.log(code === 'cancelled' ? 'cancelled' : 'failed', { runId, executor, ms: Date.now() - started, code, jobId: e?.jobId });
      if (code === 'cancelled') this.emit({ runId, type: 'cancelled' });
      else this.emit({ runId, type: 'failed', code, message: errorText(e) });
    } finally {
      this.active.delete(runId);
      if (work) await rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async cancel(runId) {
    if (!validRunId(runId)) return false;
    const a = this.active.get(runId);
    if (!a) return false;
    a.ctrl.abort();
    return true;
  }

  /** 앱이 아직 받지 않은 결과(30일 지난 것은 지운다) */
  async pending() {
    await this.prune();
    const out = [];
    for (const f of await this.#files()) {
      try {
        const r = JSON.parse(await readFile(join(this.dir, f), 'utf8'));
        out.push(r);
      } catch {
        /* 깨진 파일은 건너뛴다 */
      }
    }
    return out.sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)));
  }

  async ack(runId) {
    if (!validRunId(runId)) return;
    await rm(join(this.dir, `${runId}.json`), { force: true });
    this.log('acked', { runId });
  }

  /** 셸을 다시 켰을 때 — 끝나지 않은 Gemma 작업을 이어 받는다(확인 창은 이미 거쳤다) */
  async resume() {
    const list = await this.#readActive();
    for (const a of list) {
      if (a.executor !== 'gemma' || !a.jobId || this.active.has(a.runId)) continue;
      const ctrl = new AbortController();
      const slot = { executor: 'gemma', ctrl, itemId: a.itemId };
      this.active.set(a.runId, slot);
      slot.promise = this.#execute({ runId: a.runId, itemId: a.itemId, executor: 'gemma' }, ctrl, a.jobId);
    }
    return list.length;
  }

  /** 진행 중인 실행(웹이 새로 열렸을 때 상태를 다시 그리려고) */
  running() {
    return [...this.active.entries()].map(([runId, a]) => ({ runId, itemId: a.itemId, executor: a.executor }));
  }

  async prune() {
    const now = Date.now();
    for (const f of await this.#files()) {
      const p = join(this.dir, f);
      const s = await stat(p).catch(() => null);
      if (s && now - s.mtimeMs > KEEP_MS) await rm(p, { force: true });
    }
  }

  async #files() {
    const names = await readdir(this.dir).catch(() => []);
    return names.filter((n) => n.endsWith('.json') && n !== 'active.json' && validRunId(n.slice(0, -5)));
  }

  async #readActive() {
    try {
      const v = JSON.parse(await readFile(join(this.dir, 'active.json'), 'utf8'));
      return Array.isArray(v) ? v.filter((a) => validRunId(a.runId)) : [];
    } catch {
      return [];
    }
  }

  async #writeActive(list) {
    const p = join(this.dir, 'active.json');
    await writeFile(p, JSON.stringify(list), { mode: 0o600 });
    await chmod(p, 0o600);
  }

  async #remember(entry) {
    const list = (await this.#readActive()).filter((a) => a.runId !== entry.runId);
    await this.#writeActive([...list, entry]);
  }

  async #forget(runId) {
    const list = await this.#readActive();
    if (list.some((a) => a.runId === runId)) await this.#writeActive(list.filter((a) => a.runId !== runId));
  }
}

/** 화면에 보일 오류 — 메시지 + stderr 끝(로그에는 쓰지 않는다) */
function errorText(e) {
  const msg = e?.message ?? String(e);
  return e?.stderrTail ? `${msg}\n${e.stderrTail.trim().slice(-300)}` : msg;
}
