// llmwiki MCP — 로컬 Drive(임시 폴더)에 붙여 stdio 로 실제 호출해 본다.
// 실행: node --test tools/llmwiki-mcp/server.test.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { DriveFileStore } from "../../packages/core/src/drive.ts";
import { acceptBodyProposal, createPage, editBody, openBodyProposals, syncMeta } from "../../packages/core/src/pages.ts";
import { addWorkspace, createWorkItem, defaultManifest } from "../../packages/core/src/work.ts";
import { WorkRepo } from "../../packages/core/src/workStore.ts";
import { startLocalDrive } from "../local-drive/server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN = "t-mcp";
let dir;
let drive;
let repo;
let proc;
let nextId = 1;
const waiting = new Map();

function rpc(method, params = {}) {
  const id = nextId++;
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve) => waiting.set(id, resolve));
}
const tool = async (name, args = {}) => {
  const r = await rpc("tools/call", { name, arguments: args });
  return { text: r.result.content[0].text, error: r.result.isError };
};

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "llmwiki-mcp-"));
  drive = await startLocalDrive({ dir, port: 0, token: TOKEN });
  // 앱이 처음 연 것처럼 — 범주 넷 + 비공개 회사, 업무 하나
  const store = new DriveFileStore({ fetch: globalThis.fetch, token: () => TOKEN, origin: drive.url }, { root: "llmwiki 작업실", summaries: "업무 요약", appData: "앱 데이터" });
  repo = new WorkRepo(store, defaultManifest({ personal: "개인", company: "회사", dev: "개발", reading: "독서" }));
  const st = await repo.load();
  await repo.saveManifest(st.manifest, new Date().toISOString());
  await repo.saveItem(createWorkItem({ workspaceId: "ws-personal", title: "그룹바이 지원 후보 정리", goal: "지원할 곳 고르기" }, new Date().toISOString()), new Date().toISOString());

  proc = spawn(process.execPath, [join(HERE, "server.mjs"), "--local-drive", drive.url, "--token", TOKEN], { stdio: ["pipe", "pipe", "pipe"] });
  let buf = "";
  proc.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    }
  });
});

after(async () => {
  proc?.kill();
  await drive?.close();
  rmSync(dir, { recursive: true, force: true });
});

test("도구 — 쓰기는 남기기 · 제안뿐이고 확정 · 삭제 · 이동 · 범주 만들기는 없다", async () => {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18" });
  assert.equal(init.result.serverInfo.name, "llmwiki");
  const list = await rpc("tools/list");
  const names = list.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["llmwiki_capture", "llmwiki_inbox", "llmwiki_pages", "llmwiki_propose", "llmwiki_propose_page", "llmwiki_read", "llmwiki_work", "llmwiki_workspaces"]);
  assert.ok(!names.some((n) => /apply|accept|delete|move|trash/.test(n)), "적용 · 삭제 · 이동 도구는 없다");
});

