# llmwiki 구조와 원칙

> 2026-10-20 정리. 바꿀 때는 이 문서부터 고치고 코드를 맞춘다.

## 세 역할

| 역할 | 하는 일 | 코드 |
|---|---|---|
| ① 앱 — 업무 관리 | 목표 · 현재 상태 · 결정 · 다음 할 일 · 최신 결과물을 보여 주고, 사람이 확정한다 | `aria-rn/src/features/work` · 규칙 `packages/core/src/work*.ts` |
| ② AI — 작업 | Claude · Codex · Gemma 가 맥락 묶음을 받아 일하고 `llmwiki-result` 로 돌려준다 | `packages/core/src/workHandoff.ts` · `executors.ts` · `tools/handoff` |
| ③ Google Drive — 보관 | 업무 상태 · 원본 자료 · 결과 원문 · 사람이 읽는 요약을 사용자의 Drive 에 둔다 | `packages/core/src/drive.ts` · `workStore.ts` |

흐름: 업무 선택 → 맥락 묶음 → AI 작업 → 결과 가져오기(검사 · 제안) → 사람이 확정 → Drive 에 저장 → 다음 위임의 맥락.

받은 것 흐름(2026-10-22, 설계 `docs/inbox-today.md`): 대화 중 조각 던지기(앱 입력란 · + · MCP) → 정리 대기 → 정리 묶음(조각 S1 · 업무 W1) → AI 정리 제안(잇기 · 새 업무 · 개념) → 사람이 받기 · 빼기 → 업무에 엮임. 범주(개인 · 회사 · 개발 · 독서 …)는 사람만 만들고, 범주 바로 아래가 업무다(영역 층 없음).

## 원칙

### 1. 판단은 사람이, 규칙은 한 곳에서
- AI 가 낸 것(결정 · 할 일 · 마감 변경 · 최신본)은 **언제나 제안**이다. 확정 · 완료 · 상태 전환은 사람만 한다. 결과에 `status` · `confirmed` 같은 필드가 오면 무시하고 표시한다.
- 앱 단추와 AI 요청(대화 · MCP)은 **같은 core 함수**를 부른다. 규칙을 화면이나 서버에 따로 쓰지 않는다.
- 서버(Functions)는 AI API 를 부르지 않는다. AI 는 사용자 컴퓨터의 Claude Code · Codex 세션만 쓴다(MCP · 맥락 묶음). API 키를 어디에도 두지 않는다.
- 검사에 걸린 결과도 버리지 않는다. 원문을 먼저 저장하고 경고(flags · attention)로 보인다 — 판단은 사람이 한다.

### 2. 데이터는 사용자 Drive 에, 서버는 운영 정보만
- 업무 데이터의 원본은 **사용자의 Google Drive**(`llmwiki 작업실/`)다. Drive 를 잇지 않았으면 기기 저장소.
- 서버(Functions · Firestore)가 가져도 되는 것은 **운영 정보**뿐이다:
  - 사용자 식별(Firebase Auth)
  - 암호화된 Drive 열쇠와 그 메타(연결 시각 · 마지막 사용 · 범위 · 계정 이메일) — 아래 4
  - 기존 기능(대화 · 할일 · 일정 · 기록 · 시냅스)과 참고용 취준 공고 — 작업실로 옮기기 전까지 그대로 둔다
- 서버는 **Drive 내용을 저장 · 색인 · 로그하지 않는다**. 읽어야 할 때는 그때 읽고 응답으로만 돌려준다(통과만).
- Firestore 에 새 컬렉션을 만들기 전에 Drive 나 원본 유지로 되는지 먼저 따지고, 이유를 이 문서에 적는다.

### 3. 권한은 가장 좁게
- Drive 범위는 `drive.file` 하나(+ 계정 확인용 `openid` · `email`). 앱이 만든 파일과 사용자가 Picker 로 고른 파일만 보인다. 더 넓은 범위가 오면 저장하지 않고 폐기한다.
- 앱(브라우저)은 Firestore 를 읽기만 한다. 쓰기는 함수만.
- 서버가 Drive 를 읽는 기능은 **Google 로그인 사용자**에게만 연다(익명 계정은 열쇠의 주인을 확인할 수 없다).

### 4. Drive 열쇠(refresh token)를 서버가 보관할 때
보관 이유: 새 탭 · 토큰 만료 때 다시 묻지 않고, 앞으로 MCP · Gemma 연결부가 사용자 Drive 를 읽게 하려고.

