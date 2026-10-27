# packages/core — 규칙(순수 함수)

앱(`aria-rn`) · 서버(`functions`) · MCP(`tools/llmwiki-mcp`)가 **같은 함수**를 부른다. 규칙을 바꾸면 세 곳이 함께 바뀐다. 화면 문구는 여기 두지 않는다 — 문구 키(`Msg`)와 값만 남기고 앱이 번역한다.

## 파일 지도

| 파일 | 맡은 일 | 시험 |
|---|---|---|
| `pages.ts` | **페이지 트리(스키마 3)** — 색인(`PageMeta`) · 문서(`PageDoc`) · 순서 키 · 트리 바꾸기(만들기 · 이름 · 옮기기(순환 · 범주 막음) · 휴지통 · 되살리기) · 본문(`editBody` · 되돌리기 200KB 상한) · **본문 제안**(`proposeBody` → `acceptBodyProposal`(낡으면 stale → force) · `rejectBodyProposal` · `mergeBodyProposals`) · 가져오기(`importPlan` · `packBodies` · `splitMarkdownPages` · `rowsToEntries`(CSV · JSON → 하위 + 속성)) · 속성 고치기(`setPageProps`) · 사람이 읽는 사본(`mirrorTodo`) · v2 이행(`migrateToPages`) | `pages.test.ts` |
| `pageQuery.ts` | 하위 페이지 **거르기 · 정렬**(`facetsOf` — 값 적은 속성은 칩 · 날짜 · 글, `queryPages`, `parseWhere`) — 앱 펼쳐 보기 · AI 넘기기 · MCP `llmwiki_read` 가 같이 쓴다 | `pageQuery.test.ts` |
| `pageView.ts` | **목록 보기** — 소주제(하위가 있는 페이지)의 칸(`PageMeta.view`: key · label · kind = status · date · tag · flag · text). 없으면 값 모양으로 짐작(`guessView`) · 한 줄 칸(`rowCells`) · 오늘 개요(`overviewOf`) · **AI 보기 제안**(`proposeView` → 사람이 `applyViewProposal` + `decideViewProposal`, 합치기는 `mergeBodyProposals` 에 실려 감). MCP `llmwiki_propose_view` · 페이지 넘기기 결과의 `view` · `props` 가 같은 함수를 부른다 | `pageView.test.ts` |
| `work.ts` | 범주 · 조각(Source) · **받은 것**(inbox · 정리 제안 들이기/받기/빼기 · `mergeTriage`) · 매니페스트 · 이행(`upgradeSource` · `upgradeManifest`) | `inbox.test.ts` · `work.test.ts` |
| `workV2.ts` | 옛 업무(스키마 2) 파일 모양 · `upgradeItem` — 이행과 시험만 쓴다 | `pages.test.ts` |
| `pageHandoff.ts` | 페이지 **넘기기** — 묶음(`preparePageRun`, P1 · P2…, 하위는 다이제스트) · 전문 나눠 읽기(`fullChunk`, cursor) · 결과 해석(```` ```llmwiki-page ````) · 들이기(`importPageResult` → 본문 제안) · `runMeta` | `pageHandoff.test.ts` |
| `workTriage.ts` | 받은 것 **정리 묶음**(`prepareTriage`, 페이지는 'P#: 경로/제목') · 결과 해석(`parseTriage`, ```` ```llmwiki-triage ````) · 들이기(`importTriage`) | `workTriage.test.ts` |
| `textDiff.ts` | 줄 단위 비교(LCS) — 본문 제안 비교 화면 | `textDiff.test.ts` |
| `inject.ts` | 지시문 검사(`scanInjection`, 자모 · 폭 없는 글자 우회 포함) | `inject.test.ts` |
| `hash.ts` | 해시 · 결과 정규화(work · pages 가 같이 씀) | — |
| `executors.ts` | 실행자(Claude · Codex · Gemma)별 자료 예산 · 명령 | — |
| `workStore.ts` | 파일 저장소 틀(`FileStore`) · `WorkRepo`(`load` = 매니페스트 · 색인 · 자료, `readDoc` · `readBody`(메모리 → 기기 캐시 → 파일 · 묶음), `saveIndexWith` · `saveManifestWith` 재적용, `savePageDoc` 충돌 사본, `applyImport` 묶음 먼저 · 색인 마지막, `writePageMd`) · 기기(KV) · 메모리 · `MirroredStore`(묶음 · 사본은 기기에 두지 않음) | `work.test.ts` · `pages.test.ts` · `localDrive.test.ts` |
| `drive.ts` | Google Drive REST 저장소(`DriveFileStore` — 보이는 '페이지' 폴더는 처음 쓸 때 만든다) · 원본 읽기 · `DRIVE_SCOPE` | `localDrive.test.ts`(tools/local-drive 에 붙여) |
| `workMigrate.ts` | 옛 Firestore 기록 → 보관함 메모 복사 · 되돌리기 | `work.test.ts` |
| `judgments.ts` | 판단 기록(정리 제안 · 본문 제안을 사람이 받았나) 내보내기 — 매니페스트에서 계산 | `judgments.test.ts` |
| `engine.ts` · `local.ts` · `types.ts` · `dates.ts` | **옛 기능**(대화 · 할일 · 일정 · 기록) — 도구 실행 · 한국어 규칙 길 · 날짜 해석 | `engine.test.ts` · `dates.test.ts` |
| `synapse.ts` · `vault.ts` | 개념 그래프(규칙 길) · 볼트 그래프 | `synapse.test.ts` · `vault.test.ts` |

