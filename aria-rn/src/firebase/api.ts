/**
 * API — Cloud Functions(functions/src/features/*) 호출을 기능별로 감싼다. 요청 모양은 서버 파일과 같다.
 * 사용자 시간대를 함께 보내 서버가 "오늘 · 내일" 을 사용자 기준으로 계산한다.
 */
import { httpsCallable } from "firebase/functions";

import { functions } from "./client";

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
  | { op: "create"; title: string; due?: string | null }
  | { op: "toggle" | "delete" | "restore"; id: string }
  | { op: "purge" };
export const taskAction = callable<TaskAction, { id?: string; ok?: boolean }>("taskAction");

/** 시냅스 — functions/src/features/synapse.ts */
export const rebuildSynapse = callable<Record<string, never>, { nodes: number; edges: number; via: "claude" | "rules" }>("rebuildSynapse");

/** 서버 오류 → 사용자에게 보일 한 줄 */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/operation-not-allowed/i.test(msg)) return "Google 로그인이 아직 꺼져 있어요(Firebase 콘솔에서 켜야 해요).";
  if (/popup-blocked/i.test(msg)) return "브라우저가 로그인 창을 막았어요. 팝업을 허용하고 다시 눌러 주세요.";
  if (/unauthorized-domain/i.test(msg)) return "이 주소는 로그인 허용 도메인이 아니에요.";
  if (/unauthenticated/i.test(msg)) return "로그인이 풀렸어요. 앱을 다시 열어 주세요.";
  if (/internal|unavailable|network|Failed to fetch/i.test(msg)) return "서버에 닿지 못했어요. 잠시 뒤 다시 해 주세요.";
  return msg.replace(/^FirebaseError:\s*/, "").slice(0, 160);
}
