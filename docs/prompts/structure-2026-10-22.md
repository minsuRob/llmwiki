# llmwiki 구조 브리핑 — 2026-10-22 변경분

> 지금은 루트 `CLAUDE.md`(색인)와 폴더별 `CLAUDE.md` 가 이 내용을 나눠 가진다. 빈 세션은 따로 붙이지 않아도 된다 — 다른 도구에 한 번에 넘길 때만 쓴다.

다른 Claude · Codex 세션에 이 저장소 작업을 맡길 때 맨 앞에 붙이는 프롬프트. 자세한 근거는 `docs/inbox-today.md` · `docs/architecture.md`.

```text
너는 llmwiki 저장소(/Users/robert/Desktop/Workspace/Personal/llmwiki)에서 일한다. 2026-10-22 에 구조가 크게 바뀌었으니 아래를 전제로 작업해라. 사용자에게는 한국어로 답한다.

## 컨셉
llmwiki 는 "할 일 관리 앱"이 아니라 "AI 와 같이 쓰는 위키"다.
사용자는 Claude · Codex 와 얘기하다 남기고 싶은 것을 부담 없이 던진다(묻지 않는다) → AI 가 정리를 '제안'한다 → 사람은 받기 · 빼기만 한다.
개발 우선순위는 PC(웹 앱 + MCP)다. 폰은 던지기 · 확정만 하는 곳이고, 공유 시트 작업은 보류(브랜치 claude/vigilant-curie-0d111d, 병합 안 함).

## 데이터 구조(packages/core/src/work.ts, 스키마 2)
- 범주(Workspace) → 업무(WorkItem). 영역(Area) 층은 없앴다(areaId 없음, 이행 시 지운다).
- 범주는 사람만 만든다. 새 사용자 기본값: 개인 · 회사(비공개) · 개발 · 독서. 기존 사용자의 저장된 범주는 건드리지 않는다.
- 조각 = Source. 새 필드: triage("inbox" | "filed" | "dismissed", 없으면 filed) · origin({via: app|share|mcp, tool}) · concepts(받아들인 개념 이름).
- 정리 제안 = TriageProposal(kind: file_source | new_work | concept_link). 업무 proposals 가 아니라 매니페스트의 triage 배열에 둔다. 정리 묶음 기록은 매니페스트 triageRuns(S1 · W1 이름을 실제 id 로 되짚는다).
- 핵심 함수: inboxSources · fragmentState · proposeTriage(범주를 넘는 제안 · 없는 조각/업무 · 빈 칸 · 중복은 들이지 않고, 근거 없으면 표시) · acceptTriage · rejectTriage · dismissSource · restoreSource · fileSource(손으로 잇기) · moveSource · moveWorkItem · mergeTriage.
- 정리 묶음/가져오기: packages/core/src/workTriage.ts(prepareTriage · parseTriage · importTriage). 형식은 ```llmwiki-triage 블록. 없는 줄 근거는 빼고 bad_refs, 지시문은 injection_suspect, 확정 필드는 무시.

## 원칙(바꾸지 마라)
- AI 가 낸 것은 언제나 제안. 확정 · 삭제 · 상태 전환 · 범주 생성은 사람만.
- 앱 버튼과 MCP 는 같은 core 함수를 부른다. 규칙을 화면이나 서버에 따로 쓰지 않는다.
- 업무 데이터 원본은 사용자 Google Drive('llmwiki 작업실', drive.file 범위). 서버는 Drive 내용을 저장 · 색인 · 로그하지 않는다.
- 새 서버 읽기 · 열쇠 규칙은 docs/architecture.md 원칙 4 표에 먼저 적고 구현한다.
- 서버(Functions)는 AI API 를 부르지 않는다(Anthropic SDK · API 키 없음). 대화 · 시냅스는 규칙 길만. AI 작업은 사용자 컴퓨터의 Claude Code · Codex 세션(MCP · 맥락 묶음)이 맡는다.

## 화면(aria-rn)
- 오늘 탭 = 받은 것 중심: 범주 칩 → 입력란(남기기, 묻지 않음) → 받은 것 흐름(정리 대기 · 제안 있음 · 엮임 · 뺌, 'Claude 에게 정리 맡기기') → 판단이 필요해요 → 오늘 위키에 더해진 것 → 이어서 할 업무(한 업무는 한 번).
- 추천 · 가까운 마감은 업무 탭 맨 위(PlanCards.tsx). 업무 목록은 상태별로 묶는다.
- + 단추(QuickAdd)는 오늘 화면에서 숨김. 업무 상세에선 그 업무에 바로 잇고, 그 밖에선 받은 것으로.
- 설정 → Drive: 'MCP 열쇠' 카드(만들기 · 한 번만 보이는 열쇠 · 거두기). 로그인 · 설정 하단에 소개 · 개인정보처리방침 · 이용약관 링크.

