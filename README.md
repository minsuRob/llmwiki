# llmwiki

구조와 원칙(세 역할 · 데이터 위치 · Drive 열쇠 보관 규칙): [docs/architecture.md](docs/architecture.md)

Aria(맥 · iOS 할일 비서)의 구조를 옮겨 다시 만든 할일 비서. 분석은 [docs/aria-analysis.md](docs/aria-analysis.md).

로컬 모델(Gemma · Laya)·업무 위임 검증과 현재 상태는 [docs/local-models](docs/local-models/README.md).

말하면 할일 · 일정 · 기록으로 정리하고, 결과를 대화 아래 카드로 보여 준다. 기록이 쌓이면 개념이 이어져 시냅스가 된다.

| 폴더 | 하는 일 |
|---|---|
| `aria-rn/` | 앱 — React Native + RN web(Expo Router). 기능별 `src/features/*` |
| `functions/` | API — Cloud Functions(asia-northeast3). 기능별 `src/features/*` |
| `packages/core/` | 공용 로직 — 날짜 해석 · 도구 실행기 · 한국어 규칙 · 시냅스(순수 함수) |
| `tests/` | 에뮬레이터 통합 테스트 |

Firebase 프로젝트: `llmwiki-minsu`(이름 llmwiki)

## 작업실(MVP) — 어제 AI 와 하던 일을 오늘 이어가기

Claude · Codex 를 그대로 쓰면서, 일하기 **전**의 맥락 준비와 일한 **뒤**의 결과 회수를 맡는다. 화면은 오늘 · 업무 · 보관함(아래 탭) + 대화, 나머지(전체 할 일 · 일정 · 기록 · 그래프 · 설정)는 위 오른쪽 메뉴. 어느 화면에서나 + 단추로 메모 · 링크를 넣는다.

| 흐름 | 어디 |
|---|---|
| 업무 만들기(범주 · 템플릿 5종 · 중요도 · 마감) — 범주(개인 · 회사 · 개발 · 독서 …)는 사람이 정하고, 범주 바로 아래가 업무 | 업무 탭 → 새 업무 |
| 메모 · 링크 · 글 파일 · Drive 자료 잇기(같은 자료는 한 벌만, 다른 작업실 자료는 확인 후) | 업무 상세 → 원본 자료 |
| 목표 · 현재 상태 · 다음 행동 · 최신 결과물 · 확인할 것 | 업무 상세 기본 화면 |
| AI 로 이어하기 — 맥락 묶음 복사 · .md 내보내기(대화 전체가 아니라 이번 작업에 필요한 것만, 접근 한계 표시) | 업무 상세 |
| 작업 결과 가져오기 — 붙여넣기 · 파일 · 결과물 링크/Drive 파일. `llmwiki-result` 블록 → 결과물 · 결정 제안 · 할 일 제안 · 미확인으로 나눔 | 업무 상세 |
| 검토 카드 — 결정 확정 · 할 일로 · 마감 변경 · 최신본 지정(확정 최신본 교체는 확인) · 되돌리기 | 업무 상세 |
| 오늘 — 추천 3개(마감 · 중요도 · 선행 작업, 이유 표시, 위/아래로 순서 바꾸기) · 이어서 할 업무 · 마감 · 판단 필요 · 최근 AI 결과 | 오늘 탭 |
| 보관함 — 원본 자료 · 메모 · AI 결과 · 결과물 · 검색(작업실 안에서만) | 보관함 탭 |

공용 로직은 `packages/core/src/work.ts`(모델 · 상태 전환 · 추천 · 검색) · `workHandoff.ts`(내보내기 · 가져오기 · 결과 검사) · `executors.ts`(실행자별 자료 예산) · `workStore.ts`(파일 저장소 · 충돌) · `drive.ts`(Drive REST) · `workMigrate.ts`(기록 이행).

### AI 실행자 — Claude · Codex · Gemma

같은 맥락 묶음을 받아 같은 `llmwiki-result` 형식으로 돌려준다. 웹은 로컬 CLI · SSH 를 못 띄우므로, 묶음을 파일로 내보낸 뒤 이 컴퓨터에서 돌리거나 **데스크톱 셸**(아래)에서 '바로 실행'한다:

