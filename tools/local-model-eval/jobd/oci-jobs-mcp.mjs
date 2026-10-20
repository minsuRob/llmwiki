#!/usr/bin/env node
// Oracle A1 실험 작업 큐 MCP 서버 (stdio, 의존성 없음).
// Claude Code·Claude Desktop 이 오래 걸리는 실험을 제출하고, 상태를 보고, 결과를 가져온다.
// 실제 실행은 서버의 jobd.py 가 정해진 작업 종류만 돌린다(임의 명령 없음). 접속은 ~/.ssh/config 의 호스트 별칭을 쓴다.
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = process.env.OCI_JOBS_HOST ?? 'oci-a1';
const LOCAL_RESULTS = process.env.OCI_JOBS_RESULTS ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'results', 'raw');
const ID = /^[0-9]{4}-[0-9]{6}-[0-9a-f]{4}$/;
const KIND = /^[a-z_]+$/;

const run = (cmd, args, timeout = 120_000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, maxBuffer: 16 << 20 }, (err, stdout, stderr) => resolve({ ok: !err, stdout, stderr: stderr || String(err ?? '') }));
});
const jobd = (...args) => run('ssh', ['-o', 'ConnectTimeout=10', HOST, 'python3', '~/lwe/jobd/jobd.py', ...args]);

const TOOLS = [
  { name: 'oci_job_kinds', description: '실행할 수 있는 실험 작업 종류와 예상 시간(분)을 보여 준다.', inputSchema: { type: 'object', properties: {} } },
  { name: 'oci_job_submit', description: '실험 작업 하나를 서버 큐에 넣는다. 작업자는 한 번에 하나씩, 필요한 모델(Gemma)을 켜고 끄며 실행한다.',
    inputSchema: { type: 'object', properties: { kind: { type: 'string', description: 'oci_job_kinds 의 이름' } }, required: ['kind'] } },
  { name: 'oci_job_status', description: '큐·실행·완료 목록(서버 메모리·Gemma 상태 포함). id 를 주면 그 작업만.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
  { name: 'oci_job_result', description: '완료된 작업의 기록(단계별 시간·최대 RSS·최저 여유 메모리)과 로그 끝부분.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'oci_job_cancel', description: '대기 중인 작업을 빼거나 실행 중인 작업을 멈춘다.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'oci_fetch_results', description: '서버의 원시 결과(results/raw)를 로컬로 가져온다.', inputSchema: { type: 'object', properties: {} } },
];

async function call(name, a = {}) {
  switch (name) {
    case 'oci_job_kinds': return jobd('kinds');
    case 'oci_job_submit':
      if (!KIND.test(a.kind ?? '')) return { ok: false, stdout: '', stderr: 'kind 형식 오류' };
      return jobd('submit', a.kind);
    case 'oci_job_status':
      if (a.id && !ID.test(a.id)) return { ok: false, stdout: '', stderr: 'id 형식 오류' };
      return a.id ? jobd('status', a.id) : jobd('status');
    case 'oci_job_result':
    case 'oci_job_cancel':
      if (!ID.test(a.id ?? '')) return { ok: false, stdout: '', stderr: 'id 형식 오류' };
      return jobd(name === 'oci_job_result' ? 'result' : 'cancel', a.id);
    case 'oci_fetch_results':
      await mkdir(LOCAL_RESULTS, { recursive: true });
      return run('rsync', ['-a', '--exclude', '*.log', `${HOST}:lwe/results/raw/`, `${LOCAL_RESULTS}/`], 600_000)
        .then((r) => ({ ...r, stdout: r.ok ? `가져옴 → ${LOCAL_RESULTS}` : r.stdout }));
    default: return { ok: false, stdout: '', stderr: `모르는 도구: ${name}` };
  }
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return; // 알림(notifications/*)은 답하지 않는다
  if (method === 'initialize') {
    return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} },
      serverInfo: { name: 'oci-jobs', version: '0.1.0' } } });
  }
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    const r = await call(params?.name, params?.arguments ?? {});
    return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: (r.stdout || r.stderr).trim() }], isError: !r.ok } });
  }
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
});
