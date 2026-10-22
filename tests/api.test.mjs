/**
 * API 통합 테스트 — Firebase 에뮬레이터(Auth · Firestore · Functions)에 대고 기능별로 끝까지 돌린다.
 * 실행: npm run test:api  (functions 를 번들하고 emulators:exec 로 이 파일을 돌린다)
 * 키(ANTHROPIC_API_KEY) 없이 돈다 — 서버는 packages/core 의 한국어 규칙 길로 답한다.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { deleteApp, getApps, initializeApp } from "firebase/app";
import { GoogleAuthProvider, connectAuthEmulator, getAuth, signInAnonymously, signInWithCredential, signOut } from "firebase/auth";
import { collection, connectFirestoreEmulator, doc, getDocs, getFirestore, orderBy, query, setDoc, terminate } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

import { readFileSync, appendFileSync } from "node:fs";

import { fromGroupby, fromInthiswork } from "../packages/core/src/jobs.ts";

/**
 * API_TARGET=cloud 이면 배포된 프로젝트(llmwiki-minsu)에 대고 돈다 — 쓴 사용자 uid 를 API_TEST_UIDS_FILE 에 적어
 * tests/cloud-smoke.sh 가 끝난 뒤 데이터와 계정을 지운다. 아니면 로컬 에뮬레이터.
 */
const CLOUD = process.env.API_TARGET === "cloud";
function webConfig() {
  const src = readFileSync(new URL("../aria-rn/src/firebase/config.ts", import.meta.url), "utf8");
  const pick = (k) => new RegExp(`${k}: "([^"]+)"`).exec(src)[1];
  return { apiKey: pick("apiKey"), authDomain: pick("authDomain"), projectId: pick("projectId"), appId: pick("appId") };
}
const CONFIG = CLOUD ? webConfig() : { apiKey: "emulator", projectId: "llmwiki-minsu", authDomain: "localhost" };
const noteUid = (u) => process.env.API_TEST_UIDS_FILE && appendFileSync(process.env.API_TEST_UIDS_FILE, `${u}\n`);

