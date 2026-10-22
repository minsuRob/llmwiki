# functions — Cloud Functions(asia-northeast3)

서버는 **AI API 를 쓰지 않는다**(Anthropic SDK · 키 없음). 하는 일은 옛 기능의 규칙 길(대화 · 할일 · 시냅스)과, Drive · MCP **열쇠 관리**뿐이다. 규칙은 `packages/core` 를 번들해서 쓴다(esbuild).

## 지도

| 파일 | 맡은 일 |
|---|---|
| `src/index.ts` | 내보내는 함수 목록 |
| `src/features/drive.ts` | Drive 열쇠 — `driveLink`(코드 → 암호화 보관) · `driveToken`(1시간 토큰) · `driveUnlink`(거두기 + MCP 열쇠 삭제) · `driveStatus` · `driveListWork`(서버 읽기: 페이지 색인의 id · 제목 · 범주 · 부모만 — `src/driveList.ts`, 색인이 없으면 옛 업무 파일). `accessFor` · `requireGoogleUser` 를 mcp.ts 가 쓴다 |
| `src/features/mcp.ts` | MCP 열쇠 — `mcpKeyCreate` · `mcpKeyList` · `mcpKeyRevoke`(앱) · `mcpDriveToken`(HTTP, Bearer `lwk_…` → 1시간 토큰) |
| `src/driveTokens.ts` · `src/mcpKeys.ts` | 순수 함수 — 열쇠 암호화(AES-256-GCM, uid 묶음) · Google 토큰 교환/갱신/폐기 · MCP 열쇠 모양 · 해시 · 비교 |
| `src/features/{chat,cards,tasks,synapse}.ts` | 옛 기능(Firestore `users/{uid}/…`) — 대화는 `runLocalTurn` 규칙 길만 |
| `src/common.ts` · `src/store.ts` | 로그인 확인 · 사용자 시각 · 읽고 → 바꾸고 → 그래프 → 바뀐 것만 쓰기 |

## 규칙

- 새 서버 읽기 · 새 열쇠는 `docs/architecture.md` 원칙 4 표에 **먼저** 적는다. 열쇠 · 토큰 · Drive 내용은 로그에 남기지 않는다(uid · 동작 · 개수만).
- Firestore 규칙(`firestore.rules`): 앱은 자기 `users/{uid}` 읽기만, 쓰기는 함수만. `driveLinks` · `mcpKeys` 는 앱이 못 읽는다.
- 시크릿: `GOOGLE_OAUTH_CLIENT_SECRET` · `DRIVE_TOKEN_KEY`(Functions secret). 코드 · 저장소에 두지 않는다.

## 시험 · 배포

```bash
npm test                      # 단위(driveTokens · mcpKeys · common · driveList)
npm run build                 # lib/index.js 번들
# 통합: 루트 npm run test:api — 다른 에뮬레이터가 9099/8080/5001/4400/4500 을 쓰면
#   firebase.json 을 복사해 포트를 바꾼 임시 설정으로 emulators:exec --config <임시> 를 돌리고 FUNCTIONS_EMULATOR_PORT 를 맞춘다
# 배포본 확인: bash tests/cloud-smoke.sh(테스트 계정 · 데이터는 스스로 지운다)
```
