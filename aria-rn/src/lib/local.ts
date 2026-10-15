/**
 * 기기 안 규칙 길 — API 키가 없을 때 쓴다. 한국어 문장을 **Claude 길과 같은 도구 호출**로 바꿔 engine.runTool 에 넘긴다.
 * 그래서 키가 없어도 같은 카드 · 같은 [되돌리기] 가 뜬다. 이해 폭은 모델보다 좁다(자주 쓰는 말만).
 * 테스트: local.test.ts
 */
import { formatWhen, parseKoreanWhen } from "./dates.ts";
import { finishTurn, newLedger, runTool, SCOPE_TITLES, tasksInScope } from "./engine.ts";
import type { AppState, Card, TaskScope } from "./types.ts";

export interface PlannedCall {
  name: string;
  input: Record<string, unknown>;
}

export interface LocalPlan {
  calls: PlannedCall[];
  /** 도구 없이 바로 할 말(인사 등) */
  reply?: string;
  /** "방금 거 취소" — 마지막 [되돌리기] 카드를 누른 것과 같다 */
  undoLast?: boolean;
}

// "회의록 정리" 는 혼자 하는 일 — 회의 뒤에 "록" 이 오면 일정으로 보지 않는다
const EVENT_WORDS = /(회의(?!록)|미팅|약속|예약|면담|모임|만나|세미나|인터뷰|면접|생일|기념일|결혼식|진료)/;
const SHOW_WORDS = /(보여|알려|뭐\s*있|뭐야|뭐지|목록|리스트|확인)/;
const TASK_WORDS = /(할\s*일|할일|투두|todo)/i;
const REQUEST_TAIL =
  /\s*(추가해\s*줘|추가해|추가|넣어\s*줘|넣어|등록해\s*줘|등록|잡아\s*줘|잡아|기억해\s*줘|해야\s*(해|돼|함|지|겠다)|해야겠다|하자|할\s*것|좀|요)[.!~]*$/;

/** 제목 다듬기 — 날짜 · 시각 말과 요청 꼬리를 뺀다 */
export function cleanTitle(text: string, matched: string[]): string {
  let t = text;
  for (const m of matched) t = t.replace(m, " ");
  t = t.replace(/(까지|에|에는|부터)(?=\s|$)/g, " ");
  for (let i = 0; i < 3; i++) t = t.replace(REQUEST_TAIL, "");
  return t.replace(/^[\s,.\-·•*]+|[\s,.\-·•*]+$/g, "").replace(/\s+/g, " ").trim();
}

function scopeOf(text: string): TaskScope {
  if (/내일/.test(text)) return "tomorrow";
  if (/이번\s*주|주간|금주/.test(text)) return "week";
  if (/끝낸|완료한|한\s*거/.test(text)) return "done";
  if (/전체|모든|다\s*보여|전부/.test(text)) return "all";
  if (/밀린|기한\s*지난|지난/.test(text)) return "overdue";
  return "today";
}

/** 한 줄(한 가지 일) → 할일 또는 일정 */
function itemCall(line: string, now: Date): PlannedCall | null {
  const when = parseKoreanWhen(line, now);
  const title = cleanTitle(line, when?.matched ?? []);
  if (!title) return null;
  if (when && EVENT_WORDS.test(line)) return { name: "add_event", input: { title, start: when.value } };
  return { name: "add_task", input: { title, due: when?.value } };
}

function splitItems(text: string): string[] {
  return text
    .split(/\n|,|，|;|그리고/)
    .map((s) => s.replace(/^\s*(\d+[.)]|[-•*·])\s*/, "").trim())
    .filter(Boolean);
}

