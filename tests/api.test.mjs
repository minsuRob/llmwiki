/**
 * API 통합 테스트 — Firebase 에뮬레이터(Auth · Firestore · Functions)에 대고 기능별로 끝까지 돌린다.
 * 실행: npm run test:api  (functions 를 번들하고 emulators:exec 로 이 파일을 돌린다)
 * 키(ANTHROPIC_API_KEY) 없이 돈다 — 서버는 packages/core 의 한국어 규칙 길로 답한다.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { deleteApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously, signOut } from "firebase/auth";
import { collection, connectFirestoreEmulator, doc, getDocs, getFirestore, orderBy, query, setDoc, terminate } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

import { readFileSync, appendFileSync } from "node:fs";

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
if (!CLOUD) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(fns, "127.0.0.1", 5001);
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
    connectAuthEmulator(other, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFunctionsEmulator(fns2, "127.0.0.1", 5001);
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

test("보안 규칙 — 앱은 자기 데이터를 읽기만, 남의 데이터는 못 읽는다", async () => {
  await assert.rejects(setDoc(doc(db, "users", uid, "tasks", "hack"), { title: "직접 쓰기" }), /permission/i);
  const mine = uid;
  await signOut(auth);
  await signInAnonymously(auth);
  noteUid(auth.currentUser.uid);
  assert.notEqual(auth.currentUser.uid, mine);
  await assert.rejects(getDocs(collection(db, "users", mine, "tasks")), /permission/i);
});
