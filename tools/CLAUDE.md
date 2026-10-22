# tools — 사용자 컴퓨터에서 도는 것

| 폴더 | 맡은 일 | 시험 |
|---|---|---|
| `llmwiki-mcp/` | **llmwiki MCP 서버**(stdio, 의존성 없음). Claude Code · Codex 가 대화 중에 받은 것에 남기고(`llmwiki_capture`), 페이지 트리를 읽고(`llmwiki_pages` · `llmwiki_read` children: titles · digest · full + cursor — 옛 `llmwiki_work` 는 별칭), 정리 묶음을 받아(`llmwiki_inbox`) 정리 제안을 내고(`llmwiki_propose`), 페이지 본문 제안을 낸다(`llmwiki_propose_page`). 적용 · 삭제 · 옮기기 도구는 없다. core 함수를 그대로 부른다 | `npm run test:mcp`(루트) |
| `local-drive/` 의 시험용 시드 | `npm run local-drive` 는 `.local-drive` 에 예시 원본만 넣는다. 옛 업무(v2) 이행을 미리 해 보려면 `state/items/{id}.json` 을 `DriveFileStore` 로 써 넣고 앱을 연다 | — |
| `handoff/` | 페이지 · 정리 묶음을 Claude CLI · Codex CLI · Gemma(오라클 서버 큐)로 돌리는 실행 본문(`lib.mjs`) · 터미널 진입점(`run.mjs`). 데스크톱 셸도 같은 코드 | `node --test 'tools/handoff/*.test.mjs'` |
| `local-drive/` | 개발용 가짜 Google Drive(127.0.0.1, 이 컴퓨터 폴더). 앱 · MCP · 시험이 실제 Drive 대신 붙는다 | core `localDrive.test.ts` |
| `local-model-eval/` | 로컬 모델(Gemma) 검증 · 작업 큐(`jobd`) · `oci-jobs` MCP | `docs/local-models/` |

## llmwiki MCP 토큰

- 실제 Drive: 앱 설정에서 만든 MCP 열쇠(`lwk_…`)를 `~/.config/llmwiki/mcp-key`(권한 600) 또는 `LLMWIKI_MCP_KEY` 에 → 서버 `mcpDriveToken`(`functions/src/features/mcp.ts`, HTTP Bearer)에서 1시간 토큰. 토큰 받는 코드는 `llmwiki-mcp/server.mjs` 의 `freshToken`. `--token-url` · `--key-file` 로 바꿀 수 있다.
- 개발: `--local-drive http://127.0.0.1:8790` (루트 `npm run local-drive`). 직접 넣기: `LLMWIKI_DRIVE_TOKEN(_CMD)`.
- 비공개 범주는 남기기만, 읽기 · 묶기 · 제안은 `--include-private` 일 때만.
- 호출마다 매니페스트 · 색인 · 자료만 읽는다(본문은 그 페이지를 읽을 때만). 색인이 없으면(앱이 이행 전) 옛 업무 파일을 메모리에서만 페이지로 보이고, 본문 제안은 받지 않는다.
- 열린 문제: 자료(조각)는 호출마다 전부 읽는다(조각이 쌓이면 느려진다).

## 실행자 주의

AI 실행은 이 컴퓨터의 CLI 상태에 달렸다 — Claude CLI 로그인 만료, Codex 기본 모델 설정 같은 고장이 생긴다. 실패하면 `node tools/handoff/run.mjs <실행자> <묶음> --dry-run` 으로 명령을 보고, CLI 를 직접 한 번 불러 원인을 확인한다.
