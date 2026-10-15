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

export interface AppState {
  tasks: Task[];
  events: CalendarEvent[];
  scraps: Scrap[];
  messages: ChatMessage[];
}

export function newId(): string {
  const r = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${r}`;
}
