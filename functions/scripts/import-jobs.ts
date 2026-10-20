/**
 * 취준 공고 넣기 — 로컬 구직 폴더(그룹바이 · 인디스워크)를 읽어 users/{uid}/jobs 에 맞춘다. 원본은 읽기만 한다.
 *
 *   node scripts/import-jobs.ts --src "<구직 폴더>" --uid <uid> [--target emulator|cloud] [--via admin|function] [--dry-run]
 *
 * - --via admin    Admin SDK 로 바로 쓴다(jobsStore.ts). 클라우드면 `gcloud auth application-default login` 이 필요하다.
 * - --via function 그 uid 로 로그인한 것처럼 jobsSync 함수를 부른다(Admin 으로 커스텀 토큰을 만든다).
 *                  클라우드에서 커스텀 토큰을 만들려면 서비스 계정 서명 권한(Service Account Token Creator)이 필요하다.
 * - --target       기본 emulator. cloud 는 실제 프로젝트(llmwiki-minsu)다.
 *                  에뮬레이터 포트를 바꿨으면 FIRESTORE_EMULATOR_HOST · FIREBASE_AUTH_EMULATOR_HOST · FUNCTIONS_EMULATOR_PORT 로 준다.
 * - --dry-run      읽고 거른 결과만 보여 주고 쓰지 않는다.
 * 지난 공고(마감 날짜 < 오늘, 서울 기준)는 넣지 않고, 이미 있으면 지운다. 다시 돌려도 바뀐 것만 쓴다.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { fromGroupby, fromInthiswork, isExpired, type Job, type JobSource, type JobText } from "../../packages/core/src/jobs.ts";
import { pruneJobs, upsertJobs } from "../src/jobsStore.ts";

const PROJECT = "llmwiki-minsu";
const REGION = "asia-northeast3";
const CHUNK = 60;

const { values: args } = parseArgs({
  options: {
    src: { type: "string" },
    uid: { type: "string" },
    target: { type: "string", default: "emulator" },
    via: { type: "string", default: "admin" },
    "dry-run": { type: "boolean", default: false },
  },
});
if (!args.src || (!args.uid && !args["dry-run"])) {
  console.error('사용: node scripts/import-jobs.ts --src "<구직 폴더>" --uid <uid> [--target emulator|cloud] [--via admin|function] [--dry-run]');
  process.exit(2);
}
const CLOUD = args.target === "cloud";
if (!["emulator", "cloud"].includes(args.target!) || !["admin", "function"].includes(args.via!)) {
  console.error("--target 은 emulator · cloud, --via 는 admin · function 이에요.");
  process.exit(2);
}
if (!CLOUD) {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
}

/** 서울 날짜 "YYYY-MM-DD" */
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// ---------------- 읽기 ----------------
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8")) as unknown;

function readGroupby(root: string): { jobs: Job[]; skipped: number } {
  const dir = join(root, ".groupby-data", "out");
  const jobs: Job[] = [];
  let skipped = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const j = fromGroupby(readJson(join(dir, f)) as Record<string, unknown>);
    if (j) jobs.push(j);
    else skipped++;
  }
  return { jobs, skipped };
}

function readInthiswork(root: string): { jobs: Job[]; texts: JobText[]; skipped: number } {
  const dir = join(root, "인디스워크", ".data");
  const posts = readJson(join(dir, "posts.json")) as Record<string, unknown>[];
  const jobs: Job[] = [];
  const texts: JobText[] = [];
  let skipped = 0;
  for (const p of posts) {
    const tf = join(dir, "text", `${String(p.id)}.txt`);
    const r = fromInthiswork(p, existsSync(tf) ? readFileSync(tf, "utf8") : null);
    if (!r) {
      skipped++;
      continue;
    }
    jobs.push(r.job);
    if (r.text) texts.push(r.text);
  }
  return { jobs, texts, skipped };
}

const gb = readGroupby(args.src);
const itw = readInthiswork(args.src);
const all = [...gb.jobs, ...itw.jobs];
const live = all.filter((j) => !isExpired(j, today));
const liveIds = new Set(live.map((j) => j.id));
const texts = itw.texts.filter((t) => liveIds.has(t.id));
const expired = all.filter((j) => isExpired(j, today));

