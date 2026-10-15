/**
 * 대화 — POST chat { text, timeZone } → 사용자 말과 답(카드 포함)을 messages 에 쓰고, 바뀐 할일 · 일정 · 기록을 반영한다.
 * 키(ANTHROPIC_API_KEY)가 있으면 Claude 가, 없으면 packages/core 의 한국어 규칙이 같은 도구를 부른다.
 * "방금 거 취소" 는 가장 최근의 되돌리지 않은 변경 카드를 되돌린다.
 */
import { HttpsError, onCall } from "firebase-functions/https";
import { logger } from "firebase-functions";

import { undoChanges } from "../../../packages/core/src/engine.ts";
import { runLocalTurn } from "../../../packages/core/src/local.ts";
import { newId, type AppState, type ChatMessage } from "../../../packages/core/src/types.ts";
import { runClaudeTurn } from "../claudeTurn.ts";
import { REGION, anthropicKey, mutate, requireUid, wallClock } from "../common.ts";
import { extractNewScraps } from "./synapse.ts";

export interface ChatRequest {
  text: string;
  timeZone?: string;
}

export interface ChatResponse {
  messageId: string;
  text: string;
  via: "claude" | "local";
}

export const chat = onCall<ChatRequest>({ region: REGION, timeoutSeconds: 120 }, async (req): Promise<ChatResponse> => {
  const uid = requireUid(req);
  const text = typeof req.data?.text === "string" ? req.data.text.trim().slice(0, 4000) : "";
  if (!text) throw new HttpsError("invalid-argument", "text 가 비어 있어요.");
  const { now, timeZone } = wallClock(req.data?.timeZone);
  const key = anthropicKey();

  return mutate(uid, now, async (before) => {
    const history = before.messages;
    const userMsg: ChatMessage = { id: newId(), role: "user", text, cards: [], createdAt: now.toISOString() };
    let state: AppState;
    let reply: string;
    let cards: ChatMessage["cards"];
    let via: "claude" | "local";

    if (key) {
      try {
        const turn = await runClaudeTurn(key, before, history, text, now, timeZone);
        ({ state, text: reply, cards } = turn);
        via = "claude";
        state = await extractNewScraps(key, before, state);
      } catch (e) {
        logger.error("claude turn failed", { error: e instanceof Error ? e.message : String(e) });
        throw new HttpsError("unavailable", "AI 가 답하지 못했어요. 잠시 뒤 다시 해 주세요.");
      }
    } else {
      const turn = runLocalTurn(before, text, now);
      state = turn.state;
      reply = turn.text;
      cards = turn.cards;
      via = "local";
      if (turn.undoLast) {
        const last = [...before.messages].reverse().flatMap((m) => [...m.cards].reverse()).find((c) => c.kind === "changes" && !c.undone);
        if (last) state = undoChanges(before, last.id, now);
        else reply = "되돌릴 게 없어요.";
      }
    }

    // 답은 사용자 말 1ms 뒤 — 같은 시각이면 순서가 뒤집힐 수 있다
    const replyMsg: ChatMessage = { id: newId(), role: "assistant", text: reply, cards, createdAt: new Date(now.getTime() + 1).toISOString(), via };
    return {
      state: { ...state, messages: [...state.messages, userMsg, replyMsg] },
      result: { messageId: replyMsg.id, text: reply, via },
    };
  });
});
