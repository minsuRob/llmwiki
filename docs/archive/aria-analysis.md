# Aria 정적 분석 보고서

- 대상: Mac App Store 설치본 `/Applications/Aria.app`, 번들 ID `ko.aria.app`, 버전 1.0(빌드 410)
- 방법: **정적 분석만** 했다. arm64 슬라이스를 분리하고, UTF-8 문자열을 오프셋과 함께 뽑고, `Metadata.appintents`를 읽었다. 앱은 실행하지 않았고 Aria 서버에도 요청을 보내지 않았다.
- 표기: 문자열 오프셋은 arm64 슬라이스 기준 파일 오프셋(16진수)이다. **확인**은 문자열·메타데이터로 직접 본 것, **추정**은 정황으로 미루어 본 것이다.
- 남기지 않은 것: 프롬프트·스키마 원문과 디컴파일 결과는 저장소에 옮기지 않았다. 설계에 쓸 사실만 요약했다. 키처럼 보이는 값은 원문 없이 있고 없음만 적었다.

## 1. 아키텍처 요약

```
┌──────────────── Aria 앱 (SwiftUI + SwiftData, iOS/macOS 한 코드베이스) ────────────────┐
│  시스템 프롬프트·도구 JSON Schema(약 40개)를 앱 안에 보유                               │
│  AIService ─ AIToolKit(도구를 앱 안에서 실행: SwiftData·EventKit·날씨)                  │
│      │  ▲ 도구 결과를 다음 요청에 붙여 루프                                              │
│      ▼  │                                                                              │
│  AnthropicSSE (content_block_delta / input_json_delta / thinking 직접 파싱)             │
│  ChatCardUndoLedger (카드 단위 되돌리기)   CreditLedger (일일 한도)                     │
└──────┬──────────────────────────────────────────┬──────────────────────────────────────┘
       │ HTTPS POST /functions/v1/chat (SSE)      │ PostgREST / Realtime(postgres_changes) / Storage
       ▼                                          ▼
┌──────────────── Supabase ───────────────────────────────────────────────────────────────┐
│  Edge Function chat  → Anthropic (claude-sonnet-4-6 / claude-haiku-4-5), 토큰 계량      │
│  Edge Function apple-verify → StoreKit 영수증 검증                                       │
│  Postgres + pgvector: ai_chat_messages, memory_facts, knowledge_nodes/edges, routine_logs │
│  RPC: match_memory_facts, match_knowledge_nodes, aria_synapse_density(_at) …            │
└────────────────────────────────────────────┬────────────────────────────────────────────┘
                                             ▼
                                OpenAI (임베딩 전용, 앱 고지 문구 기준)
```

핵심은 **두꺼운 클라이언트, 얇은 서버**다. 앱이 프롬프트를 조립하고, 도구를 실행하고, 카드를 그린다. 서버 함수는 모델 호출을 대신하고 사용량을 계량하는 프록시에 가깝다(추정).

## 2. 질문별 답

### Q1. 채팅 요청 형식

**확인**
- 엔드포인트 문자열 `/functions/v1/chat`은 `claude-sonnet-4-6`, `claude-haiku-4-5` 문자열과 같은 상수 묶음에 있다. 같은 묶음에 Supabase publishable 키(`sb_publishable_…` 형식)도 있다. 원문은 옮기지 않았다.
- `cache_control`, `ephemeral` 문자열이 있다. 둘은 Anthropic의 프롬프트 캐시 지정 필드다.
- 앱이 스트리밍 이벤트를 직접 다룬다. 이벤트 이름 `content_block_start`, `content_block_delta`, `input_json_delta`, `redacted_thinking`, `thinking`과 사용량 필드 `cache_creation_input_tokens`, `cache_read_input_tokens`, 오류 이름 `overloaded_error`, `rate_limit_error`가 있다. 타입 이름은 `AnthropicSSE`다.

**추정**
- 요청 본문은 Anthropic Messages API 모양 그대로일 가능성이 크다(`model`, `system`(cache_control 포함), `messages`, `tools`, `stream`, `thinking`). 어떤 모델을 쓸지는 **클라이언트가 고른다**. 도구 스키마도 **클라이언트가 보낸다**.
- Ghidra로 호출 지점까지 추적하지는 않았다. 54MB 바이너리라 자동 분석에 시간이 오래 걸린다. 필드 순서와 정확한 키는 미확인이다.

### Q2. 시스템 프롬프트 구성