export function planLocal(text: string, now = new Date()): LocalPlan {
  const t = text.trim();
  if (!t) return { calls: [] };

  if (/^(안녕|하이|ㅎㅇ|hi|hello)/i.test(t)) return { calls: [], reply: "안녕하세요! 할 일이나 일정을 말해 주시면 정리해 둘게요." };
  if (/^(고마워|고맙|감사|땡큐|ㄱㅅ)/.test(t)) return { calls: [], reply: "천만에요. 또 필요하면 불러 주세요." };
  if (/(방금|아까).*(취소|되돌려|없던\s*걸로)|^(취소|되돌려)/.test(t)) return { calls: [], undoLast: true };

  // 기한 지난 할일 처리
  if (/(밀린|기한\s*지난|마감\s*지난|연체)/.test(t) && !SHOW_WORDS.test(t.replace(/알려/, ""))) {
    return { calls: [{ name: "propose_overdue", input: {} }] };
  }
  if (/(밀린|기한\s*지난)/.test(t) && /(정리|처리|어떻게)/.test(t)) return { calls: [{ name: "propose_overdue", input: {} }] };

  // 보여 주기
  if (TASK_WORDS.test(t) && SHOW_WORDS.test(t)) return { calls: [{ name: "show_tasks", input: { scope: scopeOf(t) } }] };
  if (/(일정|약속|스케줄)/.test(t) && SHOW_WORDS.test(t)) return { calls: [{ name: "list_events", input: { days: /이번\s*주/.test(t) ? 7 : /내일/.test(t) ? 2 : 7 } }] };

  // 기록
  const memoHead = /^(?:메모|기록|스크랩)\s*[:：]?\s*(.+)$/s.exec(t);
  const memoTail = /^(.+?)\s*(?:메모해\s*줘|메모해|적어\s*둬|기록해\s*줘|기록해)[.!~]*$/s.exec(t);
  const memo = (memoHead ?? memoTail)?.[1]?.trim();
  if (memo) {
    const label = /(아이디어|생각해\s*보니)/.test(memo) ? "아이디어" : /(결정|기로\s*(했|함|하자))/.test(memo) ? "결정" : /(기분|슬프|기쁘|짜증|불안|좋았)/.test(memo) ? "감정" : "메모";
    return { calls: [{ name: "add_scrap", input: { text: memo, label } }] };
  }

  // 완료 · 삭제
  const done = /^(.+?)\s*(다\s*했어|끝냈어|끝났어|완료했어|완료|했어|처리했어)[.!~]*$/.exec(t);
  if (done) return { calls: [{ name: "complete_task", input: { task: cleanTitle(done[1], []) } }] };
  const del = /^(.+?)\s*(지워\s*줘|지워|삭제해\s*줘|삭제|빼\s*줘|취소됐어)[.!~]*$/.exec(t);
  if (del) return { calls: [{ name: "delete_task", input: { task: cleanTitle(del[1], []) } }] };

  // 여러 가지를 한꺼번에(브레인 덤프) → 제안만
  const items = splitItems(t);
  if (items.length >= 3) {
    const rows = items
      .map((line) => {
        const when = parseKoreanWhen(line, now);
        return { title: cleanTitle(line, when?.matched ?? []), due: when?.value };
      })
      .filter((r) => r.title);
    return { calls: [{ name: "propose_tasks", input: { items: rows } }] };
  }

  // 한두 가지 → 바로 만든다
  const calls = items.map((line) => itemCall(line, now)).filter((c): c is PlannedCall => !!c);
  if (calls.length) return { calls };
  return { calls: [], reply: "어떤 걸 정리할까요? 예: \"내일 오후 3시 팀 회의\", \"금요일까지 보고서 쓰기\"" };
}

/** 도구 결과를 한국어 한두 문장으로 */
function describe(calls: PlannedCall[], outputs: string[], state: AppState, now: Date): string {
  const added = calls.filter((c, i) => c.name === "add_task" && outputs[i].startsWith("Added")).length;
  const dup = calls.filter((c, i) => c.name === "add_task" && outputs[i].startsWith("Already")).length;
  const events = calls.filter((c, i) => c.name === "add_event" && outputs[i].startsWith("Added")).length;
  const parts: string[] = [];
  if (added) parts.push(`할일 ${added}개를 추가했어요`);
  if (events) parts.push(`일정 ${events}개를 잡았어요`);
  if (dup) parts.push(`${dup}개는 이미 있어서 그대로 뒀어요`);
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    const out = outputs[i];
    if (out.startsWith("Error")) {
      parts.push(c.name === "complete_task" || c.name === "delete_task" ? `"${String(c.input.task)}" 할일을 찾지 못했어요` : "처리하지 못했어요");
      continue;
    }
    if (c.name === "complete_task") parts.push(out.startsWith("이미") ? "이미 끝낸 할일이에요" : "완료로 표시했어요. 수고했어요!");
    if (c.name === "delete_task") parts.push("휴지통으로 옮겼어요(7일 안에 되살릴 수 있어요)");
    if (c.name === "add_scrap") parts.push("기록으로 남겨 뒀어요");
    if (c.name === "show_tasks") {
      const scope = c.input.scope as TaskScope;
      const n = tasksInScope(state, scope, now).length;
      parts.push(n ? `${SCOPE_TITLES[scope]} ${n}개예요. 아래에서 바로 체크할 수 있어요` : `${SCOPE_TITLES[scope]}이 없어요`);
    }
    if (c.name === "propose_overdue") parts.push(out.startsWith("Shown") ? "기한이 지난 할일이에요. 아래에서 하나씩 정리해 보세요" : "기한 지난 할일이 없어요. 잘하고 계세요!");
    if (c.name === "propose_tasks") parts.push("이런 할일이 보여요. 필요한 것만 추가해 주세요");
    if (c.name === "list_events") {
      const lines = out.split("\n").filter((l) => l.includes(" | "));
      parts.push(lines.length ? `다가오는 일정이에요:\n${lines.map((l) => { const [, title, start] = l.split(" | "); return `• ${title} — ${formatWhen(start, now)}`; }).join("\n")}` : "앞으로 일주일 동안 일정이 없어요");
    }
  }
  return parts.map((p) => (/[.!?:]$|\n/.test(p) ? p : `${p}.`)).join(" ");
}

export interface LocalTurn {
  state: AppState;
  text: string;
  cards: Card[];
  undoLast?: boolean;
}

export function runLocalTurn(state: AppState, text: string, now = new Date()): LocalTurn {
  const plan = planLocal(text, now);
  if (plan.undoLast) return { state, text: "방금 한 일을 되돌렸어요.", cards: [], undoLast: true };
  if (plan.reply) return { state, text: plan.reply, cards: [] };
  const ledger = newLedger();
  let current = state;
  const outputs: string[] = [];
  for (const call of plan.calls) {
    const run = runTool(current, call.name, call.input, ledger, now);
    current = run.state;
    outputs.push(run.output);
  }
  return { state: current, text: describe(plan.calls, outputs, current, now), cards: finishTurn(ledger) };
}
