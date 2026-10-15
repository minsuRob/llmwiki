# aria-rn

Aria(맥 · iOS 할일 비서)의 구조를 React Native + RN web(Expo)으로 다시 만든 실험 앱. 분석은 [../docs/aria-analysis.md](../docs/aria-analysis.md).

말하면 할일 · 일정 · 기록으로 정리하고, 결과를 대화 아래 카드로 보여 준다.

- **추가한 할일 · 일정 카드** — 한 턴에 바꾼 것을 묶어 [되돌리기] 하나로 되돌린다(그 사이 완료한 할일은 남긴다)
- **할일 목록 카드** — "오늘 할 일 보여줘" → 바로 체크할 수 있는 목록
- **기한 지난 할일 카드** — 줄마다 [완료] · [오늘로] · [삭제]
- **할일 제안 카드** — 여러 줄 메모에서 뽑은 할일을 [추가] 를 눌러야 만든다

## 실행

```bash
npm install
npx expo start --web        # 웹
npx expo start              # iOS · Android(Expo Go)
npm test                    # 날짜 해석 · 도구 실행기 · 기기 안 규칙
npm run typecheck
```

## 두 가지 답하는 길

- **Claude** — 설정 탭에 Anthropic API 키를 넣으면 `claude-opus-5-5` 가 도구를 고르고, 앱이 도구를 실행한다(`src/lib/claude.ts`). 키는 기기 안에만 저장되고 앱이 바로 API 를 부르므로 개인 기기에서만 쓴다.
- **기기 안 규칙** — 키가 없으면 한국어 규칙(`src/lib/local.ts`)이 같은 도구 호출을 만든다. 같은 카드가 뜬다.

## 구조

| 파일 | 하는 일 |
|---|---|
| `src/lib/engine.ts` | 도구 실행기 · 되돌리기 · 카드 처리(순수 함수) |
| `src/lib/toolDefs.ts` | 모델에게 보이는 도구 목록 |
| `src/lib/dates.ts` | 한국어 날짜 · 시각 해석 |
| `src/lib/store.tsx` | 상태와 저장(AsyncStorage) |
| `src/components/Cards.tsx` | 카드 네 종류 |
| `src/app/*` | 대화 · 할일 · 일정 · 기록 · 설정 탭(Expo Router) |
