#!/usr/bin/env node
// 시험 · 개발용 가짜 실행자 — 표준입력(묶음)을 읽고 llmwiki-result 가 든 답을 claude · codex 출력 모양으로 낸다.
// FAKE_MODE: ok(기본) | codex | fail | sleep | huge | empty. 묶음 머리의 run id 를 그대로 돌려준다.
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', async () => {
  const mode = process.env.FAKE_MODE ?? 'ok';
  const run = /"run"\s*:\s*"([^"]+)"/.exec(input)?.[1] ?? /run[:\s`]+([0-9a-z]+-[0-9a-z]+)/i.exec(input)?.[1] ?? 'unknown';
  const answer = `가짜 실행자의 답입니다(묶음 ${input.length}자).\n\n\`\`\`llmwiki-result\n${JSON.stringify({ run, summary: '가짜 요약', tasks: [{ title: '가짜 할 일' }] })}\n\`\`\`\n`;
  if (mode === 'fail') { process.stderr.write('가짜 실패\n'); process.exit(4); }
  if (mode === 'sleep') await new Promise((r) => setTimeout(r, 60_000));
  if (mode === 'huge') { const chunk = 'x'.repeat(1 << 20); for (let i = 0; i < 40; i++) process.stdout.write(chunk); return; }
  if (mode === 'empty') { process.stdout.write(JSON.stringify({ result: '' })); return; }
  if (mode === 'codex') { process.stdout.write(`${JSON.stringify({ type: 'thread.started' })}\n${JSON.stringify({ item: { text: answer } })}\n`); return; }
  process.stdout.write(JSON.stringify({ result: answer, modelUsage: { 'fake-model-1': {} }, num_turns: 1 }));
});
