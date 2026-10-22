# packages/core — 규칙(순수 함수)

앱(`aria-rn`) · 서버(`functions`) · MCP(`tools/llmwiki-mcp`)가 **같은 함수**를 부른다. 규칙을 바꾸면 세 곳이 함께 바뀐다. 화면 문구는 여기 두지 않는다 — 문구 키(`Msg`)와 값만 남기고 앱이 번역한다.

## 파일 지도

| 파일 | 맡은 일 | 시험 |
|---|---|---|
| `work.ts` | 모델(Workspace · WorkItem · Source · Proposal · TriageProposal · Manifest, 스키마 2) · 상태 전환 · 받은 것(inbox · 정리 제안 들이기/받기/빼기 · `mergeTriage`) · 추천 · 검색 · 이행(`upgrade*`) | `work.test.ts` · `inbox.test.ts` |
| `workTriage.ts` | 받은 것 **정리 묶음**(`prepareTriage`) · 결과 해석(`parseTriage`, ```` ```llmwiki-triage ````) · 들이기(`importTriage`) | `workTriage.test.ts` |
| `workHandoff.ts` | 업무 **맥락 묶음**(`prepareRun`) · 결과 해석(```` ```llmwiki-result ````) · 들이기(`importResult`) · 지시문 검사(`scanInjection`) | `workHandoff.test.ts` |
| `executors.ts` | 실행자(Claude · Codex · Gemma)별 자료 예산 · 명령 | — |
| `workStore.ts` | 파일 저장소 틀(`FileStore`) · `WorkRepo`(읽기 · 쓰기 · 충돌 사본 · `saveManifestWith` 재적용) · 기기(KV) · 메모리 | `work.test.ts` · `localDrive.test.ts` |
| `drive.ts` | Google Drive REST 저장소(`DriveFileStore`) · 원본 읽기 · `DRIVE_SCOPE` | `localDrive.test.ts`(tools/local-drive 에 붙여) |
| `workMigrate.ts` | 옛 Firestore 기록 → 보관함 메모 복사 · 되돌리기 | `work.test.ts` |
| `judgments.ts` | 판단 기록(AI 제안을 사람이 받았나) 내보내기 | `judgments.test.ts` |
| `engine.ts` · `local.ts` · `types.ts` · `dates.ts` | **옛 기능**(대화 · 할일 · 일정 · 기록) — 도구 실행 · 한국어 규칙 길 · 날짜 해석 | `engine.test.ts` · `dates.test.ts` |
| `synapse.ts` · `vault.ts` | 개념 그래프(규칙 길) · 볼트 그래프 | `synapse.test.ts` · `vault.test.ts` |
| `jobs.ts` | 취준 공고 정규화 | `jobs.test.ts` |

## 받은 것 — 자주 만지는 함수

- 상태: `sourceTriage` · `inboxSources` · `fragmentState`(waiting · proposed · filed · dismissed)
- 제안: `proposeTriage` → `acceptTriage` · `rejectTriage`
  - 들이지 않는 것(`TriageSkip`): `no_source` · `unknown_source` · `cross_workspace`(범주를 넘음 — 조각들끼리, 또는 이을 업무가 다른 범주) · `unknown_item` · `missing_field` · `duplicate`
  - 들이되 표시하는 것(`TriageFlag`): `no_evidence`(근거 없음) · `bad_refs`(없는 줄을 댐, `importTriage`) · `injection_suspect`(지시문 의심)
  - 사람이 다른 범주 업무에 잇는 것은 `acceptTriage(…, { itemId, confirmCross })` · `fileSource` 의 `needs_confirm` 확인을 거친다
- 사람만: `fileSource`(손으로 잇기) · `dismissSource` · `restoreSource` · `moveSource` · `moveWorkItem`
- 동시 쓰기(앱 + MCP): 매니페스트는 `WorkRepo.saveManifestWith(cur, fn)` 로 쓰고, 정리 제안은 `mergeTriage(cur, mine)` 로 합친다

## 바꿀 때

- 모델 필드를 바꾸면 `WORK_SCHEMA_VERSION` 을 올리고 `upgradeItem` · `upgradeSource` · `upgradeManifest` 에 이행을 넣는다. Drive 의 옛 파일은 읽을 때 바뀐다.
- AI 결과를 들이는 길은 언제나 검사를 거친다(근거 줄 · 지시문 · 확정 필드 무시). 검사를 건너뛰는 지름길을 만들지 않는다.
- 시험: `npm test`(이 폴더) 또는 루트 `npm run test:core`. 타입: `npm run typecheck`.
