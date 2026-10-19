/**
 * 로컬 Drive(tools/local-drive — 진짜 폴더를 Drive REST 처럼 흉내 내는 개발용 서버)에 앱의 Drive 코드를 그대로 붙여 본다.
 * 실제 Google Drive 검증이 아니다 — 같은 HTTP 호출이 디스크의 진짜 파일로 끝까지 도는지 본다.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { DriveFileStore, getMeta, readText, type DriveDeps, type Fetch } from "./drive.ts";
import { applyRemoteMeta, createWorkItem, defaultManifest, linkSource, newSource, setSummary, setWorkStatus, staleSources, type Source, type WorkItem } from "./work.ts";
import { PATHS, WorkRepo } from "./workStore.ts";

// @ts-expect-error — 순수 JS 개발 도구
import { startLocalDrive } from "../../../tools/local-drive/server.mjs";

const NOW = "2026-10-19T09:00:00.000Z";
const manifest = () => defaultManifest({ personal: "개인", company: "회사", areas: { general: "공통" } });
const names = { root: "llmwiki 작업실", summaries: "업무 요약", appData: "앱 데이터" };

let dir = "";
let server: { url: string; root: string; close: () => Promise<void> };
let deps: DriveDeps;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "local-drive-"));
  server = await startLocalDrive({ dir, port: 0, token: "t-local", seed: true });
  deps = { fetch: globalThis.fetch as unknown as Fetch, token: () => "t-local", origin: server.url };
});
after(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 디스크에서 사람이 고친 것처럼 — 수정 시각을 확실히 바꾼다 */
function editOnDisk(path: string, text: string) {
  writeFileSync(path, text);
  const t = new Date(Date.now() + 5000);
  utimesSync(path, t, t);
}

async function pick(name: string): Promise<{ id: string; mimeType: string }> {
  const res = await fetch(`${server.url}/__picker`, { headers: { Authorization: "Bearer t-local" } });
  const body = (await res.json()) as { files: { id: string; name: string; mimeType: string }[] };
  const f = body.files.find((x) => x.name === name);
  assert.ok(f, `${name} 이 고르기 목록에 있다`);
  return f;
}

test("로컬 Drive — 작업실 폴더가 디스크에 생기고, 업무 상태 · 사람이 읽는 요약이 진짜 파일로 저장된다 · 다시 열면 그대로", async () => {
  const store = new DriveFileStore(deps, names);
  const repo = new WorkRepo(store, manifest(), (i) => `# ${i.title}\n상태: ${i.status}`);
  await repo.load();
  const item = createWorkItem({ workspaceId: "ws-company", areaId: "area-general", title: "10월 실적 보고" }, NOW);
  const r = await repo.saveItem(setWorkStatus(item, "waiting", NOW), NOW);
  assert.equal(r.status, "saved");
  const stateFile = join(server.root, "llmwiki 작업실", "앱 데이터", `${item.id}.json`);
  const summaryFile = join(server.root, "llmwiki 작업실", "업무 요약", `${item.id}.md`);
  assert.ok(existsSync(stateFile), "앱 데이터 폴더에 상태 파일");
  assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).status, "waiting");
  assert.equal(readFileSync(summaryFile, "utf8"), "# 10월 실적 보고\n상태: waiting");
  // 앱을 다시 연 것처럼 — 새 저장소 객체
  const again = await new WorkRepo(new DriveFileStore(deps, names), manifest()).load();
  assert.equal(again.items.find((i) => i.id === item.id)?.status, "waiting");
});

test("로컬 Drive 원본 — Docs/Sheets 는 export, md 는 내려받기, PDF 는 링크만", async () => {
  for (const [name, expect] of [
    ["10월 매출.gsheet", /10월,120/],
    ["회의록 1017.gdoc", /전월 대비/],
    ["이력서 메모.md", /이력서/],
  ] as const) {
    const f = await pick(name);
    const m = await getMeta(deps, f.id);
    assert.ok(m.ok);
    if (!m.ok) continue;
    const t = await readText(deps, m.meta);
    assert.ok(t.ok && expect.test(t.text), `${name} 내용을 읽는다`);
  }
  const pdf = await pick("계약서.pdf");
  const m = await getMeta(deps, pdf.id);
  assert.ok(m.ok);
  if (m.ok) assert.deepEqual(await readText(deps, m.meta), { ok: false, status: "unsupported" });
});

