# llmwiki — 색인

AI 와 같이 쓰는 개인 위키. 사용자가 Claude · Codex 와 얘기하다 남기고 싶은 것을 던지면(받은 것), AI 가 정리를 **제안**하고 사람이 받기 · 빼기로 확정한다. 데이터는 사용자 Google Drive 에 있다. 사용자에게는 한국어로 답한다.

**이 파일은 색인이다.** 문서를 통째로 읽지 말고, 아래 지도에서 할 일에 맞는 곳만 찾아가라. 각 폴더의 `CLAUDE.md` 는 그 폴더 파일을 다룰 때 자동으로 읽힌다 — 거기에 그 영역의 파일 지도 · 규칙 · 시험이 있다.

## 지도 — 무엇을 바꾸려면 어디로

| 하려는 일 | 먼저 볼 곳 | 영역 안내 |
|---|---|---|
| 업무 · 조각(받은 것) · 정리 제안 · 범주 규칙 | `packages/core/src/work.ts` | `packages/core/CLAUDE.md` |
| AI 맥락 묶음 · 결과 가져오기 · 정리 묶음 | `packages/core/src/workHandoff.ts` · `workTriage.ts` | `packages/core/CLAUDE.md` |
| Drive 저장 · 충돌 · 이행 | `packages/core/src/workStore.ts` · `drive.ts` | `packages/core/CLAUDE.md` |
| 화면(오늘 · 업무 · 보관함 · 설정) | `aria-rn/src/features/work/` | `aria-rn/CLAUDE.md` → `aria-rn/src/features/work/CLAUDE.md` |
| 편집기(Lexical) · 리치 텍스트 뷰어 | `aria-rn/src/features/editor/` | `aria-rn/src/features/editor/CLAUDE.md` |
| 서버 함수 · Drive 열쇠 · MCP 열쇠 | `functions/src/features/` | `functions/CLAUDE.md` |
| MCP 서버 · AI 실행 도구 · 로컬 Drive | `tools/` | `tools/CLAUDE.md` |
| 데스크톱 셸(Electron, 동결) | `desktop/` | `desktop/CLAUDE.md` |
| 원칙 · 데이터 위치 · 열쇠 보관 규칙 | `docs/architecture.md` (원칙 1~8 · 원칙 4 표) | — |
| 받은 것 설계 · 진행 · 열린 문제 | `docs/inbox-today.md` | — |
| Google OAuth 검증 상태 | `docs/google-verification.md` | — |

`docs/archive/` 는 지난 지시문 · 분석이다. 지금 구조와 다를 수 있으니 근거로 쓰지 마라.

## 정한 방향(바꾸지 마라)

- **AI 는 제안, 확정은 사람.** 확정 · 삭제 · 상태 전환 · 범주 생성은 사람만. AI 결과는 언제나 제안으로 들어오고 검사(근거 줄 · 지시문 · 확정 필드)를 거친다.
- **AI 제안은 범주를 넘지 못한다.** `packages/core/src/work.ts` 의 `proposeTriage` 가 `cross_workspace` 로 거른다. 다른 범주로 잇는 것은 사람이 확인해서만.
- **규칙은 `packages/core` 한 곳.** 앱 단추 · MCP · 서버가 같은 core 함수를 부른다. 화면이나 서버에 규칙을 따로 쓰지 않는다.
- **서버는 AI API 를 쓰지 않는다.** AI 는 사용자 컴퓨터의 Claude Code · Codex 세션이 켜져 있을 때만(MCP · 맥락 묶음). 서버 자동 정리 · 예약 정리는 하지 않는다.
- **데이터는 사용자 Drive**(`llmwiki 작업실`, `drive.file` 범위). 서버는 Drive 내용을 저장 · 색인 · 로그하지 않는다. 새 서버 읽기 · 열쇠 규칙은 `docs/architecture.md` 원칙 4 표에 먼저 적고 구현한다.
- **PC 먼저.** 웹 앱 + MCP. 폰은 던지기 · 확정만(공유 시트 보류). 데스크톱 셸은 동결.

## 용어 — 같은 것을 여러 이름으로 부른다

| 코드 | 화면 | 문서 | 뜻 |
|---|---|---|---|
| `Workspace` | 주제 | 범주 · 작업실 | 개인 · 회사 · 개발 · 독서 — 사람만 만든다. 업무 · 조각은 하나에 속한다 |
| `WorkItem` | 업무 | 업무 | 범주 바로 아래(영역 층은 없앴다) |
| `Source`(`triage` 있음) | 받은 것 · 조각 · 자료 | 조각 | 던진 메모 · 링크 · Drive 파일. `triage`: inbox · filed · dismissed |
| `TriageProposal` | 정리 제안 | 정리 제안 | 매니페스트 `triage[]`. file_source · new_work · concept_link |
| `Proposal` | 확인 · 결정할 것 | 검토 카드 | 업무 안의 할 일 · 마감 · 최신본 제안(맥락 묶음 결과) |
| `aria-rn` | — | 앱 | 폴더 이름만 옛것(Aria 를 옮겨 시작했다) |

## 명령

```bash
npm run test:core        # 규칙(packages/core) — 바꾸면 먼저
npm run test:functions   # 서버 단위
npm run test:mcp         # MCP 서버(로컬 Drive 에 붙여 실제 호출)
npm run test:api         # 에뮬레이터 통합(포트가 겹치면 functions/CLAUDE.md 참고)
npm --prefix aria-rn run typecheck && npm --prefix aria-rn run lint   # 린트 기존 오류 13개는 무관
npm run deploy:web       # 웹만 · npm run deploy 는 hosting + functions + firestore
```

- 화면을 바꾸면 브라우저로 확인한다. 개발 서버: `npm --prefix aria-rn run web:emulator`(에뮬레이터) · 로컬 Drive 는 `npm run local-drive` + `EXPO_PUBLIC_LOCAL_DRIVE_URL=http://127.0.0.1:8790`(`.claude/launch.json` 은 이 컴퓨터에만 있다).
- 커밋은 기능 브랜치에서, 시험이 통과한 뒤 main 에. **배포 · 푸시는 사용자 확인 뒤.**
