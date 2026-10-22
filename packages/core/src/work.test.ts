/**
 * 작업실 저장 — 검증 시나리오(데이터 유실 · 중복 · 충돌 · 오프라인 중심). 페이지 모델 자체는 pages.test.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { DriveFileStore, getMeta, readPlan, readText, type Fetch } from "./drive.ts";
import { createPage, editBody, trashPage, type PageDoc, type PageMeta } from "./pages.ts";
import type { Scrap } from "./types.ts";
import { addWorkspace, canRemoveWorkspace, defaultManifest, editWorkspace, removeWorkspace, upgradeManifest, type Source } from "./work.ts";
import { planRevert, planScrapMigration } from "./workMigrate.ts";
import { KvFileStore, MemoryFileStore, PATHS, WorkRepo, type KV } from "./workStore.ts";
import { upgradeItem } from "./workV2.ts";

const NOW = "2026-10-19T09:00:00.000Z";
const LATER = "2026-10-20T09:00:00.000Z";

const manifest = () => defaultManifest({ personal: "개인", company: "회사", dev: "개발", reading: "독서" });

function report(): { meta: PageMeta; doc: PageDoc; pages: PageMeta[] } {
  const r = createPage([], { workspaceId: "ws-company", title: "10월 실적 보고", body: "# 10월\n- [ ] 자료 모으기\n- [ ] 초안 쓰기" }, NOW);
  if (r.kind !== "ok") throw new Error();
  return { meta: r.page, doc: r.doc, pages: r.pages };
}

const memKv = (): KV => {
  const mem = new Map<string, string>();
  return { getItem: async (k) => mem.get(k) ?? null, setItem: async (k, v) => void mem.set(k, v), removeItem: async (k) => void mem.delete(k), getAllKeys: async () => [...mem.keys()] };
};

test("앱을 다시 열어도(새 저장소 객체) 페이지 · 본문이 남는다 — 기기 저장소(KV), 사용자 공간은 나뉜다", async () => {
  const kv = memKv();
  const repo1 = new WorkRepo(new KvFileStore(kv, "u1"), manifest());
  await repo1.load();
  const { meta, doc, pages } = report();
  const saved = await repo1.savePageDoc(doc, NOW);
  assert.equal(saved.status, "saved");
  assert.equal(saved.status === "saved" && saved.value.rev, 1);
  assert.equal((await repo1.saveIndexWith("ws-company", [], () => pages, NOW)).status, "saved");

  const repo2 = new WorkRepo(new KvFileStore(kv, "u1"), manifest());
  const state = await repo2.load();
  assert.deepEqual(state.pages.map((p) => p.title), ["10월 실적 보고"]);
  assert.equal(await repo2.readBody(state.pages[0]), doc.body);
  assert.equal(state.pages[0].id, meta.id);
  // 다른 사용자 공간은 비어 있다
  assert.equal((await new WorkRepo(new KvFileStore(kv, "u2"), manifest()).load()).pages.length, 0);
});

test("저장이 실패하면 저장된 것으로 치지 않는다(rev 도 그대로)", async () => {
  const store = new MemoryFileStore();
  const repo = new WorkRepo(store, manifest());
  const { doc } = report();
  store.failWrites = 1;
  const r = await repo.savePageDoc(doc, NOW);
  assert.equal(r.status, "failed");
  assert.equal(store.files.size, 0);
  const again = await repo.savePageDoc(doc, NOW);
  assert.equal(again.status, "saved");
  assert.equal(again.status === "saved" && again.value.rev, 1);
});

test("바깥에서 바뀐 문서와 충돌하면 덮어쓰지 않고 내 쪽을 사본으로 남긴다 → 골라서 정리", async () => {
  const store = new MemoryFileStore();
  const repo = new WorkRepo(store, manifest());
  let { doc } = report();
  const s1 = await repo.savePageDoc(doc, NOW);
  if (s1.status === "saved") doc = s1.value;
  // 다른 기기가 고쳤다
  store.externalWrite(PATHS.page(doc.id), JSON.stringify({ ...doc, body: "팀장이 고침", rev: 2 }));
  const r = await repo.savePageDoc(editBody(doc, "내가 고침", LATER), LATER);
  assert.equal(r.status, "conflict");
  if (r.status !== "conflict") return;
  assert.equal(r.remote?.body, "팀장이 고침");
  assert.equal(JSON.parse(store.files.get(PATHS.page(doc.id))!.text).body, "팀장이 고침", "바깥 변경이 그대로 있다");
  const copies = await repo.listConflicts();
  assert.equal(copies.length, 1);
  assert.equal(JSON.parse(copies[0].mine).body, "내가 고침", "내 쪽은 사본에 있다");
  // 사람이 내 쪽을 고른다
  assert.equal((await repo.resolveConflict(copies[0], "mine", LATER)).status, "saved");
  const after = JSON.parse(store.files.get(PATHS.page(doc.id))!.text);
  assert.equal(after.body, "내가 고침");
  assert.equal(after.rev, 3);
  assert.equal((await repo.listConflicts())[0].resolved, true, "사본은 지우지 않고 정리됨으로");
});

test("원문은 해시 이름으로 한 번만 저장된다(재시도해도 하나)", async () => {
  const store = new MemoryFileStore();
  const repo = new WorkRepo(store, manifest());
  assert.deepEqual(await repo.saveRaw("abc", "원문"), { ok: true });
  assert.deepEqual(await repo.saveRaw("abc", "원문"), { ok: true });
  assert.equal((await store.list("raw/")).length, 1);
  assert.equal(await repo.readRaw("abc"), "원문");
});

test("옛 업무(스키마 2) 파일도 빠진 칸을 채워 읽고, 영역만 지운다(나머지는 보존) · 이행할 것만 골라 읽는다", async () => {
  const old = { id: "x", title: "옛 업무", workspaceId: "ws-personal", areaId: "area-dev", goal: "g", status: "active", createdAt: NOW, updatedAt: NOW, extra: "보존" };
  const up = upgradeItem(old) as unknown as Record<string, unknown>;
  assert.equal(up.schemaVersion, 2);
  assert.deepEqual(up.actions, []);
  assert.equal(up.extra, "보존");
  assert.equal("areaId" in up, false, "영역은 어디로도 옮기지 않고 지운다");
  const store = new MemoryFileStore();
  store.externalWrite(PATHS.item("x"), JSON.stringify(old));
  store.externalWrite(PATHS.item("y"), "{깨진 파일");
  const repo = new WorkRepo(store, manifest());
  assert.deepEqual(await repo.listItemIds(), ["x", "y"]);
  assert.deepEqual((await repo.readItems(["x", "y"])).map((i) => i.title), ["옛 업무"], "깨진 파일은 건너뛴다(지우지 않는다)");
  assert.equal((await repo.load()).hasIndex, false);
});

test("기존 기록 이행 — 복사만 하고(원본 그대로), 두 번 옮기지 않고, 되돌릴 수 있다", () => {
  const scraps: Scrap[] = [
    { id: "s1", text: "회의 메모\n내용", label: "메모", createdAt: NOW },
    { id: "s2", text: "지운 것", label: "메모", createdAt: NOW, deletedAt: NOW },
  ];
  const state = { manifest: manifest(), pages: [] as PageMeta[], sources: [] as Source[] };
  const plan = planScrapMigration(state, scraps, "ws-personal", NOW);
  assert.equal(plan.sources.length, 1);
  assert.equal(plan.sources[0].migratedFrom?.id, "s1");
  assert.equal(plan.sources[0].title, "회의 메모");
  assert.equal(scraps.length, 2, "원본 배열은 그대로");
  const after = { ...state, sources: plan.sources, manifest: { ...state.manifest, migrations: [plan.record!] } };
  assert.equal(planScrapMigration(after, scraps, "ws-personal", LATER).sources.length, 0, "두 번 옮기지 않는다");
  const page = { ...createPage([], { workspaceId: "ws-personal", title: "회의" }, NOW), sourceIds: [] };
  const pages = page.kind === "ok" ? page.pages.map((p) => ({ ...p, sourceIds: [plan.sources[0].id] })) : [];
  const rev = planRevert({ manifest: after.manifest, pages }, plan.record!.id);
  assert.deepEqual(rev.removeSourceIds, [plan.sources[0].id]);
  assert.deepEqual(rev.pageIds, pages.map((p) => p.id), "이어 둔 페이지에서 풀어야 한다");
});

/* ───────────────────────── Drive(가짜 서버) ───────────────────────── */