test("로컬 Drive — 원본을 디스크에서 고치면 버전이 오르고, 요약이 이전 버전 기준이라는 것이 보인다 · 이름을 바꿔도 같은 id · 지우면 접근 불가", async () => {
  const f = await pick("10월 매출.gsheet");
  const m1 = await getMeta(deps, f.id);
  assert.ok(m1.ok);
  if (!m1.ok) return;
  let src: Source = newSource({ workspaceId: "ws-company", provider: "drive", externalId: f.id, title: m1.meta.name, remoteVersion: m1.meta.version, format: "sheet" }, NOW);
  let item: WorkItem = createWorkItem({ workspaceId: "ws-company", areaId: "area-general", title: "보고" }, NOW);
  const l = linkSource(item, src, NOW);
  if (l.kind === "linked") item = l.item;
  item = setSummary(item, "10월 120억", [src], NOW);

  const path = join(server.root, "10월 실적", "10월 매출.gsheet");
  editOnDisk(path, "월,매출(억)\n9월,109\n10월,125\n");
  const m2 = await getMeta(deps, f.id);
  assert.ok(m2.ok && Number(m2.meta.version) > Number(m1.meta.version), "버전이 오른다");
  if (m2.ok) src = applyRemoteMeta(src, { ok: true, version: m2.meta.version, modifiedAt: m2.meta.modifiedTime }, NOW);
  assert.deepEqual(staleSources(item, [src]).map((s) => s.id), [src.id], "요약이 옛 버전 기준");

  renameSync(path, join(server.root, "10월 실적", "10월 매출(최종).gsheet"));
  const m3 = await getMeta(deps, f.id);
  assert.ok(m3.ok && m3.meta.name === "10월 매출(최종).gsheet", "이름이 바뀌어도 같은 id 로 찾는다");

  unlinkSync(join(server.root, "10월 실적", "10월 매출(최종).gsheet"));
  assert.deepEqual(await getMeta(deps, f.id), { ok: false, status: "lost" });
});

test("로컬 Drive — 디스크에서 상태 파일을 바깥에서 고치면 충돌: 덮어쓰지 않고 내 쪽은 사본 파일로", async () => {
  const store = new DriveFileStore(deps, names);
  const repo = new WorkRepo(store, manifest());
  await repo.load();
  let item = createWorkItem({ workspaceId: "ws-company", areaId: "area-general", title: "충돌 시험" }, NOW);
  const s = await repo.saveItem(item, NOW);
  if (s.status === "saved") item = s.value;
  const stateFile = join(server.root, "llmwiki 작업실", "앱 데이터", `${item.id}.json`);
  editOnDisk(stateFile, JSON.stringify({ ...item, title: "충돌 시험(다른 기기)", rev: 5 }));
  const r = await repo.saveItem(setWorkStatus(item, "done", NOW), NOW);
  assert.equal(r.status, "conflict");
  assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).title, "충돌 시험(다른 기기)", "바깥 변경이 그대로");
  const copies = await repo.listConflicts();
  const mine = copies.find((c) => c.path === PATHS.item(item.id));
  assert.ok(mine && JSON.parse(mine.mine).status === "done", "내 변경은 충돌 사본에");
});

test("로컬 Drive — 권한이 끊기면(401) 저장 실패로 알린다", async () => {
  const repo = new WorkRepo(new DriveFileStore(deps, names), manifest());
  await repo.load();
  await fetch(`${server.url}/__revoke`);
  const r = await repo.saveItem(createWorkItem({ workspaceId: "ws-personal", areaId: "area-general", title: "x" }, NOW), NOW);
  await fetch(`${server.url}/__renew`);
  assert.equal(r.status, "failed");
  assert.equal(r.status === "failed" && r.code, "auth_expired");
});