const app = initializeApp(CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
const fns = getFunctions(app, "asia-northeast3");
// emulators:exec 가 넣어 주는 주소를 따른다(포트를 바꿔 띄워도 돈다). FUNCTIONS_EMULATOR_PORT 는 직접 준다
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const [FS_HOST, FS_PORT] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
const FN_PORT = Number(process.env.FUNCTIONS_EMULATOR_PORT ?? 5001);
if (!CLOUD) {
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  connectFirestoreEmulator(db, FS_HOST, Number(FS_PORT));
  connectFunctionsEmulator(fns, "127.0.0.1", FN_PORT);
}

const TZ = "Asia/Seoul";
const call = (name, data) => httpsCallable(fns, name)({ ...data, timeZone: TZ }).then((r) => r.data);
const chat = (text) => call("chat", { text });

let uid = "";
const list = async (coll) => (await getDocs(collection(db, "users", uid, coll))).docs.map((d) => ({ id: d.id, ...d.data() }));
const live = (xs) => xs.filter((x) => !x.deletedAt);
async function lastCard(kind) {
  const snap = await getDocs(query(collection(db, "users", uid, "messages"), orderBy("createdAt", "asc")));
  const msgs = snap.docs.map((d) => d.data());
  for (let i = msgs.length - 1; i >= 0; i--) {
    const card = (msgs[i].cards ?? []).find((c) => c.kind === kind);
    if (card) return card;
  }
  return null;
}

// 연결을 닫지 않으면 테스트가 끝나도 프로세스가 남는다
after(async () => {
  await terminate(db);
  await Promise.all(getApps().map((a) => deleteApp(a)));
});

before(async () => {
  const cred = await signInAnonymously(auth);
  uid = cred.user.uid;
  noteUid(uid);
});

test("로그인 없이는 부를 수 없다", async () => {
  const other = getAuth(initializeApp(CONFIG, "anon"));
  const fns2 = getFunctions(other.app, "asia-northeast3");
  if (!CLOUD) {
    connectAuthEmulator(other, `http://${AUTH_HOST}`, { disableWarnings: true });
    connectFunctionsEmulator(fns2, "127.0.0.1", FN_PORT);
  }
  await assert.rejects(httpsCallable(fns2, "chat")({ text: "안녕" }), /unauthenticated|로그인/);
});

test("대화 → 일정 · 할일 · 변경 카드, 되돌리기", async () => {
  const r1 = await chat("내일 오후 3시 팀 회의");
  assert.equal(r1.via, "local");
  assert.match(r1.text, /일정 1개/);
  assert.equal(live(await list("events")).length, 1);

  const r2 = await chat("금요일까지 견적서 보내기, 우유 사기");
  assert.match(r2.text, /할일 2개/);
  assert.equal(live(await list("tasks")).length, 2);

  const card = await lastCard("changes");
  assert.equal(card.createdTaskIds.length, 2);
  await call("cardAction", { cardId: card.id, action: "undo" });
  assert.equal(live(await list("tasks")).length, 0, "되돌리면 만든 할일이 휴지통으로");
  assert.equal((await lastCard("changes")).undone, true);
  // 두 번 눌러도 그대로
  await call("cardAction", { cardId: card.id, action: "undo" });
  assert.equal(live(await list("tasks")).length, 0);

  const r3 = await chat("방금 거 취소해");
  assert.match(r3.text, /되돌렸어요/);
  assert.equal(live(await list("events")).length, 0, "대화로 취소하면 마지막 변경(일정)을 되돌린다");
});

test("기한 지난 할일 카드 — 완료 · 오늘로", async () => {
  await chat("10월 1일 회의록 정리, 10월 2일 오전 10시 거래처 전화");
  await chat("밀린 할일 정리해줘");
  const card = await lastCard("overdue");
  assert.ok(card, "기한 지난 할일 카드가 떠야 한다");
  const tasks = live(await list("tasks"));
  const minutes = tasks.find((t) => t.title === "회의록 정리");
  const call2 = tasks.find((t) => t.title === "거래처 전화");
  await call("cardAction", { cardId: card.id, action: "overdue_complete", taskId: minutes.id });
  await call("cardAction", { cardId: card.id, action: "overdue_today", taskId: call2.id });
  const after = await list("tasks");
  assert.equal(after.find((t) => t.id === minutes.id).done, true);
  assert.match(after.find((t) => t.id === call2.id).due, /T10:00$/, "오늘로 옮겨도 시각은 지킨다");
  const closed = await lastCard("overdue");
  assert.ok(closed.rows.every((r) => r.state !== "open"));
});

test("제안 카드 — 누르기 전엔 없고, 모두 추가하면 생긴다", async () => {
  const before = live(await list("tasks")).length;
  await chat("이번 주 할 거\n- 발표 자료 만들기\n- 치과 예약\n- 헬스장 등록");
  const card = await lastCard("suggest");
  assert.equal(card.rows.length, 3);
  assert.equal(live(await list("tasks")).length, before, "제안만 했다");
  await call("cardAction", { cardId: card.id, action: "suggest_skip", index: 1 });
  await call("cardAction", { cardId: card.id, action: "suggest_add_all" });
  const titles = live(await list("tasks")).map((t) => t.title);
  assert.ok(titles.includes("발표 자료 만들기") && titles.includes("헬스장 등록"));
  assert.ok(!titles.includes("치과 예약"));
});

test("시냅스 — 기록이 쌓이면 개념이 이어지고, 떠올리기 카드가 근거를 모은다", async () => {
  await chat("메모: 채용 공고를 다음 주에 올리기로 했다");
  await chat("메모: 채용 면접이 걱정된다");
  await chat("메모: 디자이너 채용은 천천히");
  const nodes = await list("nodes");
  const hire = nodes.find((n) => n.name === "채용");
  assert.ok(hire, "채용 노드가 생겨야 한다");
  assert.equal(hire.refs.length, 3);
  const edges = await list("edges");
  const worry = nodes.find((n) => n.name === "불안");
  assert.ok(worry && edges.some((e) => [e.a, e.b].includes(hire.id) && [e.a, e.b].includes(worry.id)), "감정은 원인과 이어진다");

  const r = await chat("전에 채용 얘기 뭐라고 했지?");
  assert.match(r.text, /채용/);
  const card = await lastCard("recall");
  assert.equal(card.scrapIds.length, 3);

  const rebuilt = await call("rebuildSynapse", {});
  assert.equal(rebuilt.via, "rules");
  assert.ok(rebuilt.nodes >= 2);
});

test("할일 탭 API — 만들기 · 체크 · 휴지통 · 되살리기", async () => {
  const { id } = await call("taskAction", { op: "create", title: "택배 보내기" });
  await call("taskAction", { op: "toggle", id });
  assert.equal((await list("tasks")).find((t) => t.id === id).done, true);
  await call("taskAction", { op: "delete", id });
  assert.ok((await list("tasks")).find((t) => t.id === id).deletedAt);
  await call("taskAction", { op: "restore", id });
  assert.equal((await list("tasks")).find((t) => t.id === id).deletedAt ?? null, null);
  await assert.rejects(call("taskAction", { op: "toggle", id: "nope" }), /찾지 못했어요|not-found/);
});

test("할일 상태 · 우선순위 — 탭에서 바꾸고, 대화(규칙 길)로도 바꾼다", async () => {
  const { id } = await call("taskAction", { op: "create", title: "LLM 공부", priority: "최우선" });
  let t = (await list("tasks")).find((x) => x.id === id);
  assert.equal(t.priority, "최우선");
  await call("taskAction", { op: "update", id, status: "대기" });
  assert.equal((await list("tasks")).find((x) => x.id === id).status, "대기");
  await call("taskAction", { op: "update", id, status: "완료" });
  t = (await list("tasks")).find((x) => x.id === id);
  assert.equal(t.done, true);
  await assert.rejects(call("taskAction", { op: "update", id, priority: "아주 급함" }), /priority|invalid-argument/);

  const { id: h } = await call("taskAction", { op: "create", title: "헤르메스 연동" });
  const r = await chat("헤르메스 보류");
  assert.match(r.text, /보류로 바꿨어요/);
  assert.equal((await list("tasks")).find((x) => x.id === h).status, "보류");
});

test("취준 공고 — 넣기 · 지난 공고 빼기 · 다시 넣어도 그대로 · 정리 · 본문", async () => {
  const gb = (id, over = {}) =>
    fromGroupby({ id, status: "완료", company: `회사${id}`, title: "백엔드 개발자", main: "API 개발", due: "마감일 미기재", dev: true, devReason: "개발", ...over });
  const itw = fromInthiswork(
    { id: 900, company: "인디", pos: "AI 엔지니어", link: "https://inthiswork.com/archives/900", apply: null, jobs: [], it: true, aititle: true, tasks: ["LLM"], due: "2099.1.2", date: "2026-10-15" },
    "공고 본문",
  );
  const jobs = [gb(1), gb(2), gb(3, { due: "2020-01-01" }), itw.job];
  const r1 = await call("jobsSync", { op: "upsert", jobs, texts: [itw.text] });
  assert.deepEqual(r1, { written: 3, unchanged: 0, removed: 0, expired: 1 });
  const stored = await list("jobs");
  assert.deepEqual(stored.map((j) => j.id).sort(), ["gb-1", "gb-2", "itw-900"], "지난 공고(gb-3)는 넣지 않는다");
  assert.equal(stored.find((j) => j.id === "itw-900").dueDate, "2099-01-02");
  assert.equal((await list("jobTexts")).find((t) => t.id === "itw-900").text, "공고 본문");

  const r2 = await call("jobsSync", { op: "upsert", jobs, texts: [itw.text] });
  assert.equal(r2.written, 0, "다시 넣어도 바뀐 게 없으면 쓰지 않는다");
  assert.equal(r2.unchanged, 3);

  const r3 = await call("jobsSync", { op: "prune", sources: ["groupby"], keepIds: ["gb-1", "itw-900"] });
  assert.equal(r3.removed, 1);
  assert.deepEqual((await list("jobs")).map((j) => j.id).sort(), ["gb-1", "itw-900"]);

  await assert.rejects(call("jobsSync", { op: "upsert", jobs: [{ ...gb(4), dueDate: "2026-12-01" }] }), /dueDate/);
  await assert.rejects(setDoc(doc(db, "users", uid, "jobs", "hack"), { title: "직접 쓰기" }), /permission/i);
});

test("Drive 열쇠 — 익명은 서버 보관을 못 쓰고, 보관 자리(driveLinks)는 앱이 읽지 못한다", async () => {
  assert.deepEqual(await call("driveStatus", {}), { linked: false });
  await assert.rejects(call("driveToken", {}), /Google 로 로그인|permission-denied/);
  await assert.rejects(call("driveLink", { code: "x" }), /Google 로 로그인|permission-denied/);
  await assert.rejects(getDocs(collection(db, "driveLinks")), /permission/i);
});

test("보안 규칙 — 앱은 자기 데이터를 읽기만, 남의 데이터는 못 읽는다", async () => {
  await assert.rejects(setDoc(doc(db, "users", uid, "tasks", "hack"), { title: "직접 쓰기" }), /permission/i);
  const mine = uid;
  await signOut(auth);
  await signInAnonymously(auth);
  noteUid(auth.currentUser.uid);
  assert.notEqual(auth.currentUser.uid, mine);
  await assert.rejects(getDocs(collection(db, "users", mine, "tasks")), /permission/i);
});

/**
 * MCP 열쇠 — 에뮬레이터에서만(관리자 권한으로 driveLinks 를 흉내 내야 한다). 원칙: docs/architecture.md 원칙 4 표.
 * 진짜 Google 갱신(refreshAccess)은 driveTokens.test.ts 가 맡고, 여기서는 열쇠 확인 · 거두기 · 권한 경계를 본다.
 */
test("MCP 열쇠 — Google 사용자만, Drive 를 이었을 때만 만들고, 열쇠는 한 번만 · 서버엔 해시만, 거두면 바로 막힌다", { skip: CLOUD }, async () => {
  // 익명은 만들 수 없다
  await assert.rejects(call("mcpKeyCreate", { label: "익명" }), /Google 로 로그인|permission-denied/);
  assert.deepEqual(await call("mcpKeyList", {}), { keys: [] });

  const gApp = initializeApp(CONFIG, "google");
  const gAuth = getAuth(gApp);
  connectAuthEmulator(gAuth, `http://${AUTH_HOST}`, { disableWarnings: true });
  const gFns = getFunctions(gApp, "asia-northeast3");
  connectFunctionsEmulator(gFns, "127.0.0.1", FN_PORT);
  const gDb = getFirestore(gApp);
  connectFirestoreEmulator(gDb, FS_HOST, Number(FS_PORT));
  const cred = await signInWithCredential(gAuth, GoogleAuthProvider.credential(JSON.stringify({ sub: "mcp-google-1", email: "mcp@example.com", email_verified: true })));
  const gUid = cred.user.uid;
  const gCall = (name, data) => httpsCallable(gFns, name)({ ...data, timeZone: TZ }).then((r) => r.data);

  // 관리자 권한(에뮬레이터 owner)으로 driveLinks 를 흉내 낸다 — 앱은 이 자리를 읽지도 쓰지도 못한다
  const linkUrl = `http://${FS_HOST}:${FS_PORT}/v1/projects/llmwiki-minsu/databases/(default)/documents/driveLinks/${gUid}`;
  const admin = (method, body) => fetch(linkUrl, { method, headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });

  await assert.rejects(gCall("mcpKeyCreate", { label: "맥북" }), /먼저 Drive 를 서버에 이어|failed-precondition/);
  assert.equal((await admin("PATCH", { fields: { email: { stringValue: "mcp@example.com" } } })).ok, true);

  const made = await gCall("mcpKeyCreate", { label: "  내   맥북 " });
  assert.match(made.key, /^lwk_[0-9a-z]{12}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(made.label, "내 맥북");
  const listed = await gCall("mcpKeyList", {});
  assert.deepEqual(listed.keys.map((k) => [k.id, k.label, k.lastUsedAt]), [[made.id, "내 맥북", null]]);
  assert.equal(JSON.stringify(listed).includes(made.key.split(".")[1]), false, "목록에 열쇠가 없다");
  await assert.rejects(getDocs(collection(gDb, "mcpKeys")), /permission/i);

  const tokenUrl = `http://127.0.0.1:${FN_PORT}/llmwiki-minsu/asia-northeast3/mcpDriveToken`;
  const ask = (key, method = "POST") => fetch(tokenUrl, { method, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) });

  assert.equal((await ask(null)).status, 401);
  assert.equal((await ask(made.key.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).status, 401, "secret 이 하나만 달라도 막힌다");
  assert.equal((await ask(made.key, "GET")).status, 405);
  // 열쇠는 맞지만 서버에 Drive 열쇠가 없으면 — 열쇠를 확인한 뒤에야 나오는 답
  assert.equal((await admin("DELETE")).ok, true);
  const notLinked = await ask(made.key);
  assert.equal(notLinked.status, 404);
  assert.equal((await notLinked.json()).error.code, "not_linked");
  assert.equal(notLinked.headers.get("cache-control"), "no-store");

  // 남의 열쇠는 거두지 못한다(있어도 없는 것처럼)
  assert.deepEqual(await call("mcpKeyRevoke", { id: made.id }), { ok: true, revoked: false });
  assert.deepEqual(await gCall("mcpKeyRevoke", { id: made.id }), { ok: true, revoked: true });
  assert.equal((await ask(made.key)).status, 401, "거두면 바로 막힌다");
  assert.deepEqual((await gCall("mcpKeyList", {})).keys, []);

  // 다섯 개까지
  await admin("PATCH", { fields: { email: { stringValue: "mcp@example.com" } } });
  for (let i = 0; i < 5; i++) await gCall("mcpKeyCreate", { label: `k${i}` });
  await assert.rejects(gCall("mcpKeyCreate", { label: "k5" }), /5개까지|resource-exhausted/);
  await admin("DELETE");
  await terminate(gDb);
  await deleteApp(gApp);
});
