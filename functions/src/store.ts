/**
 * Firestore ↔ AppState. 사용자 한 명의 데이터는 users/{uid}/{collection}/{id} 에 있다.
 *
 * 함수는 상태 전체를 읽고 → packages/core 의 순수 함수로 바꾸고 → **바뀐 문서만** 쓴다(saveDiff).
 * 개인용 규모(할일 수백 개)라 매번 전부 읽어도 충분하고, 그 덕에 규칙이 앱과 서버에서 똑같이 돈다.
 */
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { emptyState, type AppState } from "../../packages/core/src/types.ts";

export const COLLECTIONS = ["tasks", "events", "scraps", "messages", "nodes", "edges"] as const;
type Coll = (typeof COLLECTIONS)[number];

/** 대화는 최근 것만 읽는다(모델 문맥 · 카드 처리에 충분) */
const MESSAGE_WINDOW = 60;

let db: Firestore | null = null;
function firestore(): Firestore {
  if (!db) db = getFirestore();
  return db;
}

export async function loadState(uid: string): Promise<AppState> {
  const base = firestore().collection("users").doc(uid);
  const state = emptyState();
  await Promise.all(
    COLLECTIONS.map(async (coll) => {
      const q = coll === "messages" ? base.collection(coll).orderBy("createdAt", "desc").limit(MESSAGE_WINDOW) : base.collection(coll);
      const snap = await q.get();
      const docs = snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }));
      (state as unknown as Record<Coll, unknown[]>)[coll] = coll === "messages" ? docs.reverse() : docs;
    }),
  );
  return state;
}

/** Firestore 는 undefined 를 받지 않는다 — JSON 왕복으로 뺀다 */
function clean<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** before → after 에서 새로 생기거나 바뀐 문서는 쓰고, 사라진 문서는 지운다. 쓴 문서 수를 돌려준다 */
export async function saveDiff(uid: string, before: AppState, after: AppState): Promise<number> {
  const base = firestore().collection("users").doc(uid);
  let batch = firestore().batch();
  let ops = 0;
  let total = 0;
  const flush = async () => {
    if (ops > 0) await batch.commit();
    batch = firestore().batch();
    ops = 0;
  };
  for (const coll of COLLECTIONS) {
    const prev = new Map((before[coll] as { id: string }[]).map((x) => [x.id, JSON.stringify(x)]));
    const next = after[coll] as { id: string }[];
    const nextIds = new Set(next.map((x) => x.id));
    for (const item of next) {
      const json = JSON.stringify(item);
      if (prev.get(item.id) === json) continue;
      const { id, ...data } = clean(item) as { id: string } & Record<string, unknown>;
      batch.set(base.collection(coll).doc(id), data);
      ops++;
      total++;
      if (ops >= 400) await flush();
    }
    for (const id of prev.keys()) {
      if (nextIds.has(id)) continue;
      batch.delete(base.collection(coll).doc(id));
      ops++;
      total++;
      if (ops >= 400) await flush();
    }
  }
  await flush();
  return total;
}
