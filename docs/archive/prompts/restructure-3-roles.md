# llmwiki 를 3역할 구조로 바꾸기 — 현황 정리 프롬프트

## 역할
너는 이 저장소(minsuRob/llmwiki)를 맡은 아키텍트다. 아래 **목표 구조**로 옮기기 위한 분석과 단계별 계획을 만든다.
**코드부터 고치지 말고** 계획을 먼저 낸다. 모든 주장에 [사실]·[추정]·[확인 필요] 중 하나를 붙인다.
[사실]은 저장소나 실서버에서 직접 확인한 것에만 쓴다. 이전 프롬프트에 "[사실]"로 적혀 있던 work.ts·workHandoff.ts·importResult 는 실제로 없다.

## 목표 구조 (사용자 결정, 저장소에는 아직 기록 없음)
| 역할 | 하는 일 | 예시 |
|---|---|---|
| ① 앱 — 업무 관리 | 목표·현재 상태·결정·다음 할 일·최신 결과물을 보여 준다 | "실적 보고서 초안 완료, 수치 확인 필요" |
| ② Claude·Codex — AI 작업 | 업무 맥락을 받아 분석·작성하고 결과를 돌려준다. **우리 MCP 로 연결** | "지난 자료를 참고해 이번 달 보고서 작성" |
| ③ Google Drive — 자료 저장 | 원본 자료·결과물·업무 상태를 보관한다. 우리 서비스가 API 로 연결 | 실적 시트, 보고서, 결정 이력 |

- 흐름: 앱에서 업무 선택 → AI 에 맥락 전달 → AI 작업 → 결과를 Drive 에 저장 → 앱의 현재 상태·다음 행동 갱신
- 사용자는 앱 버튼으로 처리해도 되고, AI 에게 "이 결과를 해당 업무에 반영해 줘"라고 해도 된다. **두 경로 모두 같은 업무 처리 규칙**을 쓴다.
- **Firestore 는 필요한 운영 정보에만 최소한으로** 쓴다.
- 핵심 기능 3가지: **프로젝트 복귀 카드 · AI 인수인계 · 결정의 기억**

## 현재 구조 [사실 — 2026-10-20 저장소·실서버 확인]

