/**
 * 도구 실행기 — 할일 · 일정 · 기록을 바꾸는 일은 전부 여기를 지난다(순수 함수, 테스트: engine.test.ts).
 *
 * 모델(Claude) 길과 기기 안 규칙 길이 **같은 도구 이름 · 같은 입력**으로 이 실행기를 부른다.
 * 그래서 어느 길로 답해도 같은 카드가 뜨고, 같은 [되돌리기] 가 붙는다.
 *
 * 한 턴의 변경은 TurnLedger 에 모인다 — 만든 · 끝낸 · 지운 id. 턴이 끝나면 "changes" 카드 하나로 묶는다.
 * 보여 주기 · 제안 도구(show_tasks · propose_overdue · propose_tasks)는 데이터를 바꾸지 않고 카드만 더한다.
 */
import { addDays, endOfWeek, isOverdue, parseLocal, sameDay, ymd } from "./dates.ts";
import { recall } from "./synapse.ts";
import { SCRAP_LABELS, newId, type AppState, type Card, type ScrapLabel, type Task, type TaskScope } from "./types.ts";

export interface TurnLedger {
  createdTaskIds: string[];
  completedTaskIds: string[];
  deletedTaskIds: string[];
  createdEventIds: string[];
  createdScrapIds: string[];
  cards: Card[];
}

export function newLedger(): TurnLedger {
  return { createdTaskIds: [], completedTaskIds: [], deletedTaskIds: [], createdEventIds: [], createdScrapIds: [], cards: [] };
}

