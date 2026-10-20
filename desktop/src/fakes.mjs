// 개발 · 시험용 가짜 실행자(LLMWIKI_DESKTOP_FAKE_EXECUTORS=1, 패키징 빌드에서는 쓰지 않는다).
// claude · codex 는 tools/handoff/fixtures/fake-cli.mjs, gemma 는 서버 대신 몇 초 뒤 답하는 가짜 큐.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const FAKE_CLI = fileURLToPath(new URL('../../tools/handoff/fixtures/fake-cli.mjs', import.meta.url));

export function fakeOracle({ delayMs = 3000 } = {}) {
  const jobs = new Map();
  const id = () => `${new Date().toISOString().slice(5, 10).replace('-', '')}-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}-${Math.random().toString(16).slice(2, 6)}`;
  return {
    async runGemma(bundlePath, { onSubmitted, onTick, signal, resumeId } = {}) {
      const jobId = resumeId ?? id();
      const input = resumeId ? jobs.get(resumeId) ?? '' : await readFile(bundlePath, 'utf8');
      jobs.set(jobId, input);
      onSubmitted?.(jobId);
      onTick?.({ id: jobId, status: 'queued', ahead: 0 });
      await new Promise((r) => setTimeout(r, delayMs / 2));
      onTick?.({ id: jobId, status: 'running' });
      await new Promise((r, j) => {
        const t = setTimeout(r, delayMs / 2);
        signal?.addEventListener('abort', () => { clearTimeout(t); j(Object.assign(new Error('취소'), { code: 'cancelled', jobId })); }, { once: true });
      });
      const run = /"run"\s*:\s*"([^"]+)"/.exec(input)?.[1] ?? 'unknown';
      return { id: jobId, text: `가짜 Gemma 의 답입니다.\n\n\`\`\`llmwiki-result\n${JSON.stringify({ run, summary: '가짜 Gemma 요약', tasks: [{ title: '가짜 Gemma 할 일' }] })}\n\`\`\`\n` };
    },
    async queueStatus() {
      return { reachable: true, queue: 0, running: null, gemma: 'off' };
    },
  };
}
