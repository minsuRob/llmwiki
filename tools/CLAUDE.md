# tools — 사용자 컴퓨터에서 도는 것

| 폴더 | 맡은 일 | 시험 |
|---|---|---|
| `llmwiki-mcp/` | **llmwiki MCP 서버**(stdio, 의존성 없음). Claude Code · Codex 가 대화 중에 받은 것에 남기고(`llmwiki_capture`), 업무를 읽고(`llmwiki_work` · `llmwiki_read`), 정리 묶음을 받아(`llmwiki_inbox`) 제안을 낸다(`llmwiki_propose`). 확정 · 삭제 도구는 없다. core 함수를 그대로 부른다 | `npm run test:mcp`(루트) |
| `handoff/` | 맥락 묶음을 Claude CLI · Codex CLI · Gemma(오라클 서버 큐)로 돌리는 실행 본문(`lib.mjs`) · 터미널 진입점(`run.mjs`). 데스크톱 셸도 같은 코드 | `node --test 'tools/handoff/*.test.mjs'` |
| `local-drive/` | 개발용 가짜 Google Drive(127.0.0.1, 이 컴퓨터 폴더). 앱 · MCP · 시험이 실제 Drive 대신 붙는다 | core `localDrive.test.ts` |
| `local-model-eval/` | 로컬 모델(Gemma) 검증 · 작업 큐(`jobd`) · `oci-jobs` MCP | `docs/local-models/` |

## llmwiki MCP 토큰

- 실제 Drive: 앱 설정에서 만든 MCP 열쇠(`lwk_…`)를 `~/.config/llmwiki/mcp-key`(권한 600) 또는 `LLMWIKI_MCP_KEY` 에 → 서버 `mcpDriveToken`(`functions/src/features/mcp.ts`, HTTP Bearer)에서 1시간 토큰. 토큰 받는 코드는 `llmwiki-mcp/server.mjs` 의 `freshToken`. `--token-url` · `--key-file` 로 바꿀 수 있다.
- 개발: `--local-drive http://127.0.0.1:8790` (루트 `npm run local-drive`). 직접 넣기: `LLMWIKI_DRIVE_TOKEN(_CMD)`.
- 비공개 범주는 남기기만, 읽기 · 묶기 · 제안은 `--include-private` 일 때만.
- 열린 문제: 도구 호출마다 작업실 전체를 다시 읽는다(조각이 쌓이면 느려진다).

## 실행자 주의

AI 실행은 이 컴퓨터의 CLI 상태에 달렸다 — Claude CLI 로그인 만료, Codex 기본 모델 설정 같은 고장이 생긴다. 실패하면 `node tools/handoff/run.mjs <실행자> <묶음> --dry-run` 으로 명령을 보고, CLI 를 직접 한 번 불러 원인을 확인한다.
