/** 앱이 다루는 데이터 — 할일 · 일정 · 스크랩(기록) · 대화. 모두 기기 안(AsyncStorage)에 둔다. */

export interface Task {
  id: string;
  title: string;
  notes?: string;
  /** ISO. 날짜만이면 "YYYY-MM-DD", 시각까지면 "YYYY-MM-DDTHH:mm" (기기 시간대) */
  due?: string | null;
  done: boolean;
  createdAt: string;
  completedAt?: string | null;
  /** 휴지통 — 지운 시각. 7일 안에 되살릴 수 있다 */
  deletedAt?: string | null;
  /** 옵시디언 일감 프론트매터 "상태". "완료" 는 done 이 맡으므로 저장하지 않는다. 없으면 진행중 */
  status?: TaskStatus | null;
  /** 옵시디언 일감 프론트매터 "우선순위". 없으면 중간 */
  priority?: TaskPriority | null;
  /** 작업실 — 이 할일이 속한 업무(work.ts). 없으면 예전처럼 홀로 선 할일 */
  workItemId?: string | null;
  /** 누가 만들었나 — 사용자가 직접(user) · AI 제안을 사용자가 받아들임(ai). 없으면 user */
  origin?: "user" | "ai";
  /** 근거 — 자료 · AI 작업 */
  basis?: { sourceIds?: string[]; runId?: string } | null;
  /** 먼저 끝나야 하는 할일 id */
  dependsOn?: string[];
}

export const TASK_STATUSES = ["진행중", "완료", "보류", "대기"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ["최우선", "중간", "하순위"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** 말 → 상태. "진행 중" · "hold" 처럼 흔한 변형도 받는다. 모르면 null */
export function asTaskStatus(v: unknown): TaskStatus | null {
  const s = typeof v === "string" ? v.replace(/\s+/g, "").toLowerCase() : "";
  if (!s) return null;
  if ((TASK_STATUSES as readonly string[]).includes(s)) return s as TaskStatus;
  const alias: Record<string, TaskStatus> = { 진행: "진행중", doing: "진행중", inprogress: "진행중", 완료됨: "완료", done: "완료", 홀드: "보류", hold: "보류", onhold: "보류", 대기중: "대기", todo: "대기", waiting: "대기" };
  return alias[s] ?? null;
}

/** 말 → 우선순위. "high" · "낮음" 같은 변형도 받는다. 모르면 null */
export function asTaskPriority(v: unknown): TaskPriority | null {
  const s = typeof v === "string" ? v.replace(/\s+/g, "").toLowerCase() : "";
  if (!s) return null;
  if ((TASK_PRIORITIES as readonly string[]).includes(s)) return s as TaskPriority;
  const alias: Record<string, TaskPriority> = { 높음: "최우선", 긴급: "최우선", high: "최우선", 보통: "중간", medium: "중간", mid: "중간", 낮음: "하순위", 하: "하순위", low: "하순위" };
  return alias[s] ?? null;
}

/** 지금 상태 — 끝냈으면 완료, 아니면 적어 둔 상태(없으면 진행중) */
export function taskStatus(t: Pick<Task, "done" | "status">): TaskStatus {
  if (t.done) return "완료";
  return t.status && t.status !== "완료" ? t.status : "진행중";
}

export function taskPriority(t: Pick<Task, "priority">): TaskPriority {
  return t.priority ?? "중간";
}

export interface CalendarEvent {
  id: string;
  title: string;
  /** "YYYY-MM-DD"(종일) 또는 "YYYY-MM-DDTHH:mm" */
  start: string;
  createdAt: string;
  deletedAt?: string | null;
}

export const SCRAP_LABELS = ["아이디어", "메모", "회고", "감정", "결정", "계획", "정보", "기타"] as const;
export type ScrapLabel = (typeof SCRAP_LABELS)[number];

export interface Scrap {
  id: string;
  text: string;
  label: ScrapLabel;
  createdAt: string;
  deletedAt?: string | null;
  /** 서버가 Claude 로 뽑아 둔 개념 · 관계(키가 있을 때만). 있으면 시냅스가 규칙 대신 이것을 쓴다 */
  concepts?: { name: string; kind: NodeKind }[];
  relations?: { from: string; to: string; relation?: string }[];
}

/**
 * 대화 아래 붙는 카드. 모델은 카드에 무엇을 그릴지(범위 · id)만 정하고,
 * 제목 · 마감 · 완료 여부는 앱이 지금 데이터에서 읽어 그린다 — 본문과 카드가 어긋나지 않게.
 */
export type Card =
  | {
      kind: "changes";
      id: string;
      /** 이 턴이 만든 · 끝낸 · 지운 것 — [되돌리기] 가 반대로 적용한다 */
      createdTaskIds: string[];
      completedTaskIds: string[];
      deletedTaskIds: string[];
      createdEventIds: string[];
      createdScrapIds: string[];
      undone: boolean;
    }
  | { kind: "task_list"; id: string; scope: TaskScope; title: string }
  | { kind: "overdue"; id: string; rows: { taskId: string; state: "open" | "completed" | "today" | "deleted" }[]; closed: boolean }
  | {
      kind: "suggest";
      id: string;
      note: string | null;
      rows: { title: string; due: string | null; state: "open" | "added" | "skipped"; taskId?: string }[];
      closed: boolean;
    }
  | {
      kind: "recall";
      id: string;
      query: string;
      /** 찾은 개념과 그 이웃 — 노드 이름은 시냅스에서 지금 값으로 읽는다 */
      nodeIds: string[];
      scrapIds: string[];
      taskIds: string[];
    };

export type TaskScope = "today" | "tomorrow" | "week" | "overdue" | "all" | "done";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  cards: Card[];
  createdAt: string;
  /** 어느 길로 답했나 — claude(모델) · local(기기 안 규칙) */
  via?: "claude" | "local";
}

/** 시냅스 — 기록 · 할일에서 뽑은 개념(노드)과 같은 글에 함께 나온 관계(엣지) */
export type NodeKind = "topic" | "person" | "emotion" | "project" | "tag";

export interface GraphNode {
  id: string;
  /** 표준 이름 — 같은 개념의 변형은 이 이름 하나로 모은다 */
  name: string;
  kind: NodeKind;
  /** 이 개념이 나온 글 */
  refs: { type: "scrap" | "task"; id: string }[];
  updatedAt: string;
}

export interface GraphEdge {
  id: string;
  /** 두 노드 id — 사전순으로 a < b */
  a: string;
  b: string;
  /** 함께 나온 글 수 */
  weight: number;
  /** 관계 이름(모델이 뽑았을 때만, 예: "원인", "담당") */
  relation?: string;
}

export interface AppState {
  tasks: Task[];
  events: CalendarEvent[];
  scraps: Scrap[];
  messages: ChatMessage[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function emptyState(): AppState {
  return { tasks: [], events: [], scraps: [], messages: [], nodes: [], edges: [] };
}

export function newId(): string {
  const r = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${r}`;
}
