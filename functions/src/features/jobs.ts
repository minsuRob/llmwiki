/**
 * 취준 공고 — POST jobsSync. 원본(그룹바이 · 인디스워크)을 나눠 보내고 마지막에 정리한다.
 * - { op: "upsert", jobs: Job[], texts?: JobText[] }  최대 300건 · 본문 60건. 새것 · 바뀐 것만 쓰고 지난 공고는 넣지 않는다
 * - { op: "prune", sources: JobSource[], keepIds: string[] }  keepIds 에 없는 그 출처 공고 · 지난 공고를 지운다
 * 같은 일을 Admin 스크립트(scripts/import-jobs.ts --via admin)도 같은 코드(jobsStore.ts)로 한다.
 */
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";

import { JOB_SOURCES, JOB_TEXT_LIMIT, checkJob, pickJob, type Job, type JobSource, type JobText } from "../../../packages/core/src/jobs.ts";
import { REGION, requireUid, wallClock } from "../common.ts";
import { pruneJobs, upsertJobs } from "../jobsStore.ts";

export type JobsSyncRequest =
  | { op: "upsert"; jobs: unknown[]; texts?: unknown[]; timeZone?: string }
  | { op: "prune"; sources: JobSource[]; keepIds: string[]; timeZone?: string };

const MAX_JOBS = 300;
const MAX_TEXTS = 60;

/** 사용자 날짜 "YYYY-MM-DD" */
export function todayOf(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function parseTexts(v: unknown): JobText[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAX_TEXTS) throw new HttpsError("invalid-argument", `texts 는 ${MAX_TEXTS}건까지 목록이어야 해요.`);
  return v.map((t, i) => {
    const r = t as Record<string, unknown>;
    if (typeof r?.id !== "string" || typeof r.text !== "string") throw new HttpsError("invalid-argument", `texts[${i}] 모양이 틀렸어요.`);
    return { id: r.id, text: r.text.slice(0, JOB_TEXT_LIMIT) };
  });
}

export const jobsSync = onCall<JobsSyncRequest>({ region: REGION, timeoutSeconds: 120 }, async (req) => {
  const uid = requireUid(req);
  const { now } = wallClock(req.data?.timeZone);
  const today = todayOf(now);
  const db = getFirestore();
  const data = req.data;

  if (data?.op === "upsert") {
    if (!Array.isArray(data.jobs) || data.jobs.length > MAX_JOBS) throw new HttpsError("invalid-argument", `jobs 는 ${MAX_JOBS}건까지 목록이어야 해요.`);
    const jobs: Job[] = data.jobs.map((v, i) => {
      const why = checkJob(v);
      if (why) throw new HttpsError("invalid-argument", `jobs[${i}]: ${why}`);
      return pickJob(v as Record<string, unknown>);
    });
    const ids = new Set(jobs.map((j) => j.id));
    const texts = parseTexts(data.texts).filter((t) => ids.has(t.id));
    return upsertJobs(db, uid, jobs, texts, today, new Date().toISOString());
  }
  if (data?.op === "prune") {
    const sources = Array.isArray(data.sources) ? data.sources.filter((s): s is JobSource => JOB_SOURCES.includes(s)) : [];
    if (!sources.length) throw new HttpsError("invalid-argument", "sources 가 필요해요.");
    if (!Array.isArray(data.keepIds) || data.keepIds.some((x) => typeof x !== "string")) throw new HttpsError("invalid-argument", "keepIds 는 문자열 목록이어야 해요.");
    return { removed: await pruneJobs(db, uid, data.keepIds, sources, today) };
  }
  throw new HttpsError("invalid-argument", "op 는 upsert · prune 이에요.");
});
