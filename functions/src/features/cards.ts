/**
 * 카드 — POST cardAction { cardId, action, taskId?, index?, timeZone? }
 * - undo: 변경 카드 되돌리기
 * - overdue_complete · overdue_today · overdue_delete: 기한 지난 할일 줄 단추(taskId)
 * - suggest_add · suggest_skip: 제안 줄 단추(index), suggest_add_all: 남은 줄 모두 추가
 * - close: 기한 지난 할일 · 제안 카드 닫기
 * 이미 처리된 카드 · 줄이면 아무것도 바꾸지 않는다(두 번 눌러도 한 번).
 */
import { HttpsError, onCall } from "firebase-functions/https";

import { closeCard, findCard, resolveOverdue, resolveSuggest, undoChanges } from "../../../packages/core/src/engine.ts";
import { REGION, mutate, requireUid, wallClock } from "../common.ts";

export type CardActionName =
  | "undo"
  | "overdue_complete"
  | "overdue_today"
  | "overdue_delete"
  | "suggest_add"
  | "suggest_skip"
  | "suggest_add_all"
  | "close";

export interface CardActionRequest {
  cardId: string;
  action: CardActionName;
  taskId?: string;
  index?: number;
  timeZone?: string;
}

export const cardAction = onCall<CardActionRequest>({ region: REGION }, async (req) => {
  const uid = requireUid(req);
  const { cardId, action, taskId, index } = req.data ?? ({} as CardActionRequest);
  if (typeof cardId !== "string" || !cardId) throw new HttpsError("invalid-argument", "cardId 가 필요해요.");
  const { now } = wallClock(req.data?.timeZone);

  return mutate(uid, now, (s) => {
    if (!findCard(s, cardId)) throw new HttpsError("not-found", "카드를 찾지 못했어요.");
    switch (action) {
      case "undo":
        return { state: undoChanges(s, cardId, now), result: { ok: true } };
      case "overdue_complete":
      case "overdue_today":
      case "overdue_delete": {
        if (typeof taskId !== "string") throw new HttpsError("invalid-argument", "taskId 가 필요해요.");
        const a = action === "overdue_complete" ? "complete" : action === "overdue_today" ? "today" : "delete";
        return { state: resolveOverdue(s, cardId, taskId, a, now), result: { ok: true } };
      }
      case "suggest_add":
      case "suggest_skip": {
        if (typeof index !== "number") throw new HttpsError("invalid-argument", "index 가 필요해요.");
        return { state: resolveSuggest(s, cardId, index, action === "suggest_add" ? "add" : "skip", now), result: { ok: true } };
      }
      case "suggest_add_all": {
        const card = findCard(s, cardId);
        let next = s;
        if (card?.kind === "suggest") card.rows.forEach((r, i) => r.state === "open" && (next = resolveSuggest(next, cardId, i, "add", now)));
        return { state: next, result: { ok: true } };
      }
      case "close":
        return { state: closeCard(s, cardId), result: { ok: true } };
      default:
        throw new HttpsError("invalid-argument", `모르는 action: ${String(action)}`);
    }
  });
});
