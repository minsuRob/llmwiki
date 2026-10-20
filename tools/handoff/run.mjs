#!/usr/bin/env node
// 위임 실행 — 앱에서 내보낸 맥락 묶음(.md)을 실행자에 넘기고, 답을 <묶음>-result.md 로 남긴다. 의존성 없음.
//
//   node tools/handoff/run.mjs <claude|codex|gemma> <묶음.md> [--out 결과.md] [--model 이름] [--dry-run]
//   node tools/handoff/run.mjs gemma --fetch <작업 id> [--out 결과.md]      (기다리다 끊긴 Gemma 작업 받아 오기)
//
// - claude · codex: 이 컴퓨터의 CLI 를 비대화형으로(조사 모드: 읽기 · 웹만, 파일 수정 · 셸 금지 / Codex 는 읽기 전용 샌드박스).
// - gemma: 오라클 서버 작업 큐(oracle.mjs). 서버가 Gemma 를 켜고 묶음을 읽혀 답을 만든다.
// 답을 업무에 반영하지 않는다. 앱의 '작업 결과 가져오기'에 붙여 넣거나 파일로 넣으면 같은 검사를 거쳐 '제안'으로만 들어간다.
import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { EXECUTORS } from './executors.mjs';
import { outputOf, runGemma } from './oracle.mjs';

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

function exec(cmd, args, stdinFile, timeoutMs = 30 * 60_000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'] });
    let stdout = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout, error: String(e) }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout }); });
    createReadStream(stdinFile).pipe(child.stdin);
  });
}

let text;
if (who === 'gemma') {
  if (o['dry-run']) {
    console.log(`(dry-run) ${bundle} → 오라클 서버 jobs/in 에 올리고 handoff_gemma 작업을 넣는다`);
    process.exit(0);
  }
  if (o.fetch) {
    text = await outputOf(o.fetch);
    if (text == null) { console.error(`작업 ${o.fetch} 은 아직 끝나지 않았다`); process.exit(1); }
  } else {
    const r = await runGemma(bundle, { onTick: (s) => process.stderr.write(`\r[gemma ${s.id}] ${s.status}${s.status === 'queued' && s.ahead ? ` · 앞 작업 ${s.ahead}` : ''}      `) });
    process.stderr.write('\n');
    text = r.text ?? '';
  }
} else {
  const ex = EXECUTORS[who];
  const { cmd, args } = ex.command({ bundlePath: bundle, model: o.model, mode: 'research' });
  if (o['dry-run']) {
    console.log(`(dry-run) ${cmd} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')} < ${bundle}`);
    process.exit(0);
  }
  const r = await exec(cmd, args, bundle);
  if (r.code !== 0) {
    console.error(`${cmd} 가 실패했다(코드 ${r.code})${r.error ? `: ${r.error}` : ''}`);
    process.exit(1);
  }
  text = ex.readOutput(r.stdout).text;
}

await writeFile(outPath, text);
process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
const hasBlock = /```\s*llmwiki-result/.test(text);
console.error(`\n→ ${outPath} 에 저장했다.${hasBlock ? '' : ' (llmwiki-result 블록이 없다 — 가져오면 원문만 남는다)'} 앱의 '작업 결과 가져오기'로 넣어 주세요.`);
