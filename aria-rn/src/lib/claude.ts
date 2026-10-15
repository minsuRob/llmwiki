/**
 * Claude 길 — 앱이 도구를 실행하는 수동 루프(Aria 와 같은 두꺼운 클라이언트 구조).
 *
 * 키는 사용자가 설정 탭에 넣은 값만 쓴다(기기 안에만 저장). 앱에서 바로 API 를 부르므로 개인 실험용이다 —
 * 여럿에게 배포하려면 키를 서버 프록시 뒤로 옮겨야 한다.
 *
 * - 응답의 content 를 통째로 다음 요청에 붙인다(생각 블록을 그대로 두어야 한다 — 앞 대화를 고치지 않는다).
 * - 안전 분류기가 거절하면 서버 쪽 대체 모델로 이어지게 fallbacks: "default" 를 켠다.
 */
import Anthropic from "@anthropic-ai/sdk";

import { formatWhen, ymd } from "./dates.ts";
import { finishTurn, newLedger, runTool, tasksInScope } from "./engine.ts";
import { TOOL_DEFS } from "./toolDefs.ts";
import type { AppState, Card, ChatMessage } from "./types.ts";

export const MODEL = "claude-opus-5-5";
const MAX_STEPS = 8;

const SYSTEM = `너는 사용자의 할일 · 일정 · 기록을 대신 정리해 주는 비서다. 사용자가 말하면 도구로 실제 데이터에 반영하고, 짧게 답한다.

원칙
- 말로만 "추가했어요 · 지웠어요" 라고 하지 않는다. 반영이 필요하면 반드시 도구를 부르고, 도구 결과대로만 말한다.
- 카드가 뜨는 도구(show_tasks · propose_overdue · propose_tasks)를 불렀으면 카드 내용을 본문에 다시 나열하지 않는다. 바꾸는 도구(add · update · complete · delete)를 부르면 앱이 턴 끝에 [되돌리기] 카드를 붙이므로 몇 개를 했는지만 한 문장으로 말한다.
- 남과 만나는 약속만 일정(add_event)이고, 혼자 하는 일은 할일(add_task)이다.
- 날짜 · 시각은 아래 [지금] 기준으로 계산한다. 24시간제다(14:00 = 오후 2시). 말하지 않은 날짜를 지어내지 않는다.
- 대상이 둘 이상이라 헷갈리면 실행하지 말고 한 줄로 되묻는다.
- 답은 사용자가 쓴 언어로, 1~3문장. 인사 · 감사 같은 짧은 말에는 짧게 반응만 한다.`;

function contextBlock(state: AppState, now: Date): string {
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const today = tasksInScope(state, "today", now);
  const overdue = tasksInScope(state, "overdue", now).length;
  const lines = today.slice(0, 15).map((t) => `- id=${t.id} | ${t.title} | ${formatWhen(t.due, now) ?? "마감 없음"}`);
  return [
    `[지금] ${ymd(now)} (${dayNames[now.getDay()]}) ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}, 시간대 ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    `[오늘 할 일 ${today.length}개 · 그중 기한 지남 ${overdue}개 — 읽기 전용, 바꾸려면 도구]`,
    ...lines,
  ].join("\n");
}

/** 지난 대화 → 모델 메시지. 카드는 "무엇을 띄웠는지" 한 줄로만 남긴다 */
function historyToParams(history: ChatMessage[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of history.slice(-20)) {
    const cardNote = m.cards.length ? `\n[이 답 아래 카드: ${m.cards.map((c) => c.kind).join(", ")}]` : "";
    const text = (m.text || "(빈 답)") + (m.role === "assistant" ? cardNote : "");
    out.push({ role: m.role, content: text });
  }
  // 첫 메시지는 user 여야 한다
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export interface TurnResult {
  state: AppState;
  text: string;
  cards: Card[];
}

export async function runClaudeTurn(apiKey: string, state: AppState, userText: string, now = new Date()): Promise<TurnResult> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...historyToParams(state.messages),
    { role: "user", content: `${contextBlock(state, now)}\n\n${userText}` },
  ];
  const ledger = newLedger();
  let current = state;
  let finalText = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      cache_control: { type: "ephemeral" },
      system: SYSTEM,
      tools: TOOL_DEFS,
      messages,
    });

    if (response.stop_reason === "refusal") {
      finalText = "이 요청은 처리할 수 없어요.";
      break;
    }
    messages.push({ role: "assistant", content: response.content });
    const texts = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text);
    if (texts.length) finalText = texts.join("\n").trim();

    const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || calls.length === 0) break;

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const input = call.input && typeof call.input === "object" ? (call.input as Record<string, unknown>) : {};
      const run = runTool(current, call.name, input, ledger, now);
      current = run.state;
      results.push({ type: "tool_result", tool_use_id: call.id, content: run.output, is_error: run.output.startsWith("Error") });
    }
    // 한 응답의 도구 결과는 한 user 메시지에 모두 담는다
    messages.push({ role: "user", content: results });
  }

  return { state: current, text: finalText || "처리했어요.", cards: finishTurn(ledger) };
}
