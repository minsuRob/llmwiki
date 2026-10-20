// claude · codex 실행 파일 찾기 — macOS 앱은 셸의 PATH 를 받지 못해, 로그인 셸에 한 번 묻는다(고정 문자열, 사용자 입력 없음).
// userData/config.json 의 { "claudePath", "codexPath" } 로 덮어쓸 수 있다.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const run = (cmd, args, timeout = 8000, env) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, env }, (err, stdout) => resolve(err ? null : String(stdout)));
});

const PROBE = 'printf "%s\\n" "$PATH"; command -v claude || echo -; command -v codex || echo -';

/** → { path: PATH 문자열, claude: 경로|null, codex: 경로|null } */
export async function findExecutables(configFile) {
  let cfg = {};
  try {
    cfg = configFile && existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {};
  } catch {
    cfg = {};
  }
  const shell = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
  const out = (await run(shell, ['-lc', PROBE])) ?? '';
  const lines = out.trim().split('\n');
  const [path, claude, codex] = lines.slice(-3); // 로그인 셸이 앞에 다른 글을 찍어도 끝 세 줄만
  const pick = (override, found) => (typeof override === 'string' && existsSync(override) ? override : found && found !== '-' && found.startsWith('/') ? found : null);
  return {
    path: path && path.includes('/') ? path : process.env.PATH ?? '/usr/bin:/bin',
    claude: pick(cfg.claudePath, claude),
    codex: pick(cfg.codexPath, codex),
  };
}

export async function versionOf(bin, env) {
  if (!bin) return undefined;
  const v = await run(bin, ['--version'], 8000, env);
  return v ? v.trim().split('\n')[0].slice(0, 60) : undefined;
}

/** 자식 프로세스에 넘길 최소 환경 — ELECTRON_* · NODE_OPTIONS 는 넘기지 않는다 */
export function childEnv(path, extra = {}) {
  const keep = ['HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SSH_AUTH_SOCK', 'SHELL'];
  const env = { PATH: path };
  for (const k of keep) if (process.env[k]) env[k] = process.env[k];
  return { ...env, ...extra };
}