test("남기기 → 정리 묶음 → 제안 → 앱 저장소에 정리 대기 조각과 열린 제안이 생긴다", async () => {
  const ws = await tool("llmwiki_workspaces");
  assert.match(ws.text, /회사 \(id: ws-company\) · 비공개/);

  const cap = await tool("llmwiki_capture", { workspace: "개인", text: "피트인 채용 담당자는 김서연.\n1차 면접은 화상.", tool: "claude" });
  assert.equal(cap.error, false);
  assert.match(cap.text, /"개인" 받은 것에 남겼어요/);
  const link = await tool("llmwiki_capture", { workspace: "ws-personal", text: "https://example.com/job/13276" });
  assert.equal(link.error, false);
  assert.match((await tool("llmwiki_capture", { workspace: "개인", text: "https://example.com/job/13276" })).text, /이미/);
  assert.equal((await tool("llmwiki_capture", { workspace: "없는 범주", text: "x" })).error, true, "범주는 만들지 않는다");

  let st = await repo.load();
  const frag = st.sources.find((s) => s.text?.startsWith("피트인"));
  assert.equal(frag?.triage, "inbox");
  assert.deepEqual(frag?.origin, { via: "mcp", tool: "claude" });

  // 색인이 아직 없다(앱이 이행 전) — 옛 업무 파일을 메모리에서만 페이지로 보인다(옛 이름 llmwiki_work 도 된다)
  const work = await tool("llmwiki_work", { workspace: "개인" });
  assert.match(work.text, /그룹바이 지원 후보 정리/);
  const itemId = /id: ([^)]+)\)/.exec(work.text)[1];
  assert.match((await tool("llmwiki_read", { item: itemId })).text, /## 목표\n\n지원할 곳 고르기/);
  assert.equal((await repo.store.list("state/index/")).length, 0, "MCP 는 이행하지 않는다(쓰지 않는다)");

  const inbox = await tool("llmwiki_inbox", { workspace: "개인", tool: "claude" });
  assert.match(inbox.text, /S1:2\| 1차 면접은 화상\./);
  assert.match(inbox.text, /\[P1\] 그룹바이 지원 후보 정리/);
  const run = /"run": "([^"]+)"/.exec(inbox.text)[1];

  const prop = await tool("llmwiki_propose", {
    run,
    tool: "claude",
    triage: [
      { kind: "file_source", sources: ["S1"], page: "P1", note: "지원 진행 정보", refs: ["S1:1"] },
      { kind: "concept_link", sources: ["S1"], concept: "피트인", refs: ["S1:1"] },
      { kind: "file_source", sources: ["S9"], page: "P1", refs: [] },
    ],
  });
  assert.equal(prop.error, false);
  assert.match(prop.text, /정리 제안 2개/);
  assert.match(prop.text, /#3 없는 조각/);
  assert.equal((await tool("llmwiki_propose", { run, triage: [{ kind: "file_source", sources: ["S1"], page: "P1", note: "지원 진행 정보", refs: ["S1:1"] }, { kind: "concept_link", sources: ["S1"], concept: "피트인", refs: ["S1:1"] }, { kind: "file_source", sources: ["S9"], page: "P1", refs: [] }], tool: "claude" })).text, "이미 낸 제안이에요.");

  st = await repo.load();
  const open = st.manifest.triage.filter((p) => p.status === "open");
  assert.equal(open.length, 2);
  assert.ok(open.every((p) => p.workspaceId === "ws-personal" && p.tool === "claude" && p.sourceIds[0] === frag.id));
  assert.equal(open.find((p) => p.kind === "file_source")?.itemId, itemId, "P1 은 옛 업무 id 그대로(이행이 id 를 지킨다)");
  assert.equal(st.items[0].sourceIds.length, 0, "제안만 — 업무는 아직 그대로");
  assert.equal(st.sources.find((s) => s.id === frag.id)?.triage, "inbox", "조각도 아직 정리 대기");
});

test("비공개 범주는 남기기만 되고 읽기 · 묶기는 막힌다", async () => {
  assert.equal((await tool("llmwiki_capture", { workspace: "회사", text: "회사 메모" })).error, false);
  for (const [name, args] of [
    ["llmwiki_work", { workspace: "회사" }],
    ["llmwiki_inbox", { workspace: "회사" }],
  ]) {
    const r = await tool(name, args);
    assert.equal(r.error, true);
    assert.match(r.text, /비공개 범주/);
  }
  const st = await repo.load();
  const item = createWorkItem({ workspaceId: "ws-company", title: "실적 보고" }, new Date().toISOString());
  await repo.saveItem(item, new Date().toISOString());
  assert.match((await tool("llmwiki_read", { item: item.id })).text, /비공개 범주/);
  assert.ok(st.manifest.workspaces.find((w) => w.id === "ws-company")?.private);
});