| 규칙 | 구현 |
|---|---|
| 평문으로 두지 않는다 | AES-256-GCM, 사용자 uid 를 덧붙인 데이터(AAD)로 묶어 다른 사용자 문서로 옮기면 풀리지 않는다. 키는 Functions secret `DRIVE_TOKEN_KEY` |
| 앱은 열쇠를 볼 수 없다 | `driveLinks/{uid}` — Firestore 규칙상 클라이언트 접근 불가. 앱은 1시간짜리 access token 만 받는다 |
| 클라이언트 시크릿은 서버에만 | Functions secret `GOOGLE_OAUTH_CLIENT_SECRET`. 코드 · 저장소 · 로그에 없다 |
| 한 사용자 = 열쇠 하나 | 다시 이으면 이전 열쇠를 Google 에서 거둔다 |
| 언제든 끊을 수 있다 | 'Drive 연결 해제' = Google 에서 폐기 + 서버 보관본 삭제. Google 계정에서 거두면(invalid_grant) 다음 사용 때 보관본을 바로 지운다 |
| 남기는 기록 | 연결 · 해제 · 서버 읽기의 사실(uid · 동작 · 개수)만 Cloud Logging 에. 토큰 · 파일 내용은 남기지 않는다 |
| 서버가 읽는 범위 | 지금은 업무 목록(제목 · 상태)만(`driveListWork`). 새 서버 읽기를 더할 때는 무엇을 읽고 무엇을 돌려주는지 이 표에 먼저 적는다 |
| MCP 에 내주는 것(`mcpDriveToken`) | **1시간 access token 만**. refresh token 은 서버 밖으로 나가지 않는다. 이 컴퓨터의 MCP(`tools/llmwiki-mcp`)는 'MCP 열쇠'로 이 토큰을 받는다 |
| MCP 열쇠 | 설정(Google 로그인 · 서버에 Drive 를 이은 사용자)에서 만들고 **한 번만** 보인다. 서버엔 SHA-256 해시만(`mcpKeys/{id}` — 규칙상 앱이 읽을 수 없다). 사용자당 5개, 이름 · 만든 시각 · 마지막 사용만 보인다 |
| MCP 열쇠 거두기 | 설정에서 거두면 바로 막힌다(문서 삭제). 'Drive 연결 해제'는 그 사용자의 MCP 열쇠도 모두 지운다 |
| MCP 열쇠 보관(이 컴퓨터) | `~/.config/llmwiki/mcp-key`(다른 사용자가 읽을 수 있는 권한이면 MCP 가 쓰지 않는다) 또는 환경 변수 `LLMWIKI_MCP_KEY` |
| MCP 가 하는 Drive 일 | access token 범위는 앱과 같은 `drive.file`(앱이 만든 파일만). MCP 코드는 받은 것 남기기 · 매니페스트(정리 제안) · 원문(raw/)만 쓴다. 열쇠가 새면 거두기 |
| MCP 기록 | 열쇠 발급 · 거두기 · 토큰 발급의 사실(uid · 열쇠 id · 동작)만. 열쇠 · 토큰 · Drive 내용은 남기지 않는다 |

브라우저 쪽: access token 은 이 탭의 sessionStorage 에 만료 시각과 함께(탭을 닫으면 사라짐). 끝나기 2분 전에 서버에서 새로 받는다. 서버 열쇠가 없으면(익명 등) 만료 때 화면 위 알림에서 한 번 눌러 다시 받는다.

### 5. 실행자(AI)
- 실행자마다 자료 예산이 다르다(Claude · Codex 2만 자, Gemma 5천 자). 넘치는 자료는 통째로 빼고 이름을 남긴다.
- 자료 발췌에는 줄 번호(`S1:12`)를 붙이고, AI 는 `refs` 로 근거를 댄다. 근거 줄에 없는 마감 · 없는 근거는 표시한다.
- 자료 속 지시문은 데이터일 뿐이다. 결과에 지시문으로 보이는 말이 있으면 표시하고, AI 가 그것을 `unverified` 로 보고한 것은 따로 알린다.
- Gemma 는 오라클 서버 작업 큐(`jobd`)에서 정해진 작업만 돈다. 임의 명령은 받지 않는다.

### 6. 데스크톱 셸(Electron) — 실행만 맡는 얇은 껍데기
웹은 로컬 CLI · SSH 를 띄울 수 없다. 데스크톱 셸(`desktop/`)은 배포된 웹(`https://llmwiki-minsu.web.app`)을 그대로 띄우고, **정해진 실행자 3개(Claude · Codex · Gemma)에 묶음 하나를 넘기는 일**만 더한다. 구현 지시: `docs/archive/prompts/electron-shell.md`.

