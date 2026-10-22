import assert from "node:assert/strict";
import { test } from "node:test";

import { createPage, trashPage } from "../../packages/core/src/pages.ts";
import { createWorkItem, defaultManifest } from "../../packages/core/src/work.ts";
import { MemoryFileStore, PATHS, WorkRepo } from "../../packages/core/src/workStore.ts";
import { listPages } from "./driveList.ts";

const NOW = "2026-10-22T09:00:00.000Z";

test("서버 읽기 — 색인에서 id · 제목 · 범주 · 부모 · 고친 때만(본문 · 휴지통 · 매니페스트는 돌려주지 않는다)", async () => {
  const store = new MemoryFileStore();
  const repo = new WorkRepo(store, defaultManifest({ personal: "개인", company: "회사", dev: "개발", reading: "독서" }));
  const a = createPage([], { workspaceId: "ws-personal", title: "취준", body: "비밀 본문" }, NOW);
  if (a.kind !== "ok") return assert.fail();
  const b = createPage(a.pages, { workspaceId: "ws-personal", parentId: a.page.id, title: "피트인" }, NOW);
  if (b.kind !== "ok") return assert.fail();
  const c = createPage(b.pages, { workspaceId: "ws-personal", title: "버린 것" }, NOW);
  if (c.kind !== "ok") return assert.fail();
  await repo.saveIndexWith("ws-personal", [], () => trashPage(c.pages, c.page.id, "with_children", NOW).pages, NOW);
  await repo.saveItem(createWorkItem({ workspaceId: "ws-personal", title: "옛 업무" }, NOW), NOW);
  const r = await listPages(store);
  assert.equal(r.source, "index");
  assert.deepEqual(r.items.map((x) => [x.title, x.parentId]).sort(), [["취준", null], ["피트인", a.page.id]].sort());
  assert.deepEqual(Object.keys(r.items[0]).sort(), ["id", "parentId", "title", "updatedAt", "workspaceId"]);
  assert.ok(!JSON.stringify(r).includes("비밀 본문"));
});

test("서버 읽기 — 색인이 없으면 옛 업무 파일로", async () => {
  const store = new MemoryFileStore();
  const it = createWorkItem({ workspaceId: "ws-dev", title: "옛 업무" }, NOW);
  store.externalWrite(PATHS.item(it.id), JSON.stringify(it));
  const r = await listPages(store);
  assert.deepEqual(r, { source: "items", items: [{ id: it.id, title: "옛 업무", workspaceId: "ws-dev", parentId: null, updatedAt: NOW }] });
});
