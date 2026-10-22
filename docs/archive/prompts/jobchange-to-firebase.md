# 취준 자료를 실제 Firebase(llmwiki-minsu)에 올리기 — 작업 프롬프트

## 목표
https://llmwiki-minsu.web.app 에 Google 계정(uid `BMcKkiTVEnRNLPfuZrS7opIHyc93`)으로 들어가면
취준 영역에 **공고 · 지원 진행현황 · 할 일 · 마감 일정 · 결정**이 보이게 한다. 원본 파일은 읽기만 하고, 다시 실행해도 중복이 생기지 않게 한다.

## 지금 상태 [사실 — 2026-10-20 확인]
- 배포본(`main` 4c13dba)의 탭은 대화·할일·일정·기록·시냅스·설정뿐이다. 업무·영역(jobChange) 개념이 없다.
- 실제 계정 데이터: 할일 1 · 일정 1 · 기록 2 · 개념 3 · 연결 3. 모두 로그인 테스트용이고 취준 데이터는 0건이다.
- 저장 위치: `users/{uid}/{tasks|events|scraps|messages|nodes|edges}/{id}` (`functions/src/store.ts`).
  `firestore.rules`가 앱 쓰기를 막아서 **쓰기는 Cloud Functions 또는 Admin SDK만** 할 수 있다.
- 타입: `packages/core/src/types.ts` — Task(title, notes, due, done…), CalendarEvent(title, start), Scrap(text, label ∈ 아이디어·메모·회고·감정·결정·계획·정보·기타).
- 업무 위임 코어: `packages/core/src/handoff.ts`(buildBundle, validateResult, splitSections). 저장소 연결과 화면은 없다.
- 취준 원본은 저장소 밖에 있다. `tools/local-model-eval/src/build_cases.py`가 읽는 구조는 이렇다.
  - `<구직 폴더>/인디스워크/.data/posts.json` — 공고 목록. 필드: id, company, pos, short, career, it, ai, aititle, tool, due, jobs, startup
  - `<구직 폴더>/인디스워크/.data/text/{id}.txt` — 공고 본문
  - `그룹바이-진행현황.md`(P), `인디스워크-개요.md`(O) — 지원 진행현황과 개요

## 사람에게 먼저 받을 것 (없으면 멈추고 물어라)
1. `<구직 폴더>`의 실제 경로
2. 그룹바이 진행현황 문서의 위치와 형식. 회사별 단계(서류·코테·면접·결과)와 날짜가 어떻게 적혀 있는지
3. 올릴 범위: 전체 공고 / IT·개발(`it=true`)만 / 진행현황에 있는 회사만
4. 마감(`due`)이 지난 공고를 넣을지 여부
5. 적재 방식: 일회성 Admin 스크립트(서비스 계정 키 필요) / `importJobChange` 같은 Function 추가

## 넣을 데이터 — 1단계 (현재 스키마 그대로, 화면 수정 없음)
| 원본 | Firestore | 매핑 | 문서 id(멱등) |
|---|---|---|---|
| 진행현황의 지원 건 | `tasks` | title=`[취준] {회사} {포지션} — {다음 단계}`, due=다음 단계 날짜, notes=현재 단계·근거 줄(`P:12`) | `jc-task-{회사·포지션 해시}` |
| 진행현황의 면접·코테 일시 | `events` | title=`[취준] {회사} {단계}`, start | `jc-ev-{해시}` |
| 공고(posts.json + text) | `scraps` | label=`정보`, text=회사·공고·마감·경력·본문 요약(원문 링크/경로 포함) | `jc-post-{id}` |
| 확정된 판단(지원 안 함, 우선순위 등) | `scraps` | label=`결정` | `jc-dec-{해시}` |

- 날짜는 원본에 있는 것만 쓴다. 없으면 `due: null`로 두고 지어내지 마라. Gemma가 날짜를 지어낸 실측이 있다.
- 모든 문서에 `createdAt`(적재 시각, ISO)을 넣는다. Firestore에 `undefined`를 넣지 마라(`clean()` 참고).
- 적재 뒤 시냅스를 다시 계산한다(설정 탭 "시냅스 다시 계산" 또는 해당 함수).

## 2단계 (스키마 확장 — 1단계 확인 뒤)
- `areas`(jobChange·personal·dev·sideJob) 컬렉션을 두고, task·event·scrap에 `area?: string`을 붙인다. 할일·기록 탭에 영역 필터를 단다.
- `works`(업무: goal, criteria[], status, decisions[], sourceRefs[])와 `runs`(runId, contextVersion, 결과 원문 해시, validateResult 결과)를 추가한다. 이걸 handoff.ts와 잇는다.
- `store.ts`의 `COLLECTIONS`, `types.ts`의 `AppState`/`emptyState`, `aria-rn/src/firebase/data.tsx` 구독을 함께 바꾼다.

## 지킬 것
- 원본 파일은 읽기만 한다. 개인정보(연락처, 주민번호류)가 본문에 있으면 넣지 말고 보고한다.
- 실제 프로젝트에 쓰기 전에 에뮬레이터(`firebase emulators`)에서 같은 스크립트를 먼저 돌려 건수를 확인한다.
- 실서버 쓰기는 사람의 확인을 받은 뒤 한 번만 한다. 기존 테스트 데이터 4건은 지우지 않는다.
- 커밋은 `feat/work-handoff`가 아니라 새 브랜치(`feat/jobchange-import`)에 한다.

## 완료 기준
- [ ] 에뮬레이터 적재 결과: 종류별 건수 표(tasks/events/scraps)와 원본 건수가 맞는다
- [ ] 같은 스크립트를 두 번 돌려도 건수가 늘지 않는다
- [ ] 실서버 적재 뒤 웹 설정 탭의 데이터 건수가 예상과 같다
- [ ] 할일 탭에 `[취준]` 할 일이 마감 순으로 보이고, 기록 탭 `정보` 필터에 공고가 보인다
- [ ] 날짜가 원본에 없는 항목에 due/start가 들어간 경우가 0건이다
- [ ] 보고: 넣은 것 · 뺀 것(이유) · 원본에서 해석 못 한 줄 목록