### 저장소
- 브랜치: `main`(4c13dba) · `feat/work-handoff`(작업 중, main + 2커밋 + 커밋 안 한 취준 변경) · `feat/obsidian-graph`(PR #1 열림, 옵시디언식 그래프 `core/vault.ts`)
- 이 폴더는 2026-10-20 GitHub 에서 새로 clone 했다. 3역할 구조를 구현한 코드는 어떤 브랜치·커밋·저장소에도 없다.

| 폴더 | 내용 | 3역할과의 관계 |
|---|---|---|
| `aria-rn/` | Expo 57 앱(RN + 웹). 탭: 대화·할일·일정·기록·**취준**·시냅스·설정. Google 로그인(익명 → Google 연결). Firestore 를 읽기만 하고 쓰기는 함수 호출로만 | ①의 자리지만 지금은 "할일 비서"다. **업무 화면 없음** |
| `functions/` | Cloud Functions(asia-northeast3): `chat` · `cardAction` · `taskAction` · `rebuildSynapse` · `jobsSync`. `store.ts` 가 상태 전체를 읽고 → core 로 바꾸고 → 바뀐 문서만 Firestore 에 씀. `ANTHROPIC_API_KEY` 가 있으면 Claude 가 도구를 고름 | 업무 처리 규칙을 서버에서 돌리는 자리. **MCP 아님** |
| `packages/core/` | 순수 함수(TS). `engine.ts`(도구 실행기·되돌리기) · `toolDefs.ts`(모델용 도구 목록) · `local.ts`(키 없을 때 한국어 규칙) · `dates.ts` · `synapse.ts`(개념 그래프) · `types.ts`(Task·CalendarEvent·Scrap·Card·ChatMessage·Graph) · **`handoff.ts`**(`buildBundle` 맥락 묶음, `validateResult` 결과 검증 — 결과는 언제나 '제안') · **`jobs.ts`**(취준 공고 정규화·지난 공고 거르기) | `handoff.ts` 만 ②와 직접 맞닿음. 업무(Work)·결정·제안 타입 없음 |
| `tests/` | 에뮬레이터 통합 테스트 8개(`api.test.mjs`), 클라우드 확인(`cloud-smoke.sh`) | — |
| `tools/local-model-eval/` | Gemma·Laya 평가, 서버 작업 큐 `jobd/jobd.py` + **MCP `oci-jobs-mcp.mjs`**(Gemma 작업 제출·조회), 실행자 시제품 `prototype/`(Claude `claude -p`, Codex `codex exec` 어댑터 · runner — 가짜 실행자로만 시험) | ②의 실행자·MCP 시제품. **앱 맥락을 넘기는 MCP 는 아님** |
| `docs/local-models/` | 로컬 모델 검증 문서. `decisions.md`(코드/Gemma/Claude/사람 역할 분담), `runtime.md`(**Electron 앱** + Oracle 서버 구조 계획), `next.md` | 3역할과 다른 실행 구조(Electron)가 적혀 있다 — 정리 필요 |
| `docs/prompts/` | `jobchange-to-firebase.md`(취준 공고를 Firestore 에 넣는 계획 — 3역할과 어긋남) | 폐기 또는 수정 대상 |

### 실서버 Firestore (`llmwiki-minsu`) — 전부 `users/{uid}/…`
| 계정 | 컬렉션 |
|---|---|
| 본인(Google · minsu.rob@gmail.com, `BMcKkiTVEnRNLPfuZrS7opIHyc93`) | tasks 1 · events 1 · scraps 2 · messages 6 · nodes 3 · edges 3 · **jobs 2,295 · jobTexts 1,783** |
| 익명 테스트 계정 2개(`1zRR…`, `GRFV…`) | 대화·기록·시냅스 테스트 데이터 |

- 규칙: 본인 데이터 읽기만, 쓰기는 전부 함수(Admin).
- 데이터 6종(할일·일정·기록·대화·개념·연결)은 Aria 구조에서 온 것이고, jobs·jobTexts 는 2026-10-20 에 추가했다.
- Hosting: https://llmwiki-minsu.web.app (`aria-rn/dist`).

### 원본 자료 (저장소 밖)
- Obsidian 볼트 `obsidian-for-me/Personal/구직/` — 그룹바이 상세 조사 519건(`.groupby-data/out/*.json`), 인디스워크 1,790건(`인디스워크/.data/posts.json` + `text/*.txt`), 정리 문서(`그룹바이.md`, `그룹바이-진행현황.md`(조사 진행 기록, 지원 기록 아님), `구직리서칭방법.md`, `생각등대/`)
- 넣는 스크립트: `functions/scripts/import-jobs.ts`(`--via admin|function`, 다시 돌려도 바뀐 것만 씀)

## 목표와의 차이 [사실]
| 목표 | 지금 | 차이 |
|---|---|---|
| 업무(목표·완료 기준·상태·결정·다음 할 일·최신 결과물) | 할일·일정·기록뿐 | 업무 모델·화면 없음 |
| 복귀 카드 | 없음 | 없음 |
| AI 인수인계 | `buildBundle`·`validateResult` 순수 함수 | 저장·화면·실행 연결 없음 |
| 결정의 기억 | 기록 라벨 '결정' 정도 | 결정 이력(제안·확정·대체) 없음 |
| MCP 로 Claude·Codex 연결 | Gemma 작업 큐용 MCP 시제품만 | 앱 맥락 조회·결과 반영 MCP 없음 |
| Drive 에 자료·결과·상태 | 연동 없음 | OAuth 범위·폴더 구조·동기화 전부 미정 |
| Firestore 최소 | 모든 데이터 + 공고 4천여 건 | 정반대 |
| 버튼과 AI 요청이 같은 규칙 | 대화(Claude/규칙)와 버튼이 `engine.runTool` 을 같이 씀 | **이 원칙은 이미 있다** — 업무 규칙에도 그대로 옮길 수 있다 |

## 남길 만한 것 [추정 — 판단해서 확정할 것]
- `engine.ts` 의 "모델 길과 버튼 길이 같은 도구를 부른다" + 되돌리기 카드 구조 → 업무 처리 규칙의 뼈대
- `handoff.ts`(맥락 묶음·결과 검증·'언제나 제안') → AI 인수인계 핵심
- `aria-rn` 의 앱 뼈대·로그인·카드 UI, `functions` 의 호출 구조
- `jobs.ts` 정규화 로직(저장 위치만 바뀜)
- 시냅스·옵시디언 그래프는 3역할에서의 자리가 불분명 → 남길지 정할 것

## 확인해야 할 것 [확인 필요]
1. Firestore 에 남길 "운영 정보"의 범위: 사용자·Drive 연결 정보·run 색인·잠금? 업무 상태 자체는 Drive 인가?
2. Drive 저장 형식: 업무 1건 = 폴더? 상태는 JSON/Markdown? 앱 전용 폴더(appDataFolder)인가, 사용자에게 보이는 폴더인가(Obsidian 처럼 사람이 직접 열어 보게)?
3. Obsidian 볼트와 Drive 의 관계: 원본은 Obsidian 에 두고 Drive 에는 결과·상태만? 아니면 볼트를 Drive 로?
4. MCP 서버 위치: 로컬(stdio, Claude Code·Codex 에 등록) vs 원격(Functions/Cloud Run HTTP)? 인증은?
5. 기존 할일·일정·기록·대화·시냅스 기능을 계속 둘지, 업무 안으로 흡수할지
6. `docs/local-models/runtime.md` 의 Electron 계획과 이 구조의 관계(같은 앱의 데스크톱판인지, 버리는지)
7. 이미 넣은 jobs·jobTexts(4천여 건)와 익명 테스트 계정 처리

## 만들어 줄 것
1. **목표 구조도**: 앱 · MCP 서버 · Drive · Firestore(최소) · Claude/Codex 사이 데이터 흐름. 업무 1건이 만들어져 위임·결과 반영·확정까지 가는 순서
2. **데이터 위치표**: 업무·결정·제안·run·자료·결과물·공고·할일·기록마다 Drive / Firestore / 원본(Obsidian) / 기기 중 어디에 두는지와 이유
3. **기존 코드 처리표**: 파일·폴더마다 유지 / 옮김 / 이름 변경 / 폐기, 이유
4. **업무 처리 규칙 API**: 앱 버튼과 MCP 도구가 함께 부를 동작 목록(만들기·상태 바꾸기·결정 제안/확정·결과 반영·되돌리기). 입력·출력 모양, 모두 core 순수 함수로
5. **단계별 계획**: 각 단계가 끝나도 앱이 돌아가게. 단계마다 완료 기준(숫자·테스트)
   - 예: 1단계 문서화(`docs/architecture.md`) + 업무 모델 core → 2단계 Drive 저장소 어댑터 + 에뮬레이터/모의 테스트 → 3단계 복귀 카드 화면 → 4단계 MCP 서버 → 5단계 Firestore 정리
6. **위험**: Drive API 한도·OAuth 범위 심사, 오프라인·동시 수정 충돌, 회사 작업공간 자료, 되돌리기를 Drive 에서 어떻게 할지

## 지킬 것
- AI 결과는 언제나 '제안'이고, 확정은 사람이 한다(`validateResult` 원칙 유지).
- 실서버 데이터 삭제·이동, 배포, Drive 쓰기는 사람 확인 뒤에만 한다.
- Firestore 에 컬렉션을 새로 만들기 전에 Drive 나 원본 유지를 먼저 검토하고 이유를 적는다.
- 커밋은 새 브랜치에서 한다. 기존 테스트(`npm test`)는 단계마다 통과해야 한다.
- 계획을 받은 사람이 정할 것은 끝에 "결정할 질문"으로 따로 모은다.