function fakeDrive() {
  const files = new Map<string, { id: string; name: string; mimeType: string; version: number; trashed: boolean; appProperties: Record<string, string>; body: string; parents: string[] }>();
  let n = 0;
  let expired = false;
  const res = (status: number, body: unknown) => ({ ok: status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)), json: async () => body });
  const fetch: Fetch = async (url, init = {}) => {
    if (expired) return res(401, { error: "expired" });
    assert.ok(init.headers?.Authorization?.startsWith("Bearer "), "토큰을 헤더로만 보낸다");
    assert.ok(!url.includes("access_token"), "토큰을 주소에 넣지 않는다");
    const u = new URL(url);
    const method = init.method ?? "GET";
    const idm = /\/files\/([^/?]+)/.exec(u.pathname);
    if (method === "GET" && !idm) {
      const query = u.searchParams.get("q") ?? "";
      const prop = /key='(\w+)' and value='([^']*)'/.exec(query);
      const parent = /'([^']+)' in parents/.exec(query);
      const list = [...files.values()].filter((f) => !f.trashed && (!prop || f.appProperties[prop[1]] === prop[2]) && (!parent || f.parents.includes(parent[1])));
      return res(200, { files: list.map((f) => ({ id: f.id, version: String(f.version), appProperties: f.appProperties, name: f.name, mimeType: f.mimeType })) });
    }
    if (method === "GET" && idm) {
      const f = files.get(idm[1]);
      if (!f) return res(404, {});
      if (u.searchParams.get("alt") === "media") return res(200, f.body);
      if (u.pathname.endsWith("/export")) return res(200, `exported:${u.searchParams.get("mimeType")}`);
      return res(200, { id: f.id, name: f.name, mimeType: f.mimeType, version: String(f.version), trashed: f.trashed, modifiedTime: NOW });
    }
    if (method === "POST" && u.pathname.startsWith("/upload")) {
      const body = init.body ?? "";
      const meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n--/s.exec(body)![1]);
      const content = /\r\n\r\n([\s\S]*?)\r\n--[^\r\n]*--$/.exec(body.slice(body.indexOf(JSON.stringify(meta)) + JSON.stringify(meta).length))![1];
      const id = `f${++n}`;
      files.set(id, { id, name: meta.name, mimeType: meta.mimeType, version: 1, trashed: false, appProperties: meta.appProperties, body: content, parents: meta.parents });
      return res(200, { id, version: "1" });
    }
    if (method === "POST") {
      const meta = JSON.parse(init.body ?? "{}");
      const id = `d${++n}`;
      files.set(id, { id, name: meta.name, mimeType: meta.mimeType, version: 1, trashed: false, appProperties: meta.appProperties ?? {}, body: "", parents: meta.parents ?? [] });
      return res(200, { id });
    }
    if (method === "PATCH" && idm) {
      const f = files.get(idm[1])!;
      if (u.pathname.startsWith("/upload")) f.body = init.body ?? "";
      else Object.assign(f, JSON.parse(init.body ?? "{}"));
      f.version++;
      return res(200, { id: f.id, version: String(f.version) });
    }
    return res(400, {});
  };
  return { fetch, files, expire: () => (expired = true) };
}

