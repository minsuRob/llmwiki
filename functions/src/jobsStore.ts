/**
 * 취준 공고 저장 — users/{uid}/jobs/{id} (목록용, 작게) · users/{uid}/jobTexts/{id} (본문, 펼칠 때만 읽는다).
 * 함수(features/jobs.ts)와 Admin 스크립트(scripts/import-jobs.ts)가 같은 이 코드로 쓴다 — 규칙은 packages/core/src/jobs.ts.
 * AppState(store.ts)와 따로 둔다. 대화 · 시냅스가 공고 수천 건을 매번 읽지 않게.
 */
import type { Firestore } from "firebase-admin/firestore";

import { hashJob, planJobPrune, planJobSync, type Job, type JobSource, type JobText } from "../../packages/core/src/jobs.ts";

export interface JobUpsertResult {
  written: number;
  unchanged: number;
  removed: number;
  expired: number;
}

const jobsOf = (db: Firestore, uid: string) => db.collection("users").doc(uid).collection("jobs");
const textsOf = (db: Firestore, uid: string) => db.collection("users").doc(uid).collection("jobTexts");

async function existingJobs(db: Firestore, uid: string): Promise<Pick<Job, "id" | "hash" | "dueDate" | "source">[]> {
  const snap = await jobsOf(db, uid).select("hash", "dueDate", "source").get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Pick<Job, "hash" | "dueDate" | "source">) }));
}

/** 400개씩 묶어 쓴다(한 묶음 500 한도) */
async function inBatches(db: Firestore, ops: ((b: FirebaseFirestore.WriteBatch) => void)[]): Promise<void> {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    ops.slice(i, i + 400).forEach((op) => op(batch));
    await batch.commit();
  }
}

/**
 * 공고 묶음 하나를 넣는다. 새것 · 바뀐 것만 쓰고, 지난 공고는 넣지 않고 이미 있으면 지운다.
 * 원본에서 사라진 공고 정리는 prune 이 한다(나눠 보내므로 여기서는 모른다).
 * hash 는 받은 값을 믿지 않고 다시 계산한다.
 */
export async function upsertJobs(db: Firestore, uid: string, jobs: Job[], texts: JobText[], today: string, nowIso: string): Promise<JobUpsertResult> {
  const incoming = jobs.map((j) => hashJob(j));
  const plan = planJobSync(await existingJobs(db, uid), incoming, today);
  const textById = new Map(texts.map((t) => [t.id, t.text]));
  const ops: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];
  for (const j of plan.write) {
    const { id, ...data } = j;
    ops.push((b) => b.set(jobsOf(db, uid).doc(id), { ...data, importedAt: nowIso }));
    const text = textById.get(id);
    if (j.hasText && text) ops.push((b) => b.set(textsOf(db, uid).doc(id), { text }));
    else ops.push((b) => b.delete(textsOf(db, uid).doc(id)));
  }
  for (const id of plan.remove) {
    ops.push((b) => b.delete(jobsOf(db, uid).doc(id)));
    ops.push((b) => b.delete(textsOf(db, uid).doc(id)));
  }
  await inBatches(db, ops);
  return { written: plan.write.length, unchanged: plan.unchanged, removed: plan.remove.length, expired: plan.expired.length };
}

/** 마무리 — keepIds 에 없는 sources 공고와 지난 공고를 지운다. 지운 수 */
export async function pruneJobs(db: Firestore, uid: string, keepIds: string[], sources: JobSource[], today: string): Promise<number> {
  const ids = planJobPrune(await existingJobs(db, uid), keepIds, sources, today);
  await inBatches(
    db,
    ids.flatMap((id) => [(b: FirebaseFirestore.WriteBatch) => b.delete(jobsOf(db, uid).doc(id)), (b: FirebaseFirestore.WriteBatch) => b.delete(textsOf(db, uid).doc(id))]),
  );
  return ids.length;
}
