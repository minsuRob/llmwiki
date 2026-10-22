/**
 * 서버가 사용자 Drive 에서 읽는 것 — 페이지 목록만(docs/architecture.md 원칙 4 표 "서버가 읽는 범위").
 * 페이지 색인(state/index/*.json)에서 id · 제목 · 범주 · 부모 · 고친 때만 꺼낸다. 본문 · 자료 · 매니페스트는 읽지 않는다.
 * 색인이 하나도 없으면(앱이 이행 전) 옛 업무 파일(state/items/*.json)에서 id · 제목 · 범주 · 고친 때만.
 * 읽은 것은 저장하지도 로그에 남기지도 않는다 — 돌려주기만.
 */
import { upgradeIndex } from "../../packages/core/src/pages.ts";
import { upgradeItem } from "../../packages/core/src/work.ts";
import type { FileStore } from "../../packages/core/src/workStore.ts";

export interface ListedPage {
  id: string;
  title: string;
  workspaceId: string;
  parentId: string | null;
  updatedAt: string;
}

const MAX = 2000;

export async function listPages(store: FileStore): Promise<{ items: ListedPage[]; source: "index" | "items" }> {
  const indexes = await store.list("state/index/");
  const items: ListedPage[] = [];
  if (indexes.length) {
    for (const p of indexes) {
      const f = await store.read(p);
      if (!f) continue;
      try {
        const idx = upgradeIndex(JSON.parse(f.text) as Record<string, unknown>, "");
        for (const m of idx.pages) if (!m.trashedAt && items.length < MAX) items.push({ id: m.id, title: m.title, workspaceId: m.workspaceId, parentId: m.parentId ?? null, updatedAt: m.updatedAt });
      } catch {
        /* 깨진 파일은 건너뛴다 */
      }
    }
    return { items, source: "index" };
  }
  for (const p of (await store.list("state/items/")).slice(0, 200)) {
    const f = await store.read(p);
    if (!f) continue;
    try {
      const it = upgradeItem(JSON.parse(f.text) as Record<string, unknown>);
      items.push({ id: it.id, title: it.title, workspaceId: it.workspaceId, parentId: null, updatedAt: it.updatedAt });
    } catch {
      /* 깨진 파일은 건너뛴다 */
    }
  }
  return { items, source: "items" };
}
