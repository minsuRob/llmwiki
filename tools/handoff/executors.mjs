// 위임 실행자 어댑터. 조사·작업은 Claude·Codex 가 맡고, Gemma 는 오라클 서버 큐(oracle.mjs)로, Grok·Muse 등은 같은 모양으로 나중에 붙인다.
// 로컬 Node(tools/handoff/run.mjs)나 Electron 메인에서만 쓴다 — 웹에서는 로컬 CLI·SSH 를 띄울 수 없다.
// 앱 쪽 예산 · 안내는 packages/core/src/executors.ts 가 같은 id 로 정한다.
//
// 어댑터 모양:
//   id, label, kind('cli'|'api'), status('ready'|'planned')
//   command({ bundlePath, workdir, mode, mcpConfig, model }) -> { cmd, args, stdinFile }
//   readOutput(stdout) -> 모델이 쓴 최종 텍스트(여기서 llmwiki-result 블록을 찾는다)

// 조사 위임 기본 권한: 웹 조사·읽기만. 파일 수정·셸 실행은 막는다.
const RESEARCH_TOOLS = ['WebSearch', 'WebFetch', 'Read', 'Grep', 'Glob'];
const BLOCKED_TOOLS = ['Bash', 'Edit', 'Write', 'NotebookEdit'];
// 데스크톱 셸: 웹 조사만. 묶음에 발췌가 다 들어 있으니 로컬 파일을 읽을 이유가 없다(빈 임시 폴더에서 돈다).
const WEB_TOOLS = ['WebSearch', 'WebFetch'];
const WEB_BLOCKED = [...BLOCKED_TOOLS, 'Read', 'Grep', 'Glob'];

export const claude = {
  id: 'claude', label: 'Claude Code', kind: 'cli', status: 'ready',
  // claude -p: 비대화형. 묶음은 표준입력으로 넘겨 명령줄 길이 제한을 피한다.
  // mode: 'research'(터미널) | 'web'(데스크톱)
  command({ bundlePath, mcpConfig, model, mode = 'research' }) {
    const args = ['-p', '--output-format', 'json'];
    if (mode === 'research') args.push('--allowedTools', RESEARCH_TOOLS.join(','), '--disallowedTools', BLOCKED_TOOLS.join(','));
    // web: 사용자 설정의 MCP 서버가 섞이지 않게(--strict-mcp-config), 세션도 남기지 않는다
    if (mode === 'web') args.push('--allowedTools', WEB_TOOLS.join(','), '--disallowedTools', WEB_BLOCKED.join(','), '--strict-mcp-config', '--no-session-persistence');
    if (mcpConfig) args.push('--mcp-config', mcpConfig);
    if (model) args.push('--model', model);
    return { cmd: 'claude', args, stdinFile: bundlePath };
  },
  readOutput(stdout) {
    try { const j = JSON.parse(stdout); return { text: j.result ?? '', meta: { cost_usd: j.total_cost_usd, turns: j.num_turns, session: j.session_id, is_error: j.is_error, model: Object.keys(j.modelUsage ?? {})[0] ?? null } }; }
    catch { return { text: stdout, meta: { parse: 'raw' } }; }
  },
};

export const codex = {
  id: 'codex', label: 'Codex CLI', kind: 'cli', status: 'ready',
  // codex exec: 비대화형. 읽기 전용 샌드박스, 마지막 메시지를 파일로 받는다. ('-' = 표준입력에서 프롬프트)
  command({ bundlePath, workdir, model, lastMessagePath }) {
    const args = ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check'];
    if (workdir) args.push('-C', workdir);
    if (model) args.push('-m', model);
    if (lastMessagePath) args.push('--output-last-message', lastMessagePath);
    args.push('-');
    return { cmd: 'codex', args, stdinFile: bundlePath };
  },
  readOutput(stdout) {
    // --json 은 이벤트 JSONL. 마지막 agent 메시지를 찾는다(형식이 바뀌어도 원문은 남긴다).
    let text = '';
    for (const line of stdout.split('\n')) {
      try { const ev = JSON.parse(line); const msg = ev?.msg ?? ev?.item ?? ev; if (typeof msg?.text === 'string') text = msg.text; else if (typeof msg?.message === 'string') text = msg.message; }
      catch { /* JSONL 이 아닌 줄은 무시 */ }
    }
    return { text: text || stdout, meta: {} };
  },
};

// 나중에 붙일 실행자: 같은 모양만 지키면 된다(API 키·약관 확인 후).
const planned = (id, label) => ({
  id, label, kind: 'api', status: 'planned',
  command() { throw new Error(`${label} 실행자는 아직 연결되지 않았다`); },
  readOutput(stdout) { return { text: stdout, meta: {} }; },
});

// Gemma 는 이 컴퓨터에서 돌지 않는다 — run.mjs 가 oracle.mjs 로 서버 작업 큐에 넣는다.
export const gemma = {
  id: 'gemma', label: 'Gemma (Oracle A1)', kind: 'queue', status: 'ready',
  command() { throw new Error('Gemma 는 oracle.mjs(runGemma)로 돌린다'); },
  readOutput(stdout) { return { text: stdout, meta: {} }; },
};

export const EXECUTORS = { claude, codex, gemma, grok: planned('grok', 'Grok'), muse: planned('muse', 'Muse') };