export type ToolInput = Record<string, unknown>;
export interface ToolRun {
  state: AppState;
  /** 모델에게 돌려줄 결과 한 줄 */
  output: string;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const normTitle = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const DUE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

/** 모델이 준 시각을 "YYYY-MM-DD" · "YYYY-MM-DDTHH:mm" 로 다듬는다. 틀린 값은 null */
export function normalizeDue(v: unknown): string | null {
  const s = str(v).replace(" ", "T");
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(s);
  if (!m) return null;
  const out = m[2] ? `${m[1]}T${m[2]}` : m[1];
  return DUE_RE.test(out) && parseLocal(out) ? out : null;
}

export function liveTasks(state: AppState): Task[] {
  return state.tasks.filter((t) => !t.deletedAt);
}

/** id 또는 제목으로 할일을 찾는다 — 제목은 열린 할일 중 완전 일치, 없으면 포함 일치(최근 것부터) */
export function findTask(state: AppState, ref: unknown): Task | null {
  const r = str(ref);
  if (!r) return null;
  const live = liveTasks(state);
  const byId = live.find((t) => t.id === r);
  if (byId) return byId;
  const q = normTitle(r);
  const open = live.filter((t) => !t.done).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return open.find((t) => normTitle(t.title) === q) ?? open.find((t) => normTitle(t.title).includes(q)) ?? null;
}

/** includeDone: 카드처럼 방금 체크한 할일도 줄을 지키며 보일 때(완료한 것은 마감 기준으로만 고른다) */
export function tasksInScope(state: AppState, scope: TaskScope, now = new Date(), opts: { includeDone?: boolean } = {}): Task[] {
  const live = liveTasks(state);
  const open = opts.includeDone && scope !== "done" ? live.filter((t) => !t.done || !!t.due) : live.filter((t) => !t.done);
  const byDue = (a: Task, b: Task) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.createdAt.localeCompare(b.createdAt);
  switch (scope) {
    case "today":
      // 오늘 할 일 = 오늘 마감 + 기한 지남
      return open.filter((t) => sameDay(t.due, now) || (!t.done && isOverdue(t.due, now))).sort(byDue);
    case "tomorrow":
      return open.filter((t) => sameDay(t.due, addDays(now, 1))).sort(byDue);
    case "week": {
      const end = ymd(endOfWeek(now));
      return open.filter((t) => t.due && t.due.slice(0, 10) >= ymd(now) && t.due.slice(0, 10) <= end).sort(byDue);
    }
    case "overdue":
      return open.filter((t) => isOverdue(t.due, now) && (!t.done || !!opts.includeDone)).sort(byDue);
    case "done":
      return live.filter((t) => t.done).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    case "all":
    default:
      return open.sort(byDue);
  }
}

export const SCOPE_TITLES: Record<TaskScope, string> = {
  today: "오늘 할 일",
  tomorrow: "내일 할 일",
  week: "이번 주 할 일",
  overdue: "기한 지난 할 일",
  all: "열린 할 일",
  done: "끝낸 할 일",
};

function asScope(v: unknown): TaskScope {
  const s = str(v);
  return (["today", "tomorrow", "week", "overdue", "all", "done"] as const).includes(s as TaskScope) ? (s as TaskScope) : "all";
}

function taskLine(t: Task): string {
  return `${t.id} | ${t.title} | ${t.due ?? "마감 없음"} | ${t.done ? "완료" : "열림"}`;
}

/** 도구 하나를 실행한다. 모르는 도구 · 틀린 입력은 상태를 바꾸지 않고 오류 한 줄을 돌려준다 */
export function runTool(state: AppState, name: string, input: ToolInput, ledger: TurnLedger, now = new Date()): ToolRun {
  const nowIso = now.toISOString();
  switch (name) {
    case "add_task": {
      const title = str(input.title).slice(0, 200);
      if (!title) return { state, output: "Error: title 이 비어 있습니다." };
      const dup = liveTasks(state).find((t) => !t.done && normTitle(t.title) === normTitle(title));
      if (dup) return { state, output: `Already exists — 같은 할일이 이미 있습니다(id=${dup.id}). 다시 만들지 마세요.` };
      const task: Task = { id: newId(), title, notes: str(input.notes) || undefined, due: normalizeDue(input.due), done: false, createdAt: nowIso };
      ledger.createdTaskIds.push(task.id);
      return { state: { ...state, tasks: [...state.tasks, task] }, output: `Added task id=${task.id} title=${title} due=${task.due ?? "none"}` };
    }
    case "update_task": {
      const t = findTask(state, input.task);
      if (!t) return { state, output: `Error: 그런 열린 할일이 없습니다(${str(input.task)}).` };
      const patch: Partial<Task> = {};
      if (str(input.title)) patch.title = str(input.title).slice(0, 200);
      if (input.due !== undefined) patch.due = input.due === null || str(input.due) === "" ? null : normalizeDue(input.due);
      if (input.notes !== undefined) patch.notes = str(input.notes) || undefined;
      return { state: { ...state, tasks: state.tasks.map((x) => (x.id === t.id ? { ...x, ...patch } : x)) }, output: `Updated task id=${t.id}` };
    }
    case "complete_task": {
      const t = findTask(state, input.task);
      if (!t) return { state, output: `Error: 그런 열린 할일이 없습니다(${str(input.task)}).` };
      if (t.done) return { state, output: `이미 완료한 할일입니다(id=${t.id}).` };
      ledger.completedTaskIds.push(t.id);
      return { state: { ...state, tasks: state.tasks.map((x) => (x.id === t.id ? { ...x, done: true, completedAt: nowIso } : x)) }, output: `Completed task id=${t.id}` };
    }
    case "delete_task": {
      const t = findTask(state, input.task);
      if (!t) return { state, output: `Error: 그런 할일이 없습니다(${str(input.task)}).` };
      ledger.deletedTaskIds.push(t.id);
      return { state: { ...state, tasks: state.tasks.map((x) => (x.id === t.id ? { ...x, deletedAt: nowIso } : x)) }, output: `Moved task id=${t.id} to trash (7일 안에 되살릴 수 있음)` };
    }
    case "add_event": {
      const title = str(input.title).slice(0, 200);
      const start = normalizeDue(input.start);
      if (!title || !start) return { state, output: "Error: title 과 start(YYYY-MM-DD 또는 YYYY-MM-DDTHH:mm)가 필요합니다." };
      const ev = { id: newId(), title, start, createdAt: nowIso };
      ledger.createdEventIds.push(ev.id);
      return { state: { ...state, events: [...state.events, ev] }, output: `Added event id=${ev.id} title=${title} start=${start}` };
    }
    case "add_scrap": {
      const text = str(input.text).slice(0, 4000);
      if (!text) return { state, output: "Error: text 가 비어 있습니다." };
      const label = (SCRAP_LABELS as readonly string[]).includes(str(input.label)) ? (str(input.label) as ScrapLabel) : "메모";
      const scrap = { id: newId(), text, label, createdAt: nowIso };
      ledger.createdScrapIds.push(scrap.id);
      return { state: { ...state, scraps: [...state.scraps, scrap] }, output: `Saved scrap id=${scrap.id}` };
    }
    case "list_tasks": {
      const scope = asScope(input.scope);
      const rows = tasksInScope(state, scope, now);
      if (rows.length === 0) return { state, output: `${SCOPE_TITLES[scope]}: 없음. (이 결과는 카드로 뜨지 않았습니다)` };
      return { state, output: `${SCOPE_TITLES[scope]} ${rows.length}개 (카드로 뜨지 않음 — 보여 주려면 show_tasks):\n${rows.slice(0, 30).map(taskLine).join("\n")}` };
    }
    case "list_events": {
      const days = Math.max(1, Math.min(31, Number(input.days) || 7));
      const from = ymd(now);
      const to = ymd(addDays(now, days - 1));
      const rows = state.events
        .filter((e) => !e.deletedAt && e.start.slice(0, 10) >= from && e.start.slice(0, 10) <= to)
        .sort((a, b) => a.start.localeCompare(b.start));
      return { state, output: rows.length ? rows.map((e) => `${e.id} | ${e.title} | ${e.start}`).join("\n") : `앞으로 ${days}일 동안 일정이 없습니다.` };
    }
    case "show_tasks": {
      const scope = asScope(input.scope);
      const n = tasksInScope(state, scope, now).length;
      if (n === 0) return { state, output: `${SCOPE_TITLES[scope]}이 없어 카드를 띄우지 않았습니다. "카드에서 확인하세요" 라고 말하지 마세요.` };
      ledger.cards.push({ kind: "task_list", id: newId(), scope, title: SCOPE_TITLES[scope] });
      return { state, output: `Shown a live task card (${SCOPE_TITLES[scope]}, ${n}개). 제목을 다시 나열하지 말고 한두 문장만.` };
    }
    case "propose_overdue": {
      const rows = tasksInScope(state, "overdue", now).slice(0, 10);
      if (rows.length === 0) return { state, output: "기한 지난 할일이 없습니다. 카드를 띄우지 않았습니다." };
      ledger.cards.push({ kind: "overdue", id: newId(), rows: rows.map((t) => ({ taskId: t.id, state: "open" as const })), closed: false });
      return { state, output: `Shown an overdue card with ${rows.length} rows and buttons (완료 · 오늘로 · 삭제). Nothing changed yet. 선택지를 글로 나열하지 마세요.` };
    }
    case "propose_tasks": {
      const items = Array.isArray(input.items) ? input.items : [];
      const seen = new Set<string>();
      const rows: { title: string; due: string | null; state: "open" }[] = [];
      for (const it of items) {
        const r = (it ?? {}) as Record<string, unknown>;
        const title = str(r.title).slice(0, 200);
        if (!title || seen.has(normTitle(title))) continue;
        seen.add(normTitle(title));
        rows.push({ title, due: normalizeDue(r.due), state: "open" });
        if (rows.length >= 10) break;
      }
      if (rows.length === 0) return { state, output: "Error: items 에 제목이 있는 할일이 없습니다." };
      ledger.cards.push({ kind: "suggest", id: newId(), note: str(input.note) || null, rows, closed: false });
      return { state, output: `Shown a suggestion card with ${rows.length} todos. NOT created yet — 사용자가 [추가] 를 눌러야 생긴다. '추가했어요' 라고 말하지 마세요.` };
    }
    case "recall": {
      const query = str(input.query).slice(0, 100);
      if (!query) return { state, output: "Error: query 가 비어 있습니다." };
      const found = recall(state, query);
      if (found.scrapIds.length + found.taskIds.length === 0) return { state, output: `"${query}" 와 이어진 기록 · 할일이 없습니다. 카드를 띄우지 않았습니다. 없다고 솔직히 말하세요.` };
      ledger.cards.push({ kind: "recall", id: newId(), query, ...found });
      const lines = [
        ...found.scrapIds.map((id) => state.scraps.find((x) => x.id === id)).filter(Boolean).map((x) => `기록 | ${x!.createdAt.slice(0, 10)} | ${x!.text}`),
        ...found.taskIds.map((id) => state.tasks.find((x) => x.id === id)).filter(Boolean).map((x) => `할일 | ${x!.title} | ${x!.done ? "완료" : "열림"}`),
      ];
      return { state, output: `Shown a recall card. 근거(이 줄만 근거로 답하고, 카드 내용을 그대로 다시 나열하지 마세요):\n${lines.join("\n")}` };
    }
    default:
      return { state, output: `Error: 모르는 도구 ${name}` };
  }
}

/** 턴 끝 — 바뀐 것이 있으면 "changes" 카드를 맨 앞에 둔다 */
export function finishTurn(ledger: TurnLedger): Card[] {
  const changed =
    ledger.createdTaskIds.length + ledger.completedTaskIds.length + ledger.deletedTaskIds.length + ledger.createdEventIds.length + ledger.createdScrapIds.length;
  const cards = [...ledger.cards];
  if (changed > 0) {
    cards.unshift({
      kind: "changes",
      id: newId(),
      createdTaskIds: ledger.createdTaskIds,
      completedTaskIds: ledger.completedTaskIds,
      deletedTaskIds: ledger.deletedTaskIds,
      createdEventIds: ledger.createdEventIds,
      createdScrapIds: ledger.createdScrapIds,
      undone: false,
    });
  }
  return cards;
}

/** 카드 하나를 바꿔 끼운다(모든 메시지에서 id 로 찾는다) */
export function replaceCard(state: AppState, card: Card): AppState {
  return {
    ...state,
    messages: state.messages.map((m) => (m.cards.some((c) => c.id === card.id) ? { ...m, cards: m.cards.map((c) => (c.id === card.id ? card : c)) } : m)),
  };
}

export function findCard(state: AppState, cardId: string): Card | null {
  for (const m of state.messages) for (const c of m.cards) if (c.id === cardId) return c;
  return null;
}

/**
 * [되돌리기] — 만든 할일 · 일정 · 기록은 휴지통으로, 끝낸 할일은 다시 열고, 지운 할일은 되살린다.
 * 만든 할일을 그 사이 사용자가 완료했으면 남긴다(사람이 한 일을 지우지 않는다).
 */
export function undoChanges(state: AppState, cardId: string, now = new Date()): AppState {
  const card = findCard(state, cardId);
  if (!card || card.kind !== "changes" || card.undone) return state;
  const nowIso = now.toISOString();
  const created = new Set(card.createdTaskIds);
  const completed = new Set(card.completedTaskIds);
  const deleted = new Set(card.deletedTaskIds);
  const tasks = state.tasks.map((t) => {
    if (created.has(t.id) && !t.done) return { ...t, deletedAt: nowIso };
    if (completed.has(t.id)) return { ...t, done: false, completedAt: null };
    if (deleted.has(t.id)) return { ...t, deletedAt: null };
    return t;
  });
  const evs = new Set(card.createdEventIds);
  const scraps = new Set(card.createdScrapIds);
  const next: AppState = {
    ...state,
    tasks,
    events: state.events.map((e) => (evs.has(e.id) ? { ...e, deletedAt: nowIso } : e)),
    scraps: state.scraps.map((s) => (scraps.has(s.id) ? { ...s, deletedAt: nowIso } : s)),
  };
  return replaceCard(next, { ...card, undone: true });
}

/** 기한 지난 할일 카드의 줄 단추 */
export function resolveOverdue(state: AppState, cardId: string, taskId: string, action: "complete" | "today" | "delete", now = new Date()): AppState {
  const card = findCard(state, cardId);
  if (!card || card.kind !== "overdue" || card.closed) return state;
  const row = card.rows.find((r) => r.taskId === taskId);
  if (!row || row.state !== "open") return state;
  const nowIso = now.toISOString();
  const tasks = state.tasks.map((t) => {
    if (t.id !== taskId) return t;
    if (action === "complete") return { ...t, done: true, completedAt: nowIso };
    if (action === "delete") return { ...t, deletedAt: nowIso };
    // 오늘로 — 시각이 있었으면 시각은 두고 날짜만 오늘로
    const time = t.due && t.due.includes("T") ? t.due.slice(10) : "";
    return { ...t, due: `${ymd(now)}${time}` };
  });
  const rows = card.rows.map((r) => (r.taskId === taskId ? { ...r, state: (action === "complete" ? "completed" : action === "today" ? "today" : "deleted") as typeof r.state } : r));
  return replaceCard({ ...state, tasks }, { ...card, rows, closed: rows.every((r) => r.state !== "open") });
}

/** 제안 카드의 줄 단추 — 추가하면 그때 할일이 생긴다 */
export function resolveSuggest(state: AppState, cardId: string, index: number, action: "add" | "skip", now = new Date()): AppState {
  const card = findCard(state, cardId);
  if (!card || card.kind !== "suggest" || card.closed) return state;
  const row = card.rows[index];
  if (!row || row.state !== "open") return state;
  let tasks = state.tasks;
  let taskId: string | undefined;
  if (action === "add") {
    const dup = liveTasks(state).find((t) => !t.done && normTitle(t.title) === normTitle(row.title));
    if (dup) taskId = dup.id;
    else {
      const task: Task = { id: newId(), title: row.title, due: row.due, done: false, createdAt: now.toISOString() };
      tasks = [...tasks, task];
      taskId = task.id;
    }
  }
  const rows = card.rows.map((r, i) => (i === index ? { ...r, state: (action === "add" ? "added" : "skipped") as typeof r.state, taskId } : r));
  return replaceCard({ ...state, tasks }, { ...card, rows, closed: rows.every((r) => r.state !== "open") });
}

export function closeCard(state: AppState, cardId: string): AppState {
  const card = findCard(state, cardId);
  if (!card || (card.kind !== "overdue" && card.kind !== "suggest")) return state;
  return replaceCard(state, { ...card, closed: true });
}

/** 휴지통 비우기 — 7일 지난 것만 실제로 뺀다 */
export function purgeTrash(state: AppState, now = new Date()): AppState {
  const cutoff = now.getTime() - 7 * 86400000;
  const keep = <T extends { deletedAt?: string | null }>(x: T) => !x.deletedAt || new Date(x.deletedAt).getTime() > cutoff;
  return { ...state, tasks: state.tasks.filter(keep), events: state.events.filter(keep), scraps: state.scraps.filter(keep) };
}
