/**
 * 모델에게 보여 주는 도구 목록 — 실행은 engine.ts 의 runTool 이 한다(이름 · 입력이 같아야 한다).
 * 바꾸는 도구(add · update · complete · delete)는 바로 실행되고 턴 끝 [되돌리기] 카드로 묶인다.
 * 보여 주기 · 제안 도구(show_tasks · propose_*)는 카드만 띄우고 데이터를 바꾸지 않는다.
 */
/** Messages API 의 사용자 정의 도구 모양(SDK 없이 쓰는 공용 패키지라 직접 적는다) */
export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown> & { type: "object" };
}

const SCOPE = { type: "string", enum: ["today", "tomorrow", "week", "overdue", "all", "done"] } as const;
const WHEN = "기기 시간대의 날짜 'YYYY-MM-DD' 또는 시각 'YYYY-MM-DDTHH:mm'. 사용자가 날짜를 말하지 않았으면 넣지 않는다.";
const TASK_REF = "할일 id. id 를 모르면 할일 제목을 넣으면 열린 할일과 맞춰 찾는다.";

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "add_task",
    description: "할일 하나를 만든다. 같은 제목의 열린 할일이 있으면 만들지 않고 Already exists 를 돌려준다(그땐 다시 부르지 않는다).",
    input_schema: {
      type: "object",
      properties: { title: { type: "string", description: "짧은 할일 제목(사용자 언어)" }, due: { type: "string", description: WHEN }, notes: { type: "string" } },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "update_task",
    description: "열린 할일의 제목 · 마감 · 메모를 바꾼다. 마감을 지우려면 due 에 빈 문자열.",
    input_schema: {
      type: "object",
      properties: { task: { type: "string", description: TASK_REF }, title: { type: "string" }, due: { type: "string", description: WHEN }, notes: { type: "string" } },
      required: ["task"],
      additionalProperties: false,
    },
  },
  {
    name: "complete_task",
    description: "할일을 완료로 표시한다. 여러 개면 같은 답에서 하나씩 모두 부른다.",
    input_schema: { type: "object", properties: { task: { type: "string", description: TASK_REF } }, required: ["task"], additionalProperties: false },
  },
  {
    name: "delete_task",
    description: "할일을 휴지통으로 옮긴다(7일 안에 되살릴 수 있다). 일정이 아니라 할일 전용.",
    input_schema: { type: "object", properties: { task: { type: "string", description: TASK_REF } }, required: ["task"], additionalProperties: false },
  },
  {
    name: "add_event",
    description:
      "캘린더 일정을 만든다. 남과 만나는 약속(회의 · 미팅 · 약속 · 예약 · 면담 · 모임 · 세미나)일 때만 쓴다. '~하기 · 연락 · 운동 · 사기' 처럼 혼자 하는 일은 add_task.",
    input_schema: {
      type: "object",
      properties: { title: { type: "string" }, start: { type: "string", description: "날짜 'YYYY-MM-DD'(종일) 또는 'YYYY-MM-DDTHH:mm'" } },
      required: ["title", "start"],
      additionalProperties: false,
    },
  },
  {
    name: "add_scrap",
    description: "남겨 둘 만한 생각 · 결정 · 정보 · 감정을 기록(스크랩)으로 저장한다. 인사 · 질문 · 명령은 저장하지 않는다.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string" }, label: { type: "string", enum: ["아이디어", "메모", "회고", "감정", "결정", "계획", "정보", "기타"] } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "list_tasks",
    description: "할일 목록을 글로 읽는다(카드 없음). 개수 · 남은 일 · 특정 할일 확인처럼 답이 현재 목록에 달렸을 때. 사용자에게 보여 주려면 show_tasks.",
    input_schema: { type: "object", properties: { scope: SCOPE }, required: ["scope"], additionalProperties: false },
  },
  {
    name: "list_events",
    description: "앞으로의 일정을 글로 읽는다. days: 오늘부터 며칠(기본 7).",
    input_schema: { type: "object", properties: { days: { type: "integer" } }, additionalProperties: false },
  },
  {
    name: "show_tasks",
    description: "사용자가 할일을 보여 달라고 할 때 그 범위의 할일 카드를 띄운다. 카드가 실제 할일을 그리므로 본문에 제목을 나열하지 않는다.",
    input_schema: { type: "object", properties: { scope: SCOPE }, required: ["scope"], additionalProperties: false },
  },
  {
    name: "propose_overdue",
    description: "기한 지난 할일을 버튼 카드([완료] · [오늘로] · [삭제])로 띄운다. 처리 방법을 글로 나열하지 말고 이 도구를 쓴다. 아무것도 바꾸지 않는다.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "propose_tasks",
    description:
      "생각을 한꺼번에 쏟아낸 말(여러 줄 메모 · 이번 주 할 거 나열)에서 할일을 뽑아 제안 카드로 띄운다. 사용자가 [추가] 를 눌러야 생긴다. 분명히 만들라고 한 한두 건은 add_task 를 쓴다.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "object", properties: { title: { type: "string" }, due: { type: "string", description: WHEN } }, required: ["title"], additionalProperties: false },
        },
        note: { type: "string", description: "할 일이 아닌 내용을 한두 문장으로 정리(없으면 생략)" },
      },
      required: ["items"],
      additionalProperties: false,
    },
  },
  {
    name: "recall",
    description:
      "시냅스(기록 · 할일에서 뽑은 개념 그래프)에서 질문과 이어진 개념을 찾아, 관련 기록 · 할일을 카드로 보여 준다. '전에 ~ 뭐라고 했지', '~ 관련 기록', '~ 얘기 했었나' 처럼 지난 기록을 떠올리는 질문에 쓴다. 결과에 없는 내용을 지어내지 않는다.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "찾을 개념 · 주제(한두 단어)" } }, required: ["query"], additionalProperties: false },
  },
];
