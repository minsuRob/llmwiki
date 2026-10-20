// 셸 로그 — 사실만(runId · 실행자 · 상태 · 걸린 시간 · 크기 · 코드). 묶음 · 결과 원문 · 토큰 · stderr 는 쓰지 않는다(원칙 4 · 6).
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const KEYS = ['runId', 'executor', 'ms', 'bytes', 'code', 'jobId', 'count', 'origin', 'reason', 'version'];

export function createLog(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, 'shell.log');
  return (event, fields = {}) => {
    const row = { at: new Date().toISOString(), event: String(event).slice(0, 40) };
    for (const k of KEYS) if (fields[k] != null) row[k] = typeof fields[k] === 'string' ? fields[k].slice(0, 120) : fields[k];
    try {
      appendFileSync(file, `${JSON.stringify(row)}\n`, { mode: 0o600 });
    } catch {
      /* 로그를 못 써도 실행은 계속 */
    }
  };
}
