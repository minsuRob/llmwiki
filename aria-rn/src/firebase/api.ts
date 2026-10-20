/**
 * API — Cloud Functions(functions/src/features/*) 호출을 기능별로 감싼다. 요청 모양은 서버 파일과 같다.
 * 사용자 시간대를 함께 보내 서버가 "오늘 · 내일" 을 사용자 기준으로 계산한다.
 */
import { httpsCallable } from "firebase/functions";

import { translate, type T } from "../i18n";
import { functions } from "./client";
import type { TaskPriority, TaskStatus } from "../../../packages/core/src/types.ts";

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function callable<Req, Res>(name: string) {
  const fn = httpsCallable<Req & { timeZone: string }, Res>(functions, name);
  return async (data: Req): Promise<Res> => (await fn({ ...data, timeZone: timeZone() })).data;
}

/** 대화 — functions/src/features/chat.ts */
export const sendChat = callable<{ text: string }, { messageId: string; text: string; via: "claude" | "local" }>("chat");

/** 카드 단추 — functions/src/features/cards.ts */
export type CardAction =
  | { cardId: string; action: "undo" | "suggest_add_all" | "close" }
  | { cardId: string; action: "overdue_complete" | "overdue_today" | "overdue_delete"; taskId: string }
  | { cardId: string; action: "suggest_add" | "suggest_skip"; index: number };
export const cardAction = callable<CardAction, { ok: boolean }>("cardAction");

/** 할일 탭 — functions/src/features/tasks.ts */
export type TaskAction =
  | { op: "create"; title: string; due?: string | null; status?: TaskStatus; priority?: TaskPriority }
  | { op: "toggle" | "delete" | "restore"; id: string }
  | { op: "update"; id: string; status?: TaskStatus; priority?: TaskPriority }
  | { op: "purge" };
export const taskAction = callable<TaskAction, { id?: string; ok?: boolean }>("taskAction");

/** 시냅스 — functions/src/features/synapse.ts */
export const rebuildSynapse = callable<Record<string, never>, { nodes: number; edges: number; via: "claude" | "rules" }>("rebuildSynapse");

/** 서버 오류 → 사용자에게 보일 한 줄 */
export function errorText(e: unknown, t: T = (k, p) => translate("ko", k, p)): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/operation-not-allowed/i.test(msg)) return t("app.err.googleOff");
  if (/popup-blocked/i.test(msg)) return t("app.err.popupBlocked");
  if (/unauthorized-domain/i.test(msg)) return t("app.err.domain");
  if (/unauthenticated/i.test(msg)) return t("app.err.unauthenticated");
  if (/internal|unavailable|network|Failed to fetch/i.test(msg)) return t("app.err.network");
  return msg.replace(/^FirebaseError:\s*/, "").slice(0, 160);
}