console.log(`오늘(서울) ${today}`);
console.log(`그룹바이 ${gb.jobs.length}건 (조사 못 한 공고 ${gb.skipped}건 뺌)`);
console.log(`인디스워크 ${itw.jobs.length}건 (형식이 모자란 공고 ${itw.skipped}건 뺌), 본문 ${itw.texts.length}건`);
console.log(`지난 공고 ${expired.length}건 뺌: ${expired.map((j) => `${j.id}(${j.dueDate})`).join(", ") || "없음"}`);
console.log(`넣을 공고 ${live.length}건 · 본문 ${texts.length}건 · 마감 날짜 있는 공고 ${live.filter((j) => j.dueDate).length}건`);
if (args["dry-run"]) process.exit(0);

// ---------------- 쓰기 ----------------
const uid = args.uid!;
const SOURCES: JobSource[] = ["groupby", "inthiswork"];
initializeApp({ projectId: PROJECT });
const db = getFirestore();
const textOf = new Map(texts.map((t) => [t.id, t]));
const chunks: Job[][] = [];
for (let i = 0; i < live.length; i += CHUNK) chunks.push(live.slice(i, i + CHUNK));

const sum = { written: 0, unchanged: 0, removed: 0, expired: 0 };
const add = (r: typeof sum) => (Object.keys(sum) as (keyof typeof sum)[]).forEach((k) => (sum[k] += r[k]));

if (args.via === "admin") {
  const nowIso = new Date().toISOString();
  for (const c of chunks) add(await upsertJobs(db, uid, c, c.map((j) => textOf.get(j.id)).filter((t): t is JobText => !!t), today, nowIso));
  sum.removed += await pruneJobs(db, uid, [...liveIds], SOURCES, today);
} else {
  const idToken = await signInAs(uid);
  const base = CLOUD ? `https://${REGION}-${PROJECT}.cloudfunctions.net` : `http://127.0.0.1:${process.env.FUNCTIONS_EMULATOR_PORT ?? 5001}/${PROJECT}/${REGION}`;
  const call = async (data: unknown) => {
    const res = await fetch(`${base}/jobsSync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ data: { ...(data as object), timeZone: "Asia/Seoul" } }),
    });
    const body = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (!res.ok || body.error) throw new Error(`jobsSync ${res.status}: ${body.error?.message ?? JSON.stringify(body)}`);
    return body.result;
  };
  for (const c of chunks) add((await call({ op: "upsert", jobs: c, texts: c.map((j) => textOf.get(j.id)).filter(Boolean) })) as typeof sum);
  sum.removed += ((await call({ op: "prune", sources: SOURCES, keepIds: [...liveIds] })) as { removed: number }).removed;
}

const count = (await db.collection("users").doc(uid).collection("jobs").count().get()).data().count;
console.log(`[${args.target} · ${args.via}] 쓴 공고 ${sum.written} · 같아서 건너뜀 ${sum.unchanged} · 지움 ${sum.removed}`);
console.log(`users/${uid}/jobs 지금 ${count}건`);
process.exit(0);

/** uid 로 로그인한 ID 토큰 — Admin 커스텀 토큰을 Auth REST 로 바꾼다 */
async function signInAs(u: string): Promise<string> {
  const custom = await getAuth().createCustomToken(u);
  const key = CLOUD ? webApiKey() : "emulator";
  const host = CLOUD ? "https://identitytoolkit.googleapis.com" : `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com`;
  const res = await fetch(`${host}/v1/accounts:signInWithCustomToken?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const body = (await res.json()) as { idToken?: string; error?: { message: string } };
  if (!body.idToken) throw new Error(`로그인 토큰을 받지 못했어요: ${body.error?.message ?? res.status}`);
  return body.idToken;
}

function webApiKey(): string {
  const src = readFileSync(new URL("../../aria-rn/src/firebase/config.ts", import.meta.url), "utf8");
  return /apiKey: "([^"]+)"/.exec(src)![1];
}
