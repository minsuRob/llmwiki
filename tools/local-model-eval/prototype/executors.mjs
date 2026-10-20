// 위임 실행자 어댑터. 조사·작업은 Claude·Codex 가 맡고, Grok·Muse 등은 같은 모양으로 나중에 붙인다.
// Electron 메인 프로세스(또는 Node)에서만 쓴다 — 웹에서는 로컬 CLI·MCP 를 띄울 수 없다.
//
// 어댑터 모양:
//   id, label, kind('cli'|'api'), status('ready'|'planned')
//   command({ bundlePath, workdir, mode, mcpConfig, model }) -> { cmd, args, stdinFile }
//   readOutput(stdout) -> 모델이 쓴 최종 텍스트(여기서 llmwiki-result 블록을 찾는다)

// 조사 위임 기본 권한: 웹 조사·읽기만. 파일 수정·셸 실행은 막는다.
const RESEARCH_TOOLS = ['WebSearch', 'WebFetch', 'Read', 'Grep', 'Glob'];
const BLOCKED_TOOLS = ['Bash', 'Edit', 'Write', 'NotebookEdit'];

export const claude = {
  id: 'claude', label: 'Claude Code', kind: 'cli', status: 'ready',
  // claude -p: 비대화형. 묶음은 표준입력으로 넘겨 명령줄 길이 제한을 피한다.
  command({ bundlePath, mcpConfig, model, mode = 'research' }) {
    const args = ['-p', '--output-format', 'json'];
    if (mode === 'research') args.push('--allowedTools', RESEARCH_TOOLS.join(','), '--disallowedTools', BLOCKED_TOOLS.join(','));
    if (mcpConfig) args.push('--mcp-config', mcpConfig);
    if (model) args.push('--model', model);
    return { cmd: 'claude', args, stdinFile: bundlePath };
  },
  readOutput(stdout) {
    try { const j = JSON.parse(stdout); return { text: j.result ?? '', meta: { cost_usd: j.total_cost_usd, turns: j.num_turns, session: j.session_id, is_error: j.is_error } }; }
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

export const EXECUTORS = { claude, codex, grok: planned('grok', 'Grok'), muse: planned('muse', 'Muse') };