```bash
node tools/handoff/run.mjs claude "<업무>-ai.md"
```

| 실행자 | 어디서 | 자료 예산 | 맞는 일 |
|---|---|---|---|
| Claude | 이 컴퓨터 `claude -p`(조사 모드: 읽기 · 웹만, 파일 수정 · 셸 금지) | 2만 자 | 조사 · 작성 · 분석 |
| Codex | 이 컴퓨터 `codex exec`(읽기 전용 샌드박스) | 2만 자 | 코드 · 분석 |
| Gemma | 오라클 서버 작업 큐(`jobd` 의 `handoff_gemma`, SSH 별칭 `oci-a1`) | 5천 자(문맥 8K) | 자료 요약 초안 · 지시문 섞임 검사 |

- 답은 `<묶음>-result.md` 로 남고, 앱의 **작업 결과 가져오기**로 넣는다. 어느 실행자든 같은 검사를 거쳐 **제안으로만** 들어간다.
- 가져올 때 코드가 표시하는 것(결과는 버리지 않는다): 확정 · 완료 필드(`status` · `confirmed` …) · 묶음에 없는 자료 · 줄 근거 · 근거 줄에 없는 마감 · 다른 요청의 결과 · 지시문으로 보이는 말(자모를 풀어 쓴 글 · 폭 없는 글자 포함).
- 묶음의 자료에는 줄 번호(`S1:12`)가 붙고, AI 는 `refs` 로 근거를 댄다.
- Claude Code 에 `oci-jobs` MCP 를 등록했다면 `oci_handoff_submit` · `oci_handoff_output` 으로도 Gemma 를 돌린다(`tools/local-model-eval/jobd/oci-jobs-mcp.mjs`).
- Gemma 가 기다리다 끊기면: `node tools/handoff/run.mjs gemma --fetch <작업 id>`
- 실행 본문은 `tools/handoff/lib.mjs` — 터미널(`run.mjs`)과 데스크톱 셸이 같은 코드를 쓴다. 시험: `node --test 'tools/handoff/*.test.mjs'`

### 받은 것 · MCP — 대화 중에 남기고 Claude 가 정리 제안

오늘 화면 맨 위 입력란(또는 다른 화면의 +)에 붙여 넣으면 지금 고른 범주의 '받은 것'(정리 대기)으로 들어간다. 'Claude 에게 정리 맡기기'는 정리 대기 조각을 묶어 Claude · Codex · Gemma 에 보내고(데스크톱 셸이면 바로 실행), 돌아온 정리 제안(업무에 잇기 · 새 업무 · 개념)을 받기 · 빼기로 확정한다. 설계: [docs/inbox-today.md](docs/inbox-today.md).

Claude Code · Codex 가 대화 중에 직접 남기고 정리 제안을 내게 하려면 MCP 서버를 등록한다(쓰기는 남기기 · 제안뿐, 비공개 범주는 남기기만):

```bash
claude mcp add llmwiki -- node <저장소>/tools/llmwiki-mcp/server.mjs --local-drive http://127.0.0.1:8790
```

- 도구: `llmwiki_workspaces` · `llmwiki_capture` · `llmwiki_work` · `llmwiki_read` · `llmwiki_inbox` · `llmwiki_propose`
- 실제 Drive: `--local-drive` 대신 `LLMWIKI_DRIVE_TOKEN`(또는 `LLMWIKI_DRIVE_TOKEN_CMD`) — 토큰 받는 길은 열린 문제(docs/architecture.md 원칙 7)
- 시험: `npm run test:mcp`

### 데스크톱 셸(Electron) — 바로 실행

`desktop/` 은 배포된 웹(`https://llmwiki-minsu.web.app`)을 그대로 띄우고 실행만 더하는 얇은 셸이다. 화면은 웹 배포(`npm run deploy:web`)로 바뀌고 셸은 다시 설치하지 않아도 된다. 원칙: `docs/architecture.md` "데스크톱 셸".