## 받은 것 — 자주 만지는 함수

- 상태: `sourceTriage` · `inboxSources` · `fragmentState`(waiting · proposed · filed · dismissed)
- 제안: `proposeTriage` → `acceptTriage` · `rejectTriage`
  - 들이지 않는 것(`TriageSkip`): `no_source` · `unknown_source` · `cross_workspace`(범주를 넘음 — 조각들끼리, 또는 이을 페이지 · 새 페이지의 부모가 다른 범주) · `unknown_item`(없는 · 휴지통 페이지) · `missing_field` · `duplicate`
  - 들이되 표시하는 것(`TriageFlag`): `no_evidence`(근거 없음) · `bad_refs`(없는 줄을 댐, `importTriage`) · `injection_suspect`(지시문 의심)
  - 사람이 다른 범주 페이지에 잇는 것은 `acceptTriage(…, { pageId, confirmCross })` · `fileSource` 의 `needs_confirm` 확인을 거친다
  - 페이지에 잇는 받기는 그 페이지 문서가 필요하다 — 없으면 `needs_doc`(앱이 읽어서 `opts.doc` 으로 다시)
- 사람만: `fileSource`(손으로 잇기) · `dismissSource` · `restoreSource` · `moveSource`, 페이지 트리 바꾸기 전부(pages.ts)
- 동시 쓰기(앱 + MCP): 매니페스트는 `WorkRepo.saveManifestWith(cur, fn)` 로 쓰고, 정리 제안은 `mergeTriage`, 본문 제안 · 넘기기 기록은 `mergeBodyProposals` 로 합친다. 색인은 `saveIndexWith`(범주마다)

## 페이지 — 자주 만지는 규칙

- 본문은 마크다운이 정본. 지문은 `bodyHashOf`(정규화 후) — 기기 캐시 키 · 낡은 제안 판단 · 다시 가져오기 판단에 같이 쓴다.
- 가져온 페이지는 묶음 속(`bodyRef: pack:…`)에 있다가 처음 고치거나 제안을 받을 때 제 파일(`file`)로 옮긴다(`savePageDoc` → `syncMeta`).
- 이행(v2 → v3)은 같은 id 를 쓴다 — 정리 제안의 `itemId` · 판단 기록이 그대로 이어진다. 여러 번 돌려도 같다.
- 편집기를 거쳐도 글이 바뀌지 않게 core 가 만드는 본문은 편집기 정본 꼴(`editorBlocks` — 제목 뒤 빈 줄)로.

## 바꿀 때

- 모델 필드를 바꾸면 `WORK_SCHEMA_VERSION` 을 올리고 `upgradeSource` · `upgradeManifest` · `upgradeIndex` · `upgradeDoc` 에 이행을 넣는다. Drive 의 옛 파일은 읽을 때 바뀐다.
- AI 결과를 들이는 길은 언제나 검사를 거친다(근거 줄 · 지시문 · 확정 필드 무시). 검사를 건너뛰는 지름길을 만들지 않는다.
- 시험: `npm test`(이 폴더) 또는 루트 `npm run test:core`. 타입: `npm run typecheck`.
