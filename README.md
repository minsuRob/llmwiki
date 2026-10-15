# llmwiki

Aria(맥 · iOS 할일 비서)의 구조를 옮겨 다시 만든 할일 비서. 분석은 [docs/aria-analysis.md](docs/aria-analysis.md).

말하면 할일 · 일정 · 기록으로 정리하고, 결과를 대화 아래 카드로 보여 준다. 기록이 쌓이면 개념이 이어져 시냅스가 된다.

| 폴더 | 하는 일 |
|---|---|
| `aria-rn/` | 앱 — React Native + RN web(Expo Router). 기능별 `src/features/*` |
| `functions/` | API — Cloud Functions(asia-northeast3). 기능별 `src/features/*` |
| `packages/core/` | 공용 로직 — 날짜 해석 · 도구 실행기 · 한국어 규칙 · 시냅스(순수 함수) |
| `tests/` | 에뮬레이터 통합 테스트 |

Firebase 프로젝트: `llmwiki-minsu`(이름 llmwiki)

## 기능

| 기능 | 앱 | API |
|---|---|---|
| 대화 → 할일 · 일정 · 기록 + 카드 | `features/chat` | `chat` |
| 카드 단추(되돌리기 · 기한 지난 할일 · 제안) | `features/chat/Cards.tsx` | `cardAction` |
| 할일 탭(체크 · 휴지통 · 되살리기) | `features/tasks` | `taskAction` |
| 일정 · 기록 탭 | `features/calendar` · `features/notes` | (읽기만) |
| 시냅스(개념 그래프 · 떠올리기) | `features/synapse` | `rebuildSynapse` · 글이 바뀔 때마다 자동 |

앱은 Firestore 를 **읽기만** 하고(규칙이 막는다), 바꾸는 일은 전부 함수가 한다.

## 로컬에서 실행 · 테스트 (자체 구성)

에뮬레이터(Auth · Firestore · Functions)만으로 끝까지 돈다. Java 21 이 필요하다.

```bash
npm install && npm --prefix functions install && npm --prefix packages/core install && npm --prefix aria-rn install
```

```bash
npm test
```

`npm test` 는 공용 로직 · 함수 단위 테스트와 에뮬레이터 통합 테스트(7개 시나리오)를 차례로 돌린다.

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
- Functions — `chat` · `cardAction` · `taskAction` · `rebuildSynapse`(asia-northeast3, Node 22). Blaze 요금제, 빌드 이미지는 하루 지나면 지운다
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

## Claude

API 키는 앱에 두지 않는다. 함수 환경변수 `ANTHROPIC_API_KEY` 가 있으면 `claude-opus-5-5` 가 도구를 고르고 기록에서 개념을 뽑는다. 없으면 한국어 규칙이 같은 도구를 부른다. 로컬에서는 `functions/.env.local`(커밋하지 않음)에 넣는다.
