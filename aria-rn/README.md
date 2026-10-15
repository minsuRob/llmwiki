# aria-rn

llmwiki 의 앱 — React Native + RN web(Expo Router). 전체 구조와 실행 방법은 [../README.md](../README.md).

- `src/app/*` — 탭 경로(얇은 파일). 화면은 `src/features/*` 에 있다
- `src/features/chat` — 대화와 카드 다섯 종류(변경 · 할일 목록 · 기한 지난 할일 · 제안 · 떠올리기)
- `src/features/{tasks,calendar,notes,synapse,settings}` — 탭별 화면
- `src/firebase` — 연결 설정 · 익명 로그인과 실시간 구독(`data.tsx`) · 함수 호출(`api.ts`)

```bash
npm run web:emulator   # 로컬 에뮬레이터에 붙어 웹으로
npx expo start         # 클라우드 프로젝트에 붙어(함수 배포 후) iOS · Android · 웹
npm run typecheck
```
