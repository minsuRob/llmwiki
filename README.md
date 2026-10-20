# llmwiki

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
| 업무 만들기(작업실 · 영역 · 템플릿 5종 · 중요도 · 마감) | 업무 탭 → 새 업무 |
| 메모 · 링크 · 글 파일 · Drive 자료 잇기(같은 자료는 한 벌만, 다른 작업실 자료는 확인 후) | 업무 상세 → 원본 자료 |
| 목표 · 현재 상태 · 다음 행동 · 최신 결과물 · 확인할 것 | 업무 상세 기본 화면 |
| AI 로 이어하기 — 맥락 묶음 복사 · .md 내보내기(대화 전체가 아니라 이번 작업에 필요한 것만, 접근 한계 표시) | 업무 상세 |
| 작업 결과 가져오기 — 붙여넣기 · 파일 · 결과물 링크/Drive 파일. `llmwiki-result` 블록 → 결과물 · 결정 제안 · 할 일 제안 · 미확인으로 나눔 | 업무 상세 |
| 검토 카드 — 결정 확정 · 할 일로 · 마감 변경 · 최신본 지정(확정 최신본 교체는 확인) · 되돌리기 | 업무 상세 |
| 오늘 — 추천 3개(마감 · 중요도 · 선행 작업, 이유 표시, 위/아래로 순서 바꾸기) · 이어서 할 업무 · 마감 · 판단 필요 · 최근 AI 결과 | 오늘 탭 |
| 보관함 — 원본 자료 · 메모 · AI 결과 · 결과물 · 검색(작업실 안에서만) | 보관함 탭 |

공용 로직은 `packages/core/src/work.ts`(모델 · 상태 전환 · 추천 · 검색) · `workHandoff.ts`(내보내기 · 가져오기) · `workStore.ts`(파일 저장소 · 충돌) · `drive.ts`(Drive REST) · `workMigrate.ts`(기록 이행).

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
