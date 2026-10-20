#!/usr/bin/env node
// 위임 실행 — 앱에서 내보낸 맥락 묶음(.md)을 실행자에 넘기고, 답을 <묶음>-result.md 로 남긴다. 의존성 없음.
//
//   node tools/handoff/run.mjs <claude|codex|gemma> <묶음.md> [--out 결과.md] [--model 이름] [--dry-run]
//   node tools/handoff/run.mjs gemma --fetch <작업 id> [--out 결과.md]      (기다리다 끊긴 Gemma 작업 받아 오기)
//
// - claude · codex: 이 컴퓨터의 CLI 를 비대화형으로(조사 모드: 읽기 · 웹만, 파일 수정 · 셸 금지 / Codex 는 읽기 전용 샌드박스).
// - gemma: 오라클 서버 작업 큐(oracle.mjs). 서버가 Gemma 를 켜고 묶음을 읽혀 답을 만든다.
// 답을 업무에 반영하지 않는다. 앱의 '작업 결과 가져오기'에 붙여 넣거나 파일로 넣으면 같은 검사를 거쳐 '제안'으로만 들어간다.
// 실행 본문은 lib.mjs — 데스크톱 셸도 같은 코드를 쓴다. 여기는 인자 · 파일 · 출력만.
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { commandFor, fetchGemma, runHandoff } from './lib.mjs';

const { values: o, positionals: [who, bundle] } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string' }, model: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, fetch: { type: 'string' } },
});
const usage = () => {
  console.error('사용: node tools/handoff/run.mjs <claude|codex|gemma> <묶음.md> [--out 결과.md] [--model 이름] [--dry-run]');
  process.exit(2);
};
if (!['claude', 'codex', 'gemma'].includes(who)) usage();
if (!o.fetch && (!bundle || !existsSync(bundle))) usage();
const outPath = o.out ?? (bundle ? bundle.replace(/(-ai)?\.md$/i, '') + '-result.md' : `gemma-${o.fetch}-result.md`);

if (o['dry-run']) {
  if (who === 'gemma') console.log(`(dry-run) ${bundle} → 오라클 서버 jobs/in 에 올리고 handoff_gemma 작업을 넣는다`);
  else {
    const { cmd, args } = commandFor(who, { bundlePath: bundle, model: o.model, mode: 'research' });
    console.log(`(dry-run) ${cmd} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')} < ${bundle}`);
  }
  process.exit(0);
}

let text;
try {
  if (who === 'gemma' && o.fetch) {
    text = await fetchGemma(o.fetch);
    if (text == null) { console.error(`작업 ${o.fetch} 은 아직 끝나지 않았다`); process.exit(1); }
  } else {
    const r = await runHandoff({
      executor: who, bundlePath: bundle, model: o.model, mode: 'research',
      onProgress: (s) => { if (who === 'gemma') process.stderr.write(`\r[gemma ${s.jobId}] ${s.status}${s.status === 'queued' && s.ahead ? ` · 앞 작업 ${s.ahead}` : ''}      `); },
    });
    if (who === 'gemma') process.stderr.write('\n');
    text = r.text;
  }
} catch (e) {
  if (who === 'gemma') process.stderr.write('\n');
  console.error(e.message);
  process.exit(1);
}

await writeFile(outPath, text);
process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
const hasBlock = /```\s*llmwiki-result/.test(text);
console.error(`\n→ ${outPath} 에 저장했다.${hasBlock ? '' : ' (llmwiki-result 블록이 없다 — 가져오면 원문만 남는다)'} 앱의 '작업 결과 가져오기'로 넣어 주세요.`);