test("Drive 저장소 — 폴더를 만들고, 파일 id 로 읽고 쓰고, 바깥 변경은 충돌로, 토큰 만료는 실패로", async () => {
  const d = fakeDrive();
  const store = new DriveFileStore({ fetch: d.fetch, token: () => "test-token" }, { root: "llmwiki 작업실", summaries: "업무 요약", appData: "앱 데이터" });
  const repo = new WorkRepo(store, manifest());
  await repo.load();
  let { doc } = report();
  const s = await repo.savePageDoc(doc, NOW);
  assert.equal(s.status, "saved");
  if (s.status === "saved") doc = s.value;
  const names = [...d.files.values()].map((f) => f.name).sort();
  assert.ok(names.includes("llmwiki 작업실") && names.includes("앱 데이터"));
  // 사람이 Drive 에서 파일 이름을 바꿔도 찾는다
  const docFile = [...d.files.values()].find((f) => f.appProperties.llmwikiPath === PATHS.page(doc.id))!;
  docFile.name = "이름 바뀜.json";
  assert.equal(JSON.parse((await store.read(PATHS.page(doc.id)))!.text).body, doc.body);
  // 바깥 변경 → 충돌
  docFile.version += 1;
  const c = await repo.savePageDoc(editBody(doc, "새 본문", LATER), LATER);
  assert.equal(c.status, "conflict");
  // 토큰 만료 → 저장 실패(저장됨으로 표시하지 않는다)
  d.expire();
  const f = await repo.savePageDoc(doc, LATER);
  assert.equal(f.status, "failed");
  assert.equal(f.status === "failed" && f.code, "auth_expired");
});

test("Drive 원본 — Docs 는 export, PDF 는 링크만, 지워진 파일은 deleted · 없는 파일은 lost", async () => {
  const d = fakeDrive();
  const deps = { fetch: d.fetch, token: () => "t" };
  d.files.set("doc1", { id: "doc1", name: "회의록", mimeType: "application/vnd.google-apps.document", version: 3, trashed: false, appProperties: {}, body: "", parents: [] });
  d.files.set("pdf1", { id: "pdf1", name: "계약서.pdf", mimeType: "application/pdf", version: 1, trashed: false, appProperties: {}, body: "", parents: [] });
  d.files.set("old", { id: "old", name: "옛", mimeType: "text/plain", version: 1, trashed: true, appProperties: {}, body: "", parents: [] });
  const m = await getMeta(deps, "doc1");
  assert.ok(m.ok);
  if (m.ok) assert.deepEqual(await readText(deps, m.meta), { ok: true, text: "exported:text/plain" });
  const p = await getMeta(deps, "pdf1");
  if (p.ok) assert.deepEqual(await readText(deps, p.meta), { ok: false, status: "unsupported" });
  assert.deepEqual(await getMeta(deps, "old"), { ok: false, status: "deleted" });
  assert.deepEqual(await getMeta(deps, "nope"), { ok: false, status: "lost" });
  assert.deepEqual(readPlan("application/vnd.google-apps.spreadsheet"), { how: "export", as: "text/csv" });
  assert.deepEqual(await getMeta({ fetch: d.fetch, token: () => null }, "doc1"), { ok: false, status: "auth_expired", error: "auth_expired" });
});

