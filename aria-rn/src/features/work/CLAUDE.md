# features/work — 작업실 화면

설계 · 흐름: `docs/inbox-today.md`(받은 것) · `docs/architecture.md`(페이지 트리). 규칙 함수: `packages/core/src/pages.ts` · `work.ts` · `pageHandoff.ts` · `workTriage.ts`.

## 지도

| 파일 | 화면 · 역할 |
|---|---|
| `WorkContext.tsx` | **저장 경로 하나.** 기기 · Drive 저장소 선택, 처음 읽을 때 매니페스트 · 색인 · 자료만(본문은 `openDoc` · `readBodies`), 옛 업무가 있으면 한 번 페이지로 이행(`migrate`). 문서 · 색인 쓰기는 페이지 · 범주마다 차례로(`queue`), 색인은 `commitPages`(최신본에 다시 얹기). 트리 바꾸기 · `saveBody` · `acceptTriage` · `acceptBody`(낡으면 stale) · `preparePage` · `importPageText` · `importPages` · 사람이 읽는 사본 큐(두 개씩, 기기에 지문) |
| `PagesScreen.tsx` | 페이지 탭 — 폭 900 이상이면 트리 280px + 페이지, 좁으면 트리 → `/work/[id]`(`PageRoute`) |
| `PageTree.tsx` | 트리(접기 · 줄 메뉴: 하위 · 이름 · 위/아래 · 옮기기 · 휴지통) · 휴지통 · 열린 본문 제안 점 · `PagePicker`(받은 것에서 잇기) |
| `PageScreen.tsx` | 페이지 하나 — 경로 · 아이콘 · 제목 · 저장 상태 · 셸 실행 줄 · 본문 제안 띠 · 편집기(`initialMarkdown` · `onMarkdown`) · 하위(펼쳐 보기 · 가져오기) · 자료 · AI 에게 맡기기 · 바꾼 기록(되돌리기) |
| `ProposalCompare.tsx` | 본문 제안 띠 · 줄 비교(core `textDiff`) · 받기 · 빼기 · 낡았지만 그대로 받기 |
| `ExpandedView.tsx` | 펼쳐 보기 — 하위를 한 문서처럼(보이는 근처만 읽음) · 거르기 · 표 · 한 문서로 내보내기 |
| `ImportPagesSheet.tsx` | 페이지로 가져오기 — 공고(주제 → 부모 → 출처, jobTexts 는 기기에서) · 마크다운 붙여 넣기 · 올리기 |
| `PageHandoffPanel.tsx` · `RunHint.tsx` | 페이지 넘기기 — 묶음 복사 · 내보내기 · 셸 바로 실행 · 결과 붙여 넣기(→ 본문 제안) · 셸 없을 때 명령 안내 |
| `TodayScreen.tsx` | 오늘 = 입력란 → 받은 것 흐름(`Fragment`, 정리 제안 받기 · 빼기 · 다른 곳 · 페이지에 잇기) → 최근 바뀐 페이지 |
| `TriagePanel.tsx` | 'Claude 에게 정리 맡기기' — 정리 묶음 복사 · 셸 바로 실행 · 결과 붙여 넣기 |
| `DesktopRuns.tsx` · `DesktopRunLines.tsx` · `desktop.ts` | 데스크톱 셸 브리지(`triage-<범주>` 대상은 정리 결과로, 그 밖은 페이지 id — 본문 제안으로 들인다) |
| `QuickAdd.tsx` | + 단추(오늘 화면 밖에서만). 페이지에 있으면 그 페이지에 바로 잇는다 |
| `ArchiveScreen.tsx` · `SourcePicker.tsx` | 보관함(자료 · 메모 · 페이지 제목 · 자료 검색) · 페이지에 자료 붙이기 |
| `TopicSheet.tsx` · `parts.tsx` | 범주(주제) 머리 드롭다운(`WorkspaceSwitcher` — 오늘 · 페이지 · 보관함 탭 머리) · 칩 · 만들기, 공용 부품(Card · H · Muted · Pill · Field · Fold) |
| `ConflictPanel.tsx` · `DriveBanner.tsx` · `ConfirmHost.tsx` · `io.ts` | 저장 충돌 · Drive 알림 · 확인 창 · 복사/내보내기 |
| `JudgmentsCard.tsx` | 설정의 판단 기록(정리 제안 · 본문 제안) |
| `drive/` | Google Identity · Picker(웹) · 로컬 Drive(개발) 설정 |

## 규칙

- 화면은 core 함수의 결과(바뀐 색인 · 문서 · 조각 · 매니페스트)를 `WorkContext` 로 저장만 한다. 판단 로직을 화면에 쓰지 않는다.
- 매니페스트 · 색인을 바꾸는 저장은 함수로 넘긴다(`saveManifest((m) => …)` · `commitPages(ws, (pages) => …)`) — MCP · 다른 기기가 그사이 써도 최신본에 다시 얹힌다. 다시 얹혀도 같은 결과가 나오게(예: 위/아래는 '이 페이지 앞으로 옮기기'로).
- 본문은 편집기가 바뀐 때만 넘긴다. 바깥에서 본문이 바뀌면(제안 받기 · 되돌리기) 편집기 `key` 를 바꿔 새로 만든다.
- Drive 저장은 4~8초 걸린다. 화면은 먼저 바뀐다(낙관적). 새로 고침 직후의 상태로 저장 실패를 판단하지 마라.
