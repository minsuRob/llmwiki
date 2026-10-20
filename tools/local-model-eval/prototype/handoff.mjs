// 위임 결과(llmwiki-result) 검증 — src/handoff.py 와 같은 규칙의 JS 판(Electron 메인 프로세스·packages/core 로 옮길 용도).
// 원칙: AI 결과는 전부 '제안'이다. 이 모듈은 어떤 상태도 확정하지 않는다.

const RESULT_FENCE = /```llmwiki-result\s*\n([\s\S]*?)```/;
const REF_RE = /^(P|O):(\d+)$|^post:(\d+)$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const FORBIDDEN_KEYS = new Set(['status', 'done', 'completed', 'confirm', 'confirmed', 'final', 'approve', 'approved', 'apply']);
const TOP_KEYS = new Set(['run_id', 'task_id', 'context_version', 'artifacts', 'decision_proposals', 'todo_proposals', 'unverified']);
const ITEM_KEYS = {
  artifacts: [new Set(['title', 'summary', 'source_refs']), ['title', 'summary']],
  decision_proposals: [new Set(['text', 'reason', 'source_refs']), ['text']],
  todo_proposals: [new Set(['text', 'due', 'source_refs']), ['text']],
  unverified: [new Set(['text', 'why']), ['text']],
};

export function extract(text) {
  const m = RESULT_FENCE.exec(text ?? '');
  if (m) return m[1];
  const j = /\{[\s\S]*\}/.exec(text ?? '');
  return j ? j[0] : null;
}

function* allKeys(o) {
  if (Array.isArray(o)) for (const v of o) yield* allKeys(v);
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { yield k; yield* allKeys(v); }
}

const validDate = (s) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };

function dateInSources(due, refs, ctx) {
  const [y, m, d] = due.split('-');
  const pats = [due, `${+m}월 ${+d}일`, `${y}.${+m}.${+d}`, `${m}-${d}`];
  return refs.some((ref) => {
    const mm = REF_RE.exec(String(ref));
    if (!mm || !mm[1]) return false;
    const line = ctx.sourceLines?.[mm[1]]?.[+mm[2] - 1] ?? '';
    return pats.some((p) => line.includes(p));
  });
}

/** ctx: { runId, taskId, contextVersion, lineCounts:{P,O}, postIds:Set, sourceLines:{P:[],O:[]} } */
export function validate(rawText, ctx) {
  const res = { parse_ok: false, schema_ok: false, content_ok: false, errors: [], warnings: [], accepted_as: 'proposal', items: 0 };
  const body = extract(rawText);
  if (body == null) { res.errors.push('결과 블록 없음'); return res; }
  let obj;
  try { obj = JSON.parse(body); } catch (e) { res.errors.push(`JSON 파싱 실패: ${e.message}`); return res; }
  res.parse_ok = true;
  if (obj && typeof obj === 'object' && obj.llmwiki_result && typeof obj.llmwiki_result === 'object') obj = obj.llmwiki_result;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { res.errors.push('최상위가 객체가 아님'); return res; }

  const schemaErr = [];
  const forb = new Set([...allKeys(obj)].filter((k) => FORBIDDEN_KEYS.has(k.toLowerCase())));
  if (forb.size) schemaErr.push(`금지 필드(확정·완료 시도): ${[...forb].sort().join(', ')}`);
  const badTop = Object.keys(obj).filter((k) => !TOP_KEYS.has(k) && !forb.has(k));
  if (badTop.length) schemaErr.push(`모르는 최상위 필드: ${badTop.sort().join(', ')}`);
  for (const k of ['run_id', 'task_id']) if (typeof obj[k] !== 'string') schemaErr.push(`${k} 누락/형식 오류`);
  if (!Number.isInteger(obj.context_version)) schemaErr.push('context_version 누락/형식 오류');
  for (const [listKey, [allowed, required]] of Object.entries(ITEM_KEYS)) {
    const v = obj[listKey] ?? [];
    if (!Array.isArray(v)) { schemaErr.push(`${listKey} 가 배열이 아님`); continue; }
    v.forEach((it, i) => {
      if (!it || typeof it !== 'object' || Array.isArray(it)) { schemaErr.push(`${listKey}[${i}] 객체 아님`); return; }
      const miss = required.filter((r) => !(r in it));
      if (miss.length) schemaErr.push(`${listKey}[${i}] 필수 누락: ${miss}`);
      const extra = Object.keys(it).filter((k) => !allowed.has(k) && !forb.has(k));
      if (extra.length) schemaErr.push(`${listKey}[${i}] 모르는 필드: ${extra}`);
      res.items += 1;
    });
  }
  res.errors.push(...schemaErr);
  res.schema_ok = schemaErr.length === 0;
  if (!res.schema_ok) return res;

  const contentErr = [];
  if (obj.run_id !== ctx.runId || obj.task_id !== ctx.taskId) contentErr.push('run_id/task_id 가 위임과 다름');
  if (obj.context_version !== ctx.contextVersion) contentErr.push('context_version 불일치');
  for (const listKey of ['artifacts', 'decision_proposals', 'todo_proposals']) {
    (obj[listKey] ?? []).forEach((it, i) => {
      for (const ref of it.source_refs ?? []) {
        const m = REF_RE.exec(String(ref));
        if (!m) contentErr.push(`${listKey}[${i}] 참조 형식 오류: ${ref}`);
        else if (m[1] && !(+m[2] >= 1 && +m[2] <= (ctx.lineCounts?.[m[1]] ?? 0))) contentErr.push(`${listKey}[${i}] 없는 줄 참조: ${ref}`);
        else if (m[3] && !ctx.postIds?.has(m[3])) contentErr.push(`${listKey}[${i}] 없는 공고 참조: ${ref}`);
      }
      if (listKey === 'todo_proposals' && it.due != null) {
        if (!(typeof it.due === 'string' && ISO.test(it.due) && validDate(it.due))) contentErr.push(`todo[${i}] 날짜 형식 오류: ${it.due}`);
        else if (!dateInSources(it.due, it.source_refs ?? [], ctx)) res.warnings.push(`todo[${i}] 기한 ${it.due} 이 근거 줄에 없음 → '근거 없는 기한' 표시`);
      }
      if (!(it.source_refs ?? []).length) res.warnings.push(`${listKey}[${i}] 근거 참조 없음`);
    });
  }
  res.errors.push(...contentErr);
  res.content_ok = contentErr.length === 0;
  return res;
}