- 업무 상세 → AI 로 이어하기 → 맥락 묶기 → **바로 실행** → 보내기 확인 창(매번) → 끝나면 결과가 자동으로 들어와 검토 카드에 제안으로 쌓인다.
- 셸에서 Claude 는 웹 조사만(로컬 파일 읽기 없음, 빈 임시 폴더), Codex 는 읽기 전용, Gemma 는 오라클 서버 큐. CLI 경로는 로그인 셸에서 찾고 `~/Library/Application Support/llmwiki/config.json` 의 `claudePath` · `codexPath` 로 덮어쓸 수 있다.
- 앱이 받기 전 결과는 `~/Library/Application Support/llmwiki/runs/` 에 잠시 두고(받으면 바로 · 늦어도 30일 뒤 삭제), 로그(`logs/shell.log`)에는 원문 · 토큰을 남기지 않는다.

```bash
npm run desktop:install
```

```bash
npm run desktop:start
```

- 개발: 에뮬레이터 + `npm --prefix aria-rn run web:emulator` 를 띄운 뒤 `npm run desktop:dev`(로컬 Expo 웹에 붙는다). 가짜 실행자로 흐름만 볼 때는 `LLMWIKI_DESKTOP_FAKE_EXECUTORS=1`(개발 빌드에서만).
- 패키징: `npm run desktop:build` → `desktop/release/llmwiki-<버전>-arm64.dmg` · `.zip`. 서명 · 공증 출처는 `desktop/signing.config.mjs` 한 곳에서 고른다.
  - 기본 프로필 `feeeld`: 회사 Developer ID(FEEEL'D INC., 팀 46LU76SNUA, 만료 2027-02-01)를 MAKi 와 같은 SSM(`/front/staging`)에서 받아 임시 키체인으로 서명하고 공증한다(AWS 권한 필요). 공증 표시(staple)는 MAKi 처럼 붙이지 않는다(`LLMWIKI_STAPLE=true` 면 시도).
  - `LLMWIKI_SIGNING=none` 서명 없이 · `LLMWIKI_NOTARIZE=false` 서명만 · `npm --prefix desktop run signing:check` 출처 · 인증서만 확인.
  - 배포: `npm run desktop:release` — `desktop/package.json` 의 version 으로 태그 `desktop-v<버전>` 을 찍고 GitHub Releases 에 dmg · zip 을 올린다(기본 초안, `-- --publish` 면 공개). 설치 파일은 git 에 넣지 않는다(파일당 100MB 제한). 버전을 올릴 때는 version 을 바꿔 커밋한 뒤 실행.
  - 개인 계정으로 바꿀 때: `signing.config.mjs` 의 `personal`(환경 변수 출처)에 팀 ID 를 채우고 `DEFAULT` 를 바꾼다.
- 시험: `npm run test:desktop`(정책 · 입력 검증 · 실행 큐 · 브리지 계약 + 실행 본문).

### 데이터가 놓이는 곳

| 무엇 | 어디 |
|---|---|
| 업무 상태 · 결정 · AI 작업 · 결과물 연결(업무 하나 = 파일 하나) | Drive 연결 시 내 드라이브 `llmwiki 작업실/앱 데이터(…)`, 아니면 기기 저장소(AsyncStorage · 웹은 localStorage) |
| 사람이 읽는 업무 요약(.md) | `llmwiki 작업실/업무 요약/` (기기 저장소면 `summaries/`) |
| 가져온 AI 결과 원문(해시 이름, 한 번만) | 앱 데이터 `raw/` |
| 충돌 때 내 쪽 사본(지우지 않음) | 앱 데이터 `conflicts/` |
| Drive 자료 본문 발췌 · 검색 색인 | 기기 안 캐시(원본에서 다시 만든다) |
| 기존 대화 · 할일 · 일정 · 기록 · 시냅스 | 지금처럼 Firestore(작업실은 Firestore 를 쓰지 않는다) |

- 저장 · 동기화 · AI 정리 상태를 따로 보여 준다. 쓰기에 실패하면 "저장 안 됨" 으로 남기고 기기에 임시 보관했다가, 다시 연결하면 다시 저장한다(바깥에서 바뀌었으면 충돌 사본).
- 기존 기록은 설정 → "기존 기록 가져오기" 로 보관함 메모에 **복사**한다(원본 그대로, 되돌리기 있음). 할일은 옮기지 않고 오늘 · 전체 할 일에서 그대로 보인다.
- 화면 고정 문구는 `aria-rn/src/i18n/app.{ko,en}.ts` · `legacy.{ko,en}.ts`. 설정에서 언어를 바꾼다.

### Google Drive 연결(실제 계정 — 설정 필요)

범위는 `drive.file` 하나(고른 파일 + 앱이 만든 폴더만). Google 로그인과 Drive 동의는 따로다. 웹에서만 된다(iOS · Android 는 네이티브 Google 로그인 + 개발 빌드가 필요해 아직 없음).

1. Google Cloud 콘솔(프로젝트 llmwiki-minsu)에서 **Google Drive API** 와 **Google Picker API** 를 켠다.
2. OAuth 동의 화면에 `.../auth/drive.file` 범위를 넣고, 웹 OAuth 클라이언트 ID 를 만든다(승인된 JavaScript 원본: `http://localhost:8081`, `https://llmwiki-minsu.web.app`).
3. Picker 용 API 키를 만든다(HTTP 리퍼러 제한 · Picker API 만 허용).
4. `aria-rn/.env.local`(커밋하지 않음):

```bash
EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID=…apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_PICKER_API_KEY=…
```

설정이 없으면 Drive 는 "설정 필요" 로 보이고 연결 단추가 꺼진다(가짜로 연결된 척하지 않는다). 토큰은 기억에만 두므로 앱을 다시 열면 "다시 연결" 이 필요하다.

### 로컬 Drive 로 검증하기(개발용 — 실제 Google Drive 아님)

`tools/local-drive/server.mjs` 가 이 컴퓨터의 `.local-drive/내 드라이브/` 폴더를 Drive REST(v3)처럼 흉내 낸다. 앱의 Drive 코드가 그대로 돌고, 파일은 진짜 파일로 쌓인다. 디스크에서 파일을 고치면 version 이 올라 "자료가 바뀜" · 충돌을 재현할 수 있다. `.gdoc`/`.gsheet` 는 Google 문서처럼 export 로 읽는다.

터미널 셋:

```bash
npm run emulators
```

```bash
npm run local-drive
```

```bash
EXPO_PUBLIC_LOCAL_DRIVE_URL=http://127.0.0.1:8790 npm --prefix aria-rn run web:emulator
```

설정 → "로컬 Drive 연결(개발용)" → 업무 상세 → 원본 자료 → "Drive 에서". 화면에는 늘 "개발용 · 실제 Google Drive 아님" 이 표시된다.

## 기능

| 기능 | 앱 | API |
|---|---|---|
| 대화 → 할일 · 일정 · 기록 + 카드 | `features/chat` | `chat` |
| 카드 단추(되돌리기 · 기한 지난 할일 · 제안) | `features/chat/Cards.tsx` | `cardAction` |
| 할일 탭(체크 · 휴지통 · 되살리기) | `features/tasks` | `taskAction` |
| 일정 · 기록 탭 | `features/calendar` · `features/notes` | (읽기만) |
| 시냅스(개념 그래프 · 떠올리기) | `features/synapse` | `rebuildSynapse` · 글이 바뀔 때마다 자동 |
| 그래프(옵시디언식 — [[링크]] · 백링크 · 전체/로컬 · 필터 · 그룹 · 장력) | `features/synapse/VaultScreen.tsx` · `features/notes` | (읽기만, 계산은 `packages/core/src/vault.ts`) |
| 취준 공고(참고용 · Firestore — 작업실 밖, 그룹바이 · 인디스워크) | `features/jobs` | `jobsSync` · `functions/scripts/import-jobs.ts` |

앱은 Firestore 를 **읽기만** 하고(규칙이 막는다), 바꾸는 일은 전부 함수가 한다.

## 로컬에서 실행 · 테스트 (자체 구성)

에뮬레이터(Auth · Firestore · Functions)만으로 끝까지 돈다. Java 21 이 필요하다.

```bash
npm install && npm --prefix functions install && npm --prefix packages/core install && npm --prefix aria-rn install
```

```bash
npm test
```

`npm test` 는 공용 로직(작업실 검증 시나리오 · 로컬 Drive 통합 포함) · 함수 단위 테스트와 에뮬레이터 통합 테스트를 차례로 돌린다.

에뮬레이터 포트(9099 · 8080 · 5001)가 다른 프로그램에 잡혀 있으면, 포트만 바꾼 설정 파일로 `firebase emulators:exec --config <파일>` 을 돌리고 `FUNCTIONS_EMULATOR_PORT` 를 준다. 앱은 `EXPO_PUBLIC_EMULATOR_PORTS="auth,firestore,functions"` 로 같은 포트에 붙는다.

앱을 에뮬레이터에 붙여 띄우기(터미널 둘):

```bash
npm run emulators
```

```bash
npm --prefix aria-rn run web:emulator
```

에뮬레이터 UI: http://127.0.0.1:4000

## 클라우드 (배포됨)

웹: **https://llmwiki-minsu.web.app** (Firebase Hosting — 열면 익명으로 로그인된다)

- Firestore `(default)` — asia-northeast3(서울), 규칙 · 인덱스 배포됨
- Auth — 익명 로그인 켜짐
- Functions — `chat` · `cardAction` · `taskAction` · `rebuildSynapse` · `jobsSync`(asia-northeast3, Node 22). Blaze 요금제, 빌드 이미지는 하루 지나면 지운다
- Hosting — `aria-rn/dist`(expo export). 한 페이지 앱이라 모든 경로를 index.html 로 돌린다. 아이콘 글꼴이 `assets/node_modules/…` 에 있어 node_modules 를 올림에서 빼면 안 된다

다시 배포하기(웹 빌드 · 함수 · 규칙 전부):

```bash
npm run deploy
```

웹만 다시 올리기(배포 전에 웹 빌드를 새로 한다):

```bash
npm run deploy:web
```

배포된 API 를 같은 7개 시나리오로 확인하기(테스트가 만든 데이터 · 익명 계정은 끝나면 지운다):

```bash
npm run test:cloud
```

앱을 클라우드에 붙여 띄우기:

```bash
npm --prefix aria-rn run web
```

## 취준 공고 넣기

로컬 구직 폴더(Obsidian `Personal/구직`)를 읽어 `users/{uid}/jobs`(목록) · `users/{uid}/jobTexts`(본문)에 맞춘다. 원본은 읽기만 한다.

- 그룹바이: `.groupby-data/out/<id>.json`(상세 조사). 조사하지 못한(삭제된) 공고는 뺀다
- 인디스워크: `인디스워크/.data/posts.json` + `text/<id>.txt`
- 마감 글이 날짜로 시작할 때만 마감일로 보고, 마감일이 오늘(서울)보다 앞이면 넣지 않고 이미 있으면 지운다
- 다시 돌려도 바뀐 공고만 쓰고, 원본에서 사라진 공고는 지운다

```bash
node functions/scripts/import-jobs.ts --src "<구직 폴더>" --dry-run
```

```bash
node functions/scripts/import-jobs.ts --src "<구직 폴더>" --uid <uid> --target cloud --via admin
```

`--via admin` 은 Admin SDK 로 바로 쓰고(`gcloud auth application-default login` 필요), `--via function` 은 그 uid 로 `jobsSync` 함수를 부른다. 같은 코드(`functions/src/jobsStore.ts`)로 쓴다.

## Claude

API 키는 앱에 두지 않는다. 함수 환경변수 `ANTHROPIC_API_KEY` 가 있으면 `claude-opus-5-5` 가 도구를 고르고 기록에서 개념을 뽑는다. 없으면 한국어 규칙이 같은 도구를 부른다. 로컬에서는 `functions/.env.local`(커밋하지 않음)에 넣는다.