**확인**
- 대화용 시스템 프롬프트는 앱 안에 블록 단위로 들어 있다. 오프셋 0x012d63e0~0x01308000 부근이다. 블록은 대괄호 머리표로 나뉜다.
  - 언어, 시각 해석(24시간제), 페르소나 말투, 답변 리듬
  - 기억, 관련 컨텍스트(RAG), 루틴 요약, 카테고리
  - 직전 답변의 목록 카드(지시어 해석용 행과 id), 직전 답변의 근거
- **턴 종류별 지시**가 따로 있다. "찾아보고 답할 말"이면 첫 줄에 예고 한 문장을 쓴다. "짧은 한마디"면 세 문장 이하로 답한다. 앱이 메시지를 분류한 뒤 해당 블록을 끼워 넣는다.
- **기능별 별도 프롬프트**도 있다.
  - 데일리 브리핑: JSON 카드 출력 (0x01308480)
  - 캘린더·할일 재배치 제안: ops 배열이며, 적용 전 제안만 한다 (0x0130a960)
  - 브레인 덤프 분류: `{"tasks":[…],"journal":…,"label":…}` (0x0130bfc0)
  - 지식 그래프 엔티티·관계 추출: 감정 노드 정규화 규칙 포함 (0x0130c9b0)
  - 대화 요약: 6~12개 불릿, 상대 날짜 금지, 이전 요약과 병합 (0x012d97b0, 0x012d9a70)

**추정**
- 대화에는 Sonnet, 브리핑·분류·추출·요약 같은 배경 작업에는 Haiku를 쓰는 것 같다. 모델 문자열이 둘뿐이고 배경 작업 프롬프트는 JSON 단발 출력이라 이렇게 본다.

### Q3. 도구 스키마와 실행 흐름

**확인**
- 도구마다 설명 문자열과 JSON Schema 문자열(`"additionalProperties": false`)이 쌍으로 들어 있다(0x012f6b50~).
- 즉시 실행하는 도구: `add_task`, `update_task`, `complete_task`, `delete_task`, `bulk_tasks`, `schedule_tasks`, `add_journal_entry`, `add_calendar_event` 등.
  - `delete_task`는 휴지통으로 옮기고 7일 안에 복구할 수 있다.
  - 스크랩 삭제는 소프트 삭제이고, 카드에서 되돌릴 수 있다.
- **제안 카드**로 끝나고 사용자가 눌러야 실행되는 도구: `propose_reminder`, `propose_routines`, `propose_task_action`, `propose_task_order`, `propose_tasks`, `propose_weather`.
  - `propose_task_action`: 버튼은 [완료]/[오늘로 미루기]/[삭제]이고, 누를 때 실행된다.
  - `propose_reminder`: 사용자가 [추가]를 눌러야 할일과 알림·지오펜스가 생긴다.
  - `propose_tasks`, `propose_weather`: 카드 데이터를 **앱이 채운다**. 모델은 숫자나 제목을 본문에 나열하지 말라는 지시를 받는다. 카드와 본문이 중복되지 않게 하려는 것이다.
- 대량 작업은 id 나열 대신 핸들러에 맡긴다. `bulk_tasks(action, scope)`와 `schedule_tasks(assignments 생략 시 자동 배분)`는 앱이 대상을 직접 가져온다. "id를 하나씩 복사하면 누락된다"는 경험에서 나온 설계다.
- id 대신 **제목을 넣어도** 앱이 열린 할일과 매칭한다. 같은 할일이 이미 있으면 `Already exists`를 돌려준다(중복 차단).
- 캘린더(EKEvent)는 휴지통이 없어서, 종류가 어긋난 삭제·수정은 실행하지 않고 멈춘다. 반복 일정은 채팅에서 수정·삭제를 막는다.

**추정**
- 도구는 앱 안(AIToolKit)에서 실행된다. 오류 문자열 "no task with id"와 "failed to save changes"가 SwiftData 저장 경로에 붙어 있어서 이렇게 본다.

### Q4. 되돌리기

**확인**
- `ChatCardUndoLedger`가 `AriaFeatures` 모듈 안에 있다.
- `ai_chat_messages` 행에 `created_task_ids`, `completed_task_ids`, `referenced_task_ids`, `deleted_task_titles` 필드가 있다(0x013159a0).
- 프롬프트에 "[전체 되돌리기] 하나로 떴어요", "전체 되돌리기 가능"이 있다. 카드 하나에 일괄 되돌리기가 붙는다는 뜻이다.

**추정**
- 메시지 행에 "이 턴이 만든 것·끝낸 것·지운 것"을 기록한다. 되돌리기는 그 id들을 반대로 적용한다. 만든 것은 삭제하고, 끝낸 것은 미완료로 돌리고, 지운 것은 휴지통에서 복원한다.
- 로컬에서 바꾸면 Supabase 동기화로 서버에도 반영되는 것 같다.