| 셸이 하는 것 | 셸이 하지 않는 것 |
|---|---|
| 실행자 실행 · 상태 · 취소(`tools/handoff/lib.mjs` — 터미널 `run.mjs` 와 같은 코드) | 화면을 묶어 배포(화면은 웹 배포로만 바뀐다) |
| 보내기 전 네이티브 확인 창(실행자 · 받는 곳 · 크기) — 매번, Gemma 포함 | 결과 해석 · 검사 · 확정(웹의 core `importResult` 가 한다 → 제안) |
| 허용 origin 밖 탐색 · 새 창 · 권한 요청 차단, 브리지는 메인 창 최상위 프레임에만 | 임의 명령 · 임의 실행 파일 · 임의 인자 받기 |
| 앱이 아직 받지 않은 결과를 기기(`userData/runs/`)에 잠시 보관 — 앱이 받으면(ack) 바로 지우고, 늦어도 30일 | Firebase · Drive 토큰 보관 · 대신 호출, 업무 데이터 저장 · 동기화 |

- 브리지 `window.llmwikiDesktop` 이 없으면(그냥 브라우저) 지금처럼 복사 · 내보내기 + 명령 안내. 브리지 계약은 `apiVersion` 으로 맞추고 더하기만 하는 변경은 버전을 올리지 않는다.
- 데스크톱의 Claude 는 웹 조사만(`WebSearch` · `WebFetch`) — 로컬 파일 읽기 도구를 주지 않고 빈 임시 폴더에서 돈다. 묶음에 필요한 발췌가 다 들어 있다.
- 로그에는 runId · 실행자 · 상태 · 걸린 시간 · 크기만. 묶음 · 결과 원문 · 토큰은 남기지 않는다.
- Gemma 서버(`~/lwe/jobs/in` · `out`)에 남는 묶음 · 결과는 받은 뒤 지우는 것을 목표로 한다(정리 명령은 별도 작업 — 열린 문제).

### 7. MCP — Claude Code · Codex 가 대화 중에 읽고 쓰기(`tools/llmwiki-mcp`)
- 이 컴퓨터에서 stdio 로 도는 MCP 서버다. 서버(Functions)를 거치지 않고 사용자 Drive 를 Drive REST 로 직접 읽고 쓴다(원칙 2: 서버는 내용을 보지 않는다).
- 쓰기는 둘뿐: 조각 남기기(정리 대기로) · 정리 제안. 확정 · 삭제 · 상태 전환 · 범주 만들기 도구는 없다. 규칙은 앱과 같은 core 함수(`newSource` · `prepareTriage` · `importTriage`) — 검사도 같다.
- 비공개 범주는 남기기만 되고 읽기 · 묶기 · 제안은 `--include-private` 일 때만.
- 앱과 MCP 가 같은 매니페스트를 번갈아 쓴다: Drive 저장소는 목록에서 본 버전을 바로 다음 읽기 한 번만 믿고, 매니페스트 저장은 충돌하면 최신본에 같은 바꿈을 다시 얹는다(`WorkRepo.saveManifestWith` · `mergeTriage`, 사본 없음).
- 토큰: 실제 Drive 는 설정에서 만든 **MCP 열쇠**로 서버(`mcpDriveToken`)에서 1시간 access token 을 받는다(원칙 4 표). 개발은 로컬 Drive(`--local-drive`). 직접 넣는 `LLMWIKI_DRIVE_TOKEN(_CMD)` 도 남겨 둔다.
- 로그(stderr)에는 도구 이름 · 결과 종류만.

### 8. 바꾸기 전에
- 실서버 데이터 삭제 · 이동, 배포, 사용자 Drive 쓰기는 사람 확인 뒤에 한다.
- 커밋은 기능 브랜치에서, 테스트(`npm test` · 에뮬레이터 통합)가 통과한 뒤 main 에.

## 열린 문제
- Drive 동시 수정: Drive v3 에 조건부 쓰기가 없어 쓰기 직전 버전 확인만 한다. 매니페스트는 충돌하면 다시 얹지만, 업무 · 자료 파일은 여전히 한 사람 · 한 기기 기준(MCP 는 업무 파일을 쓰지 않는다).
- 기존 Firestore 기능(대화 · 할일 · 시냅스)을 작업실로 옮길지.
- 데스크톱 셸 안의 Google 로그인 · Drive 동의 팝업이 막히는지(막히면 로그인만 시스템 브라우저 + Drive 는 브라우저에서 먼저 잇기).
- Gemma 서버에 남는 묶음 · 결과 정리(`jobd.py` 정리 명령).