test("Drive + 기기 사본 — 연결이 끊기면 사본에서 읽고, 쓰기는 실패로 알린다 · 기기 데이터를 Drive 로 복사(기기 쪽 보존) · 큰 묶음은 사본을 두지 않는다", async () => {
  const { MirroredStore, copyStore } = await import("./workStore.ts");
  const kv = memKv();
  const device = new KvFileStore(kv, "u1/device");
  const devRepo = new WorkRepo(device, manifest());
  const { doc, pages } = report();
  await devRepo.savePageDoc(doc, NOW);
  await devRepo.saveIndexWith("ws-company", [], () => pages, NOW);
  const remote = new MemoryFileStore();
  let online = true;
  const mirror = new KvFileStore(kv, "u1/mirror");
  const mirrored = new MirroredStore(remote, mirror, () => online);
  assert.deepEqual(await copyStore(device, mirrored), { copied: 2, skipped: 0 });
  assert.equal((await device.list("state/")).length, 2, "기기 쪽은 그대로");
  assert.deepEqual(await copyStore(device, mirrored), { copied: 0, skipped: 2 }, "두 번 복사하지 않는다");
  const repo = new WorkRepo(mirrored, manifest());
  const st = await repo.load();
  const d0 = await repo.readDoc(st.pages[0]);
  online = false;
  const offline = new WorkRepo(mirrored, manifest());
  const off = await offline.load();
  assert.equal(off.pages[0].title, "10월 실적 보고", "끊겨도 사본으로 읽는다");
  assert.equal(await offline.readBody(off.pages[0]), doc.body);
  const w = await repo.savePageDoc(editBody(d0!, "끊긴 동안", LATER), LATER);
  assert.equal(w.status, "failed");
  online = true;
  assert.equal((await repo.savePageDoc(editBody(d0!, "다시 이어짐", LATER), LATER)).status, "saved");
  await mirrored.write("state/packs/p1.json", "{}", null);
  assert.equal(await mirror.read("state/packs/p1.json"), null, "가져오기 묶음은 기기 사본에 두지 않는다(웹 저장 공간)");
});

test("주제 — 옛 개인 · 회사 작업실을 아이콘 · 비공개로 옮기고, 더하고 · 고치고 · 빈 것만 지운다", () => {
  const old = { schemaVersion: 1, workspaces: [{ id: "ws-personal", kind: "personal", name: "개인", areas: [] }, { id: "ws-company", kind: "company", name: "회사", areas: [] }] };
  const m = upgradeManifest(old, defaultManifest({ personal: "", company: "", dev: "", reading: "" }));
  assert.deepEqual(m.workspaces.map((w) => [w.icon, w.private]), [["person", false], ["business", true]]);

  assert.equal(m.workspaces.some((w) => "areas" in w), false, "영역 목록은 지운다");
  assert.deepEqual(m.triage, []);
  assert.equal(m.workspaces.length, 2, "기존 사용자에게 개발 · 독서를 억지로 더하지 않는다");

  const { manifest: added, workspace } = addWorkspace(m, { name: " 독서 ", icon: "book", private: false });
  assert.equal(workspace.name, "독서");
  assert.equal("areas" in workspace, false);
  assert.equal(added.workspaces.length, 3);
  assert.equal(editWorkspace(added, workspace.id, { name: "책", private: true }).workspaces[2].private, true);

  const page = createPage([], { workspaceId: workspace.id, title: "책 1" }, NOW);
  if (page.kind !== "ok") return assert.fail();
  const state = { manifest: added, pages: trashPage(page.pages, page.page.id, "with_children", NOW).pages, sources: [] };
  assert.equal(canRemoveWorkspace(state, workspace.id), "in_use", "페이지가 남은 주제는(휴지통 포함) 지우지 않는다");
  assert.equal(canRemoveWorkspace({ ...state, pages: [] }, workspace.id), "ok");
  assert.equal(removeWorkspace(added, workspace.id).workspaces.length, 2);
  assert.equal(canRemoveWorkspace({ manifest: { ...m, workspaces: [m.workspaces[0]] }, pages: [], sources: [] }, "ws-personal"), "last");
});