test("색인이 생기면(앱이 이행 · 새 페이지) 색인만 읽고, 본문은 읽을 때만 — 트리 · 아래만 · 깊이", async () => {
  const now = new Date().toISOString();
  const top = createPage([], { workspaceId: "ws-personal", title: "취준", body: "# 종합\n- 피트인 1순위" }, now);
  const kid = createPage(top.pages, { workspaceId: "ws-personal", parentId: top.page.id, title: "피트인 — AI 엔지니어", body: "## 주요 업무\n\nLLM" }, now);
  await repo.savePageDoc(top.doc, now);
  await repo.savePageDoc(kid.doc, now);
  assert.equal((await repo.saveIndexWith("ws-personal", [], () => kid.pages, now)).status, "saved");
  const tree = await tool("llmwiki_pages", { workspace: "개인" });
  assert.match(tree.text, /- 취준 \(id: [^)]+\) · 본문 \d+자 · 하위 1\n  - 피트인 — AI 엔지니어/);
  assert.doesNotMatch(tree.text, /그룹바이/, "색인이 있으면 옛 업무 파일은 보지 않는다");
  assert.doesNotMatch((await tool("llmwiki_pages", { workspace: "개인", depth: 1 })).text, /피트인/);
  assert.match((await tool("llmwiki_pages", { workspace: "개인", under: top.page.id })).text, /^- 피트인/);
  const read = await tool("llmwiki_read", { page: top.page.id });
  assert.match(read.text, /# 종합\n- 피트인 1순위/);
  assert.match(read.text, /## 하위 페이지 1개\n- \[P2\] 피트인 — AI 엔지니어/);
  assert.equal((await tool("llmwiki_read", { page: "없는-페이지" })).error, true);
});

test("하위 다이제스트 · 전문(cursor) → 본문 제안 → 앱에서 받기: 새것은 바로, 그사이 사람이 고친 것은 낡음(stale)", async () => {
  const now = new Date().toISOString();
  const st0 = await repo.loadPages();
  const top = createPage(st0.pages, { workspaceId: "ws-personal", title: "공고 모음", body: "# 공고 종합\n- 아직 없음" }, now);
  let pages = top.pages;
  const ids = [];
  for (let i = 0; i < 60; i++) {
    const k = createPage(pages, { workspaceId: "ws-personal", parentId: top.page.id, title: `회사${i} — 백엔드`, body: `## 주요 업무\n\n${"업무 ".repeat(400)}${i}` }, now);
    pages = k.pages;
    ids.push(k.page.id);
    await repo.savePageDoc(k.doc, now);
  }
  await repo.savePageDoc(top.doc, now);
  assert.equal((await repo.saveIndexWith("ws-personal", st0.pages, () => pages, now)).status, "saved");

  const digest = await tool("llmwiki_read", { page: top.page.id, children: "digest" });
  assert.match(digest.text, /## 하위 페이지 60개 — 다이제스트\n- \[P2\] 회사0 — 백엔드 \(\d+자\)/);
  const base = /본문 지문: (\w+)/.exec(digest.text)[1];
  const full1 = await tool("llmwiki_read", { page: top.page.id, children: "full" });
  const next = Number(/다음 cursor: (\d+)/.exec(full1.text)?.[1]);
  assert.ok(next > 10 && next < 60, `다음 cursor ${next}`);
  const full2 = await tool("llmwiki_read", { page: top.page.id, children: "full", cursor: next });
  assert.doesNotMatch(full2.text, /## \[P1\] 본문/, "이어 읽을 때는 본문을 다시 싣지 않는다");
  assert.match(full2.text, new RegExp(`### \\[P${next + 2}\\]`));

  // 제안 둘 — 하나는 그대로 받고, 하나는 그사이 사람이 고쳐 낡는다
  const p1 = await tool("llmwiki_propose_page", { page: top.page.id, body: "# 공고 종합\n- 회사0 1순위", note: "마감 순", refs: ["P2"], base, tool: "claude" });
  assert.equal(p1.error, false, p1.text);
  assert.match(p1.text, /아직 적용 아님/);
  assert.equal((await tool("llmwiki_propose_page", { page: top.page.id, body: "# 공고 종합\n- 회사0 1순위", base })).text, "이미 낸 같은 제안이에요.");
  assert.equal((await tool("llmwiki_propose_page", { page: "없는", body: "x" })).error, true);
  const kidBase = /본문 지문: (\w+)/.exec((await tool("llmwiki_read", { page: ids[0] })).text)[1];
  assert.equal((await tool("llmwiki_propose_page", { page: ids[0], body: "## 주요 업무\n\nAI 가 줄임", base: kidBase })).error, false);

  // 앱 쪽 — 같은 core 함수로 받는다(문서를 읽고, 원문은 raw/ 에서)
  const app = await repo.loadPages();
  const open = openBodyProposals(app.manifest);
  assert.equal(open.length, 2);
  assert.ok(open.every((p) => p.origin === "ai" && p.status === "open"), "MCP 는 열린 제안만 만든다");
  const forTop = open.find((p) => p.pageId === top.page.id);
  const forKid = open.find((p) => p.pageId === ids[0]);
  const topMeta = app.pages.find((p) => p.id === top.page.id);
  const topDoc = await repo.readDoc(topMeta);
  const a = acceptBodyProposal(app.manifest, topMeta, topDoc, forTop.id, await repo.readRaw(forTop.rawHash), now);
  assert.equal(a.kind, "ok", "새것은 바로 받는다");
  const kidMeta = app.pages.find((p) => p.id === ids[0]);
  const kidDoc = editBody(await repo.readDoc(kidMeta), "## 주요 업무\n\n사람이 먼저 고침", now);
  const stale = acceptBodyProposal(a.manifest, syncMeta(kidMeta, kidDoc, now), kidDoc, forKid.id, await repo.readRaw(forKid.rawHash), now);
  assert.equal(stale.kind, "stale", "그사이 사람이 고쳤으면 낡음");
  assert.equal(acceptBodyProposal(a.manifest, syncMeta(kidMeta, kidDoc, now), kidDoc, forKid.id, await repo.readRaw(forKid.rawHash), now, { force: true }).kind, "ok");
});

test("사용자가 앱에서 새로 만든 범주에도 남길 수 있다(MCP 는 만들지 않는다)", async () => {
  const st = await repo.load();
  const { manifest } = addWorkspace(st.manifest, { name: "운동", icon: "barbell", private: false });
  const saved = await repo.saveManifest(manifest, new Date().toISOString());
  assert.equal(saved.status, "saved");
  const r = await tool("llmwiki_capture", { workspace: "운동", text: "스쿼트 5x5" });
  assert.equal(r.error, false, r.text);
});

/** MCP 열쇠 길 — 가짜 mcpDriveToken 이 열쇠를 확인하고 1시간 토큰을 내주면, MCP 는 그 토큰으로 Drive 에 쓴다 */
function startProc(args, env = {}) {
  const p = spawn(process.execPath, [join(HERE, "server.mjs"), ...args], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, LLMWIKI_MCP_KEY: "", ...env } });
  let buf = "";
  const wait = new Map();
  let n = 0;
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      wait.get(m.id)?.(m);
    }
  });
  const call = (name, a = {}) =>
    new Promise((r) => {
      wait.set(++n, (m) => r({ text: m.result.content[0].text, error: m.result.isError }));
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method: "tools/call", params: { name, arguments: a } }) + "\n");
    });
  return { p, call };
}

