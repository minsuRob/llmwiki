# 로컬 실행 · MCP 등록

> 2026-11-01 정리. 색인: [INFRA.md](../../INFRA.md). 시험 명령은 [CLAUDE.md](../../CLAUDE.md) "명령".

## 포트

| 무엇 | 포트 | 명령 |
|---|---|---|
| 웹 개발 서버(Expo) | 8081 | `npm --prefix aria-rn run web` · 에뮬레이터에 붙이면 `web:emulator` |
| 로컬 Drive(가짜 Drive, `.local-drive/`) | 8790 | `npm run local-drive` → 앱은 `EXPO_PUBLIC_LOCAL_DRIVE_URL=http://127.0.0.1:8790` |
| Firebase 에뮬레이터 | 9099 · 8080 · 5001 · 4400 · 4500 | `npm run emulators` — 포트가 겹치면 [functions/CLAUDE.md](../../functions/CLAUDE.md) |

`.claude/launch.json`(브라우저 미리보기용)은 이 컴퓨터에만 있다(`.claude/` 는 gitignore).

## 로컬에만 있는 파일

| 파일 | 내용 |
|---|---|
| `aria-rn/.env.local` | OAuth 클라이언트 ID · Picker API 키 — [google-cloud.md](google-cloud.md) |
| `functions/.env` | 함수 로컬 설정(있을 때) |
| `~/.config/llmwiki/mcp-key` | llmwiki MCP 열쇠 `lwk_…` (권한 600). 앱 설정에서 만든다 |
| `~/Library/Application Support/llmwiki/config.json` | 데스크톱 셸의 `claudePath` · `codexPath` |

## MCP 등록 (Claude Code)

2026-11-01 기준 이 폴더에는 둘 다 등록돼 있지 않다(`claude mcp list` 로 확인). 아래 명령은 저장소 루트에서 실행한다(`$PWD` 가 저장소 경로).

llmwiki MCP — 실제 Drive(열쇠 파일 사용):

```bash
claude mcp add llmwiki -s local -- node "$PWD/tools/llmwiki-mcp/server.mjs"
```

oci-jobs MCP — 오라클 서버 작업 큐(`ssh oci-a1` 이 먼저 돼야 한다):

```bash
claude mcp add oci-jobs -s local -- node "$PWD/tools/local-model-eval/jobd/oci-jobs-mcp.mjs"
```

- 개발용 로컬 Drive 에 붙이려면 llmwiki MCP 뒤에 `--local-drive http://127.0.0.1:8790`.
- 도구 목록 · 토큰 흐름: [tools/CLAUDE.md](../../tools/CLAUDE.md).

## 실행자 CLI

Claude CLI 로그인 만료 · Codex 미설치(이 맥) 같은 고장이 잦다. 확인: `node tools/handoff/run.mjs <claude|codex|gemma> <묶음> --dry-run`.
