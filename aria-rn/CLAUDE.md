# aria-rn — llmwiki 앱(React Native + 웹, Expo Router)

폴더 이름만 옛것이다(Aria 를 옮겨 시작). 웹(https://llmwiki-minsu.web.app)이 주 무대이고 데스크톱 셸도 이 웹을 띄운다. 규칙은 여기 두지 않는다 — `packages/core` 함수를 부르기만 한다.

## 지도

| 곳 | 맡은 일 | 더 볼 곳 |
|---|---|---|
| `src/app/` | 경로(얇은 파일). 아래 탭 = 오늘(`index`) · 페이지(`work/index`) · 보관함 · 편집기 · 대화. 숨은 경로 = `work/[id]`(페이지 — 넓으면 나눈 화면) · tasks · calendar · notes · jobs · synapse · settings. 탭 목록은 `_layout.tsx` 의 `TABS` · `HIDDEN` | — |
| `src/features/work/` | **작업실 화면 전부**(오늘 · 페이지 트리 · 페이지 · 본문 제안 비교 · 펼쳐 보기 · 가져오기 · 보관함 · 받은 것) + 저장 경로(`WorkContext`) | `src/features/work/CLAUDE.md` |
| `src/features/editor/` | Lexical 편집기(페이지 본문 — 마크다운 왕복) · 읽기 전용 뷰어 | `src/features/editor/CLAUDE.md` |
| `src/features/settings/` | 설정(언어 · Drive · MCP 열쇠 · 계정 · 판단 기록) | `McpKeysCard.tsx` |
| `src/features/{chat,tasks,calendar,notes,synapse,jobs}/` | **옛 기능**(Firestore). 대화는 서버 규칙 길만(AI 없음). 취준(jobs)에는 '페이지로 가져오기'(`work/ImportPagesSheet.tsx`)가 붙어 있다 | `src/firebase/` |
| `src/features/auth/` | 로그인 화면 | — |
| `src/firebase/` | Firebase 설정 · 익명/Google 로그인 · 옛 기능 데이터 구독(`data.tsx`) · 함수 호출(`api.ts`) | — |
| `src/i18n/` | 문구. `app.ko.ts` · `app.en.ts` = 작업실 · 공통, `legacy.*` = 옛 화면. 두 언어 키를 같이 더한다 | — |
| `src/components/` | 팔레트(`theme.ts`) · 기본 부품(`ui.tsx`) · 공개 페이지 링크(`LegalLinks.tsx`) | — |
| `public/` | 로그인 없이 열리는 정적 페이지(about · privacy · terms · Search Console 확인 파일 — **지우지 마라**) | `docs/google-verification.md` |

공급자 순서(`src/app/_layout.tsx`): `I18nProvider` → `DataProvider`(옛 기능) → `WorkProvider`(작업실) → `DesktopRunsProvider`(셸 실행).

## 규칙

- 문구는 하드코딩하지 않는다 — `useT()` 와 `app.ko.ts` · `app.en.ts` 에 같은 키로.
- 색은 `usePalette()` 의 토큰(`c.text` · `c.muted` · `c.accent` · `c.surface` · `c.row` …)만.
- 네이티브 모듈은 `npx expo install` 로 더하고, `ios/` · `android/` 는 손대지 않는다(만들어지는 폴더, 설정은 `app.json`). Expo API 는 바뀌므로 `package.json` 의 Expo 판에 맞는 문서를 확인한다.

## 확인

```bash
npm run typecheck
npm run lint            # 기존 오류 13개(synapse · firebase/data)는 이번 일과 무관
npm run test:editor     # 편집기 마크다운 왕복(scripts/test-editor.mjs — functions 의 esbuild 로 묶어 node --test)
npm run web:emulator    # 에뮬레이터에 붙은 웹 — 루트 .claude/launch.json 이 있으면 그것으로(이 컴퓨터에만)
# 로컬 Drive 웹: EXPO_PUBLIC_LOCAL_DRIVE_URL=http://127.0.0.1:8790 npm run web:emulator -- --port 8088 (먼저 루트 npm run local-drive)
# 에뮬레이터 포트를 바꿔 띄웠으면 EXPO_PUBLIC_EMULATOR_PORTS="auth,firestore,functions"
```

화면을 바꾸면 브라우저에서 눌러 보고 끝낸다. 실제 Drive 는 배포본(로그인 · Drive 연결 필요)에서만 확인된다.