test("MCP 열쇠 — 열쇠 파일로 토큰을 받아 쓰고, 열린 권한 · 틀린 열쇠 · 없는 열쇠는 알아듣게 거절한다", async () => {
  const KEY = "lwk_aaaaaaaaaaaa." + "b".repeat(43);
  let issued = 0;
  const tokenSrv = createServer((req, res) => {
    const ok = req.method === "POST" && req.headers.authorization === `Bearer ${KEY}`;
    res.writeHead(ok ? 200 : 401, { "Content-Type": "application/json" });
    if (ok) issued++;
    res.end(JSON.stringify(ok ? { accessToken: TOKEN, expiresAt: Date.now() + 3600_000, email: "a@b.c" } : { error: { code: "bad_key", message: "MCP 열쇠가 틀렸거나 거둬졌어요." } }));
  });
  await new Promise((r) => tokenSrv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${tokenSrv.address().port}/mcpDriveToken`;
  const keyFile = join(dir, "mcp-key");
  const args = ["--drive-origin", drive.url, "--token-url", url, "--key-file", keyFile];
  try {
    const none = startProc(args);
    const r0 = await none.call("llmwiki_workspaces");
    assert.equal(r0.error, true);
    assert.match(r0.text, /MCP 열쇠가 없어요/);
    none.p.kill();

    writeFileSync(keyFile, KEY + "\n");
    chmodSync(keyFile, 0o644);
    const open = startProc(args);
    assert.match((await open.call("llmwiki_workspaces")).text, /chmod 600/);
    open.p.kill();

    chmodSync(keyFile, 0o600);
    const good = startProc(args);
    assert.equal((await good.call("llmwiki_capture", { workspace: "개인", text: "열쇠로 남긴 조각" })).error, false);
    assert.equal((await good.call("llmwiki_workspaces")).error, false);
    assert.equal(issued, 1, "토큰은 만료 전까지 다시 받지 않는다");
    good.p.kill();
    const st = await repo.load();
    assert.ok(st.sources.some((s) => s.text === "열쇠로 남긴 조각" && s.origin?.via === "mcp"));

    const bad = startProc(args, { LLMWIKI_MCP_KEY: "lwk_cccccccccccc." + "d".repeat(43) });
    const rb = await bad.call("llmwiki_workspaces");
    assert.equal(rb.error, true);
    assert.match(rb.text, /틀렸거나 거둬졌어요/);
    bad.p.kill();
  } finally {
    await new Promise((r) => tokenSrv.close(r));
  }
});
