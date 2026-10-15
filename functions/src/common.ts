/**
 * 기능 함수들이 함께 쓰는 것 — 로그인 확인 · 사용자 시각 · "읽고 → 바꾸고 → 시냅스 다시 계산 → 바뀐 것만 쓰기" 한 바퀴.
 */
import { HttpsError, type CallableRequest } from "firebase-functions/https";

import { rebuildGraph } from "../../packages/core/src/synapse.ts";
import type { AppState } from "../../packages/core/src/types.ts";
import { loadState, saveDiff } from "./store.ts";

export const REGION = "asia-northeast3";

export function requireUid(req: CallableRequest<unknown>): string {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요해요.");
  return uid;
}

/**
 * 사용자의 벽시계 시각 — core 는 Date 의 getHours 같은 지역 시각 함수로 오늘 · 내일을 계산한다.
 * 서버(UTC)에서 사용자 시간대의 연 · 월 · 일 · 시 · 분을 그대로 담은 Date 를 만들어 넘긴다.
 * (그래서 서버가 쓰는 createdAt 도 사용자 벽시계 기준이다 — 한 사용자 안에서 순서는 맞다)
 */
export function wallClock(timeZone: string | undefined, at = new Date()): { now: Date; timeZone: string } {
  const tz = safeZone(timeZone);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    now: new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second), at.getMilliseconds()),
    timeZone: tz,
  };
}

function safeZone(tz: string | undefined): string {
  if (!tz) return "Asia/Seoul";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "Asia/Seoul";
  }
}

/** 상태를 읽고, fn 으로 바꾸고, 글이 바뀌었으면 시냅스를 다시 계산해, 바뀐 문서만 쓴다 */
export async function mutate<R>(uid: string, now: Date, fn: (state: AppState) => Promise<{ state: AppState; result: R }> | { state: AppState; result: R }): Promise<R> {
  const before = await loadState(uid);
  const { state, result } = await fn(before);
  let after = state;
  if (textsChanged(before, after)) after = { ...after, ...rebuildGraph(after, now) };
  await saveDiff(uid, before, after);
  return result;
}

/** 시냅스 재료(기록 · 할일 제목 · 지움)가 바뀌었나 */
function textsChanged(a: AppState, b: AppState): boolean {
  const sig = (s: AppState) =>
    JSON.stringify([
      s.scraps.map((x) => [x.id, x.text, x.deletedAt ?? null, x.concepts ?? null]),
      s.tasks.map((x) => [x.id, x.title, x.notes ?? null, x.deletedAt ?? null]),
    ]);
  return sig(a) !== sig(b);
}

export function anthropicKey(): string | null {
  const k = process.env.ANTHROPIC_API_KEY?.trim();
  return k ? k : null;
}
