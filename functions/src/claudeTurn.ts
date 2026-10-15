/**
 * Claude 길 — 서버가 도구 루프를 돈다. 키는 함수 환경변수 ANTHROPIC_API_KEY 에만 있다(앱에는 없다).
 * 키가 없으면 이 파일은 쓰이지 않고 packages/core 의 기기 안 규칙이 같은 도구 호출을 만든다.
 *
 * - 응답의 content 를 통째로 다음 요청에 붙인다(앞 대화를 고치지 않는다).
 * - 안전 분류기가 거절하면 서버 쪽 대체 모델로 이어지게 fallbacks: "default" 를 켠다.
 */
import Anthropic from "@anthropic-ai/sdk";

import { formatWhen, ymd } from "../../packages/core/src/dates.ts";
import { finishTurn, newLedger, runTool, tasksInScope } from "../../packages/core/src/engine.ts";
import type { ExtractedConcept, ExtractedRelation } from "../../packages/core/src/synapse.ts";
import { TOOL_DEFS } from "../../packages/core/src/toolDefs.ts";
import type { AppState, Card, ChatMessage, NodeKind } from "../../packages/core/src/types.ts";

export const MODEL = "claude-opus-5-5";
const MAX_STEPS = 8;

const SYSTEM = `너는 사용자의 할일 · 일정 · 기록을 대신 정리해 주는 비서다. 사용자가 말하면 도구로 실제 데이터에 반영하고, 짧게 답한다.

원칙
- 말로만 "추가했어요 · 지웠어요" 라고 하지 않는다. 반영이 필요하면 반드시 도구를 부르고, 도구 결과대로만 말한다.
- 카드가 뜨는 도구(show_tasks · propose_overdue · propose_tasks · recall)를 불렀으면 카드 내용을 본문에 다시 나열하지 않는다. 바꾸는 도구(add · update · complete · delete)를 부르면 앱이 턴 끝에 [되돌리기] 카드를 붙이므로 몇 개를 했는지만 한 문장으로 말한다.
- 지난 기록을 떠올리는 질문은 recall 로 근거를 찾고, 근거에 있는 것만 말한다.
- 남과 만나는 약속만 일정(add_event)이고, 혼자 하는 일은 할일(add_task)이다.
- 날짜 · 시각은 아래 [지금] 기준으로 계산한다. 24시간제다(14:00 = 오후 2시). 말하지 않은 날짜를 지어내지 않는다.
- 대상이 둘 이상이라 헷갈리면 실행하지 말고 한 줄로 되묻는다.
- 답은 사용자가 쓴 언어로, 1~3문장. 인사 · 감사 같은 짧은 말에는 짧게 반응만 한다.`;

function client(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

function contextBlock(state: AppState, now: Date, timeZone: string): string {
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const today = tasksInScope(state, "today", now);
  const overdue = tasksInScope(state, "overdue", now).length;
  const lines = today.slice(0, 15).map((t) => `- id=${t.id} | ${t.title} | ${formatWhen(t.due, now) ?? "마감 없음"}`);
  return [
    `[지금] ${ymd(now)} (${dayNames[now.getDay()]}) ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}, 시간대 ${timeZone}`,
    `[오늘 할 일 ${today.length}개 · 그중 기한 지남 ${overdue}개 — 읽기 전용, 바꾸려면 도구]`,
    ...lines,
  ].join("\n");
}

/** 지난 대화 → 모델 메시지. 카드는 "무엇을 띄웠는지" 한 줄로만 남긴다 */
function historyToParams(history: ChatMessage[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of history.slice(-20)) {
    const cardNote = m.cards.length ? `\n[이 답 아래 카드: ${m.cards.map((c) => c.kind).join(", ")}]` : "";
    out.push({ role: m.role, content: (m.text || "(빈 답)") + (m.role === "assistant" ? cardNote : "") });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export interface TurnResult {
  state: AppState;
  text: string;
  cards: Card[];
}

/**
 * now 는 **사용자의 벽시계 시각**을 담은 Date 다(앱이 보낸 시간대로 서버가 맞춰 만든다).
 * history 는 이번 사용자 메시지를 넣기 전의 대화.
 */
export async function runClaudeTurn(apiKey: string, state: AppState, history: ChatMessage[], userText: string, now: Date, timeZone: string): Promise<TurnResult> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [...historyToParams(history), { role: "user", content: `${contextBlock(state, now, timeZone)}\n\n${userText}` }];
  const ledger = newLedger();
  let current = state;
  let finalText = "";
  const api = client(apiKey);

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await api.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      cache_control: { type: "ephemeral" },
      system: SYSTEM,
      tools: TOOL_DEFS as unknown as Anthropic.Beta.BetaTool[],
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
    messages.push({ role: "user", content: results });
  }
  return { state: current, text: finalText || "처리했어요.", cards: finishTurn(ledger) };
}

const KINDS: NodeKind[] = ["topic", "person", "emotion", "project", "tag"];

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, kind: { type: "string", enum: KINDS } },
        required: ["name", "kind"],
        additionalProperties: false,
      },
    },
    relations: {
      type: "array",
      items: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" }, relation: { type: "string" } },
        required: ["from", "to", "relation"],
        additionalProperties: false,
      },
    },
  },
  required: ["concepts", "relations"],
  additionalProperties: false,
} as const;

const EXTRACT_SYSTEM = `기록 한 편에서 나중에 다시 떠올릴 가치가 있는 핵심 개념을 뽑아 개인 지식 그래프에 넣는다.
- 개념은 짧은 명사 · 고유명사(1~3단어)로, 기존 개념 목록에 같은 뜻이 있으면 그 이름을 그대로 쓴다(같은 개념을 여러 이름으로 흩뜨리지 않는다).
- kind: person(사람) · project(일 · 프로젝트) · emotion(감정, 설렘 · 기쁨 · 불안 · 지침 · 분노 · 슬픔 중 하나로) · tag · topic(그 밖의 주제).
- 감정을 뽑았으면 그 감정의 원인 · 대상 개념과 relation("원인" 등)으로 잇는다.
- 인사 · 날짜 · "오늘" 같은 흔한 말은 뽑지 않는다. 뽑을 게 없으면 빈 배열.`;

/** 기록 한 편 → 개념 · 관계. 기존 개념 이름을 함께 보내 같은 개념으로 수렴시킨다 */
export async function extractWithClaude(apiKey: string, text: string, knownNames: string[]): Promise<{ concepts: ExtractedConcept[]; relations: ExtractedRelation[] }> {
  const response = await client(apiKey).messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: { type: "json_schema", schema: EXTRACT_SCHEMA as unknown as Record<string, unknown> } },
    system: EXTRACT_SYSTEM,
    messages: [{ role: "user", content: `[기존 개념] ${knownNames.slice(0, 200).join(", ") || "(없음)"}\n\n[기록]\n${text}` }],
  });
  const block = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!block) return { concepts: [], relations: [] };
  const parsed = JSON.parse(block.text) as { concepts: ExtractedConcept[]; relations: ExtractedRelation[] };
  return { concepts: parsed.concepts.filter((c) => c.name?.trim()).slice(0, 12), relations: parsed.relations.slice(0, 12) };
}
