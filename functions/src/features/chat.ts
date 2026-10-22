/**
 * 대화 — POST chat { text, timeZone } → 사용자 말과 답(카드 포함)을 messages 에 쓰고, 바뀐 할일 · 일정 · 기록을 반영한다.
 * 서버는 AI API 를 부르지 않는다 — packages/core 의 한국어 규칙(runLocalTurn)이 도구를 부른다.
 * AI 작업은 사용자 컴퓨터의 Claude Code · Codex 세션이 맡는다(MCP · 맥락 묶음).
 * "방금 거 취소" 는 가장 최근의 되돌리지 않은 변경 카드를 되돌린다.
 */
import { HttpsError, onCall } from "firebase-functions/https";

import { undoChanges } from "../../../packages/core/src/engine.ts";
import { runLocalTurn } from "../../../packages/core/src/local.ts";
import { newId, type ChatMessage } from "../../../packages/core/src/types.ts";
import { REGION, mutate, requireUid, wallClock } from "../common.ts";

export interface ChatRequest {
  text: string;
  timeZone?: string;
}

export interface ChatResponse {
  messageId: string;
  text: string;
  via: "local";
}

export const chat = onCall<ChatRequest>({ region: REGION, timeoutSeconds: 60 }, async (req): Promise<ChatResponse> => {
  const uid = requireUid(req);
  const text = typeof req.data?.text === "string" ? req.data.text.trim().slice(0, 4000) : "";
  if (!text) throw new HttpsError("invalid-argument", "text 가 비어 있어요.");
  const { now } = wallClock(req.data?.timeZone);

  return mutate(uid, now, async (before) => {
    const userMsg: ChatMessage = { id: newId(), role: "user", text, cards: [], createdAt: now.toISOString() };
    const turn = runLocalTurn(before, text, now);
    let state = turn.state;
    let reply = turn.text;
    if (turn.undoLast) {
      const last = [...before.messages].reverse().flatMap((m) => [...m.cards].reverse()).find((c) => c.kind === "changes" && !c.undone);
      if (last) state = undoChanges(before, last.id, now);
      else reply = "되돌릴 게 없어요.";
    }

    // 답은 사용자 말 1ms 뒤 — 같은 시각이면 순서가 뒤집힐 수 있다
    const replyMsg: ChatMessage = { id: newId(), role: "assistant", text: reply, cards: turn.cards, createdAt: new Date(Date.parse(userMsg.createdAt) + 1).toISOString(), via: "local" };
    return {
      state: { ...state, messages: [...state.messages, userMsg, replyMsg] },
      result: { messageId: replyMsg.id, text: reply, via: "local" as const },
    };
  });
});