## MCP(tools/llmwiki-mcp/server.mjs, stdio, 의존성 없음, 사용자 컴퓨터에서 Claude Code 가 띄운다)
- 도구: llmwiki_workspaces · llmwiki_capture(범주 필수) · llmwiki_work · llmwiki_read · llmwiki_inbox(정리 묶음 + run) · llmwiki_propose(run + triage[]). 확정 · 삭제 도구는 없다.
- 비공개 범주는 남기기만, 읽기 · 묶기 · 제안은 --include-private 일 때만.
- 실제 Drive 토큰: 설정에서 만든 MCP 열쇠(lwk_<id>.<secret>)를 ~/.config/llmwiki/mcp-key(권한 600) 또는 LLMWIKI_MCP_KEY 에 두면, 서버 mcpDriveToken 에서 1시간 access token 만 받는다(refresh token 은 서버 밖으로 안 나감). 개발은 --local-drive http://127.0.0.1:8790.
- 등록: claude mcp add llmwiki -- node <저장소>/tools/llmwiki-mcp/server.mjs

## 서버(functions/src)
- features/mcp.ts: mcpKeyCreate(Google 로그인 + 서버에 Drive 를 이은 사용자, 5개까지) · mcpKeyList · mcpKeyRevoke · mcpDriveToken(HTTP, Bearer 열쇠). 열쇠는 SHA-256 해시만 mcpKeys/{id} 에 저장, 앱은 못 읽음. driveUnlink 는 MCP 열쇠도 지운다.
- mcpKeys.ts: 열쇠 모양 · 해시 · 시간 일정 비교(순수 함수).

## 동시 쓰기(앱 + MCP 가 같은 매니페스트를 번갈아 쓴다)
- DriveFileStore 는 목록에서 본 버전을 바로 다음 읽기 한 번만 믿는다(그 뒤엔 다시 찾는다).
- 매니페스트 저장은 WorkRepo.saveManifestWith(cur, fn) — 충돌하면 최신본에 fn 을 다시 적용(최대 3번, 사본 없음). 정리 제안은 mergeTriage 로 합친다.
- Drive 저장은 4~8초 걸린다. 화면은 먼저 바뀌므로 저장 완료 전 새로 고침에 주의.

## 공개 페이지 · Google 검증
- aria-rn/public/{about,privacy,terms}.html(로그인 없이, 한국어+영어), firebase.json rewrites 로 /about · /privacy · /terms. cleanUrls 는 쓰지 않는다(Search Console 확인 파일 google669b85aaa8d5054c.html 이 리다이렉트 없이 열려야 함 — 지우지 마라).
- OAuth 앱은 이미 프로덕션 · 외부. 데이터 액세스: drive.file · userinfo.email · userinfo.profile · openid(모두 민감하지 않음). 브랜딩: 홈 · 방침 · 약관 · 승인 도메인 입력 완료, 로고는 Expo 템플릿 아이콘이라 안 올림. 진행: docs/google-verification.md.

## 데스크톱 셸(desktop/)
- 배포된 웹을 띄우고 Claude · Codex · Gemma 실행만 더하는 얇은 껍데기. MCP 가 생겨 우선순위는 낮다(동결, 지우지 않음). 받은 것 정리 실행은 기존 브리지에 itemId 'triage-<범주>' 로 실린다(셸 변경 없음).

## 시험 · 배포
- npm run test:core · test:functions · test:mcp, aria-rn 에서 npx tsc --noEmit · npx expo lint(기존 오류 13개는 이번 일과 무관).
- 에뮬레이터 통합: npm run test:api(다른 세션 에뮬레이터와 포트가 겹치면 포트를 바꾼 임시 설정으로).
- 배포: npm run deploy(전체) · npm run deploy:web(웹만). 배포 · 푸시는 사용자 확인 뒤.

## 열린 문제
- MCP 는 도구 호출마다 작업실 전체를 다시 읽는다 — 조각이 많아지면 도구별로 필요한 것만 읽기 · 짧은 캐시가 필요.
- mcpDriveToken 에 열쇠별 호출 한도 없음.
- 개념은 조각의 concepts 이름으로만 — 시냅스 그래프와 합치기 전.
- 엮인 조각이 흐름에서 사라지는 기준(지금은 하루).
- Claude CLI 로그인 만료 · Codex 기본 모델 미지원으로 실제 AI 왕복 정리 검증은 아직.
```
