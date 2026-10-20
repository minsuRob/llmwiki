// 브리지 입력 검증 — 순수 함수(test/validate.test.mjs). preload 의 검증은 믿지 않고 메인이 다시 한다.

export const EXECUTOR_NAMES = ['claude', 'codex', 'gemma'];
export const LIMITS = {
  maxBundleBytes: 200_000, // oci-jobs-mcp.mjs oci_handoff_submit 과 같은 상한
  maxGemmaChars: 20_000, // Gemma 예산 5천 자 + 머리 · 규칙. 넘으면 서버에서 어차피 '너무 김'
  maxConcurrent: 2,
  timeoutMs: { claude: 30 * 60_000, codex: 30 * 60_000, gemma: 45 * 60_000 },
};
/** 실행자별로 고를 수 있는 모델 — 목록 밖 값은 무시하고 기본값 */
export const MODELS = { claude: ['opus', 'sonnet', 'haiku'], codex: [], gemma: [] };

/** packages/core/src/types.ts newId: Date.now().toString(36) + '-' + 무작위 base36 */
export const RUN_ID = /^[0-9a-z]{4,14}-[0-9a-z]{1,10}$/;
/** 업무 id 는 셸이 해석하지 않고 돌려주기만 한다 — 모양만 좁힌다 */
export const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** → { ok: true, value } | { ok: false, code } */
export function validateRunRequest(req) {
  if (!req || typeof req !== 'object') return { ok: false, code: 'invalid_input' };
  const { runId, itemId, executor, bundleMarkdown, model } = req;
  if (typeof executor !== 'string' || !EXECUTOR_NAMES.includes(executor)) return { ok: false, code: 'invalid_input' };
  if (typeof runId !== 'string' || !RUN_ID.test(runId)) return { ok: false, code: 'invalid_input' };
  if (typeof itemId !== 'string' || !ITEM_ID.test(itemId)) return { ok: false, code: 'invalid_input' };
  if (typeof bundleMarkdown !== 'string' || !bundleMarkdown.trim() || bundleMarkdown.includes('\0')) return { ok: false, code: 'invalid_input' };
  if (Buffer.byteLength(bundleMarkdown, 'utf8') > LIMITS.maxBundleBytes) return { ok: false, code: 'too_large' };
  if (executor === 'gemma' && bundleMarkdown.length > LIMITS.maxGemmaChars) return { ok: false, code: 'too_long_for_gemma' };
  const m = typeof model === 'string' && MODELS[executor].includes(model) ? model : undefined;
  return { ok: true, value: { runId, itemId, executor, bundleMarkdown, ...(m ? { model: m } : {}) } };
}

export function validRunId(runId) {
  return typeof runId === 'string' && RUN_ID.test(runId);
}

/** 확인 창에 보일 요약 — 묶음 첫 제목 · 크기 · 자료 수(줄 번호 접두 S1 · S2 …) */
export function bundleSummary(markdown) {
  const title = (/^# (.+)$/m.exec(markdown)?.[1] ?? '').slice(0, 120);
  const refs = new Set(markdown.match(/^S\d+(?=:\d+\| )/gm) ?? []);
  return { title, chars: markdown.length, sources: refs.size };
}
