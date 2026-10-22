# features/work — 작업실 화면

설계 · 흐름: `docs/inbox-today.md`. 규칙 함수: `packages/core/src/work.ts` · `workTriage.ts` · `workHandoff.ts`.

## 지도

| 파일 | 화면 · 역할 |
|---|---|
| `WorkContext.tsx` | **저장 경로 하나.** 기기 · Drive 저장소 선택, 업무 · 조각 · 매니페스트 저장(`saveItem` · `saveSource` · `saveManifest` — 충돌하면 최신본에 다시 적용), `capture` · `applyTriage` · `prepareTriage` · `importTriageText` · `prepare` · `importText` |
| `TodayScreen.tsx` | 오늘 = 받은 것 중심: 입력란 → 받은 것 흐름(`Fragment`) → 판단이 필요해요 → 오늘 위키에 더해진 것 → 이어서 할 업무 |
| `TriagePanel.tsx` | 'Claude 에게 정리 맡기기' — 정리 묶음 복사 · 셸 바로 실행 · 결과 붙여 넣기 |
| `WorkListScreen.tsx` · `PlanCards.tsx` | 업무 탭 — 추천 · 가까운 마감 · 상태별 목록 · 새 업무 |
| `WorkDetailScreen.tsx` | 업무 상세 — 목표 · 상태 · 다음 행동 · 결과물 · 검토 카드(`ReviewCards`) · 원본 자료 · 기록 |
| `RawView.tsx` | 원본 보기 — 업무 요약을 Lexical 리치 텍스트(문서) · 마크다운으로 |
| `summaryMarkdown.ts` | 사람이 읽는 업무 요약 마크다운(Drive '업무 요약' 폴더에도 같은 것) |
| `HandoffPanel.tsx` · `ImportPanel.tsx` | 업무 맥락 묶음 내보내기 · 결과 가져오기 |
| `DesktopRuns.tsx` · `DesktopRunLines.tsx` · `desktop.ts` | 데스크톱 셸 브리지(`triage-<범주>` 대상은 정리 결과로 들인다) |
| `QuickAdd.tsx` | + 단추(오늘 화면 밖에서만). 업무 상세에선 그 업무에 바로 잇는다 |
| `ArchiveScreen.tsx` · `SourcePicker.tsx` | 보관함 · 자료 고르기 |
| `TopicSheet.tsx` · `parts.tsx` | 범주(주제) 칩 · 만들기, 공용 부품(Card · H · Muted · Pill · Field · Fold) |
| `ConflictPanel.tsx` · `DriveBanner.tsx` · `ConfirmHost.tsx` · `io.ts` | 저장 충돌 · Drive 알림 · 확인 창 · 복사/내보내기 |
| `drive/` | Google Identity · Picker(웹) · 로컬 Drive(개발) 설정 |

## 규칙

- 화면은 core 함수의 결과(바뀐 업무 · 조각 · 매니페스트)를 `WorkContext` 로 저장만 한다. 판단 로직을 화면에 쓰지 않는다.
- 매니페스트를 바꾸는 저장은 함수로 넘긴다(`saveManifest((m) => …)`) — MCP 가 그사이 써도 최신본에 다시 얹힌다.
- Drive 저장은 4~8초 걸린다. 화면은 먼저 바뀐다(낙관적). 새로 고침 직후의 상태로 저장 실패를 판단하지 마라.