### Q5. 로컬·서버 동기화

**확인**
- 원본은 SwiftData다. `aria-realtime-sync` 채널에서 `postgres_changes`를 구독한다.
- Storage 버킷을 쓰고, 문서 저장소에는 "이 기기에 아직 내려받지 않은 파일"이 존재한다.

**추정**
- 로컬을 먼저 쓰고 Supabase로 올리는 오프라인 우선 구조로 보인다. 테이블 대응표는 미확인이다.

### Q6. 시냅스와 기억

**확인**
- RPC는 `match_memory_facts`, `match_knowledge_nodes`(`query_embedding` 인자)다.
- 백필 플래그 `rag.embeddingBackfill.v1`이 있다.
- 기억 종류 enum은 `value`, `person`, `project`, `preference`, `emotionPattern`, `fact`다. 사용자가 직접 기억하라고 한 것은 **고정(감쇠 없음)**이다.

**추정**
- 임베딩 생성은 서버(OpenAI)가 한다. 엔티티 추출 프롬프트가 앱에 있으므로 노드·엣지 추출은 클라이언트가 Haiku로 호출하는 것 같다.
- `aria_synapse_density`와 `aria_synapse_rule`은 그래프 밀도·연결 규칙을 기록하는 설정·통계 키로 보인다. 의미는 미확인이다.

### Q7. 크레딧 계량

**확인**
- 키: `credit.dailyLimit`, `credit.usedToday`, `credit.serverMetered`, `tokens.usedToday`, `tokens.weighted.usedToday`

**추정**
- 서버가 토큰을 가중 합산해 일일 한도를 계량한다. 앱은 표시용 카운트만 갖는다. 한도 값과 구독별 차이는 바이너리에서 찾지 못했다(서버 응답으로 받는 것 같다).

### Q8. 선제 알림과 브리핑

**확인**
- 플래그 `aria.proactive.nudge`가 있다.
- `BriefingService`가 있고, 갱신 키는 `briefing.driftRefreshDay`, `briefing.languageRefreshDay`다. 브리핑은 JSON 카드이고, 제안은 하나까지만 낸다.

**추정**
- BGTask `ko.aria.app.refresh`는 브리핑 미리 생성과 리마인더 재계산을 한다(미확인).

### Q9. 앱 인텐트·위젯

**확인**
- `Metadata.appintents` 액션: `AddTaskIntent`, `AddScrapIntent`, `AskAriaIntent`
- 위젯 확장: `ko.aria.app.widgets`

## 3. 이 저장소의 구현(aria-rn)에 옮긴 것과 피한 것

`aria-rn/`은 위 구조를 RN + RN web(Expo)으로 다시 만든 실험 앱이다. Aria의 프롬프트·스키마 원문은 쓰지 않고, 구조만 가져와 새로 썼다.

**옮긴 것**
1. **두꺼운 클라이언트, 도구 실행은 앱에서.** 모델은 도구 호출만 내고, 할일·일정·기록은 앱의 실행기(`src/lib/engine.ts`)가 바꾼다.
2. **턴 단위 되돌리기.** 한 턴에 만든·끝낸·지운 id를 모아 카드 하나에 [되돌리기]를 단다. 그 사이 사용자가 완료한 할일은 지우지 않는다.
3. **제안과 실행의 분리.** `propose_overdue`(완료·오늘로·삭제 단추)와 `propose_tasks`(추가·빼기)는 카드만 띄우고, 사용자가 눌러야 바뀐다.
4. **카드 데이터는 앱이 채운다.** 모델은 범위·id만 정하고, 제목·마감·완료 여부는 앱이 지금 데이터에서 그린다. 그래서 본문에 목록을 다시 나열하지 않게 한다.
5. **제목 매칭과 중복 차단.** id 대신 제목을 넣어도 열린 할일과 맞추고, 같은 제목은 `Already exists`로 막는다.
6. **할일과 일정의 경계.** 남과 만나는 약속만 일정으로 만든다.

**다르게 한 것**
1. **키가 없어도 동작한다.** API 키가 없으면 기기 안 한국어 규칙(`src/lib/local.ts`)이 같은 도구 호출을 만든다. 그래서 같은 카드가 뜬다.
2. **규칙은 코드로.** 중복 차단, 기한 지남 계산, 되돌리기 안전 규칙은 프롬프트가 아니라 실행기에 둔다.
3. **키 노출.** 이 앱은 개인 실험용이라 사용자가 넣은 키로 앱에서 바로 API를 부른다. 여럿에게 배포하려면 Aria처럼 서버 프록시 뒤로 옮겨야 한다.
