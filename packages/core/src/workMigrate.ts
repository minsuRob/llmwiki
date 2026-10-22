/**
 * 예전 데이터 이행 — Firestore 의 기록(scraps)을 작업실 보관함의 메모로 **복사**한다.
 * - 원본(Firestore)은 그대로 둔다. 자동으로 지우지 않는다.
 * - 같은 기록을 두 번 옮기지 않는다(migratedFrom).
 * - 되돌리면 이번에 옮긴 메모만 지우고, 업무에 이어 둔 것도 풀린다.
 * 할일(tasks)은 옮기지 않는다 — 할일 탭 · 오늘 화면이 지금처럼 Firestore 에서 읽는다.
 */
import type { Scrap } from "./types.ts";
import { newId } from "./types.ts";
import type { PageMeta } from "./pages.ts";
import { newSource, type MigrationRecord, type Source, type WorkManifest } from "./work.ts";

export function planScrapMigration(state: { sources: Source[] }, scraps: Scrap[], workspaceId: string, nowIso: string): { sources: Source[]; record: MigrationRecord | null } {
  const already = new Set(state.sources.filter((s) => s.migratedFrom?.coll === "scraps").map((s) => s.migratedFrom?.id));
  const sources = scraps
    .filter((s) => !s.deletedAt && !already.has(s.id))
    .map((s) => ({
      ...newSource({ workspaceId, provider: "legacy", title: s.text.split("\n")[0].slice(0, 80), text: s.text, migratedFrom: { coll: "scraps", id: s.id } }, nowIso),
      createdAt: s.createdAt,
    }));
  if (!sources.length) return { sources, record: null };
  return { sources, record: { id: newId(), kind: "legacy_scraps", at: nowIso, sourceIds: sources.map((s) => s.id), reverted: false } };
}

/** 되돌리기 — 지울 자료 id 와 그 자료를 풀어야 할 페이지(색인의 자료 사본으로 찾는다) */
export function planRevert(state: { manifest: WorkManifest; pages: PageMeta[] }, migrationId: string): { removeSourceIds: string[]; pageIds: string[] } {
  const rec = state.manifest.migrations.find((m) => m.id === migrationId && !m.reverted && m.kind === "legacy_scraps");
  if (!rec) return { removeSourceIds: [], pageIds: [] };
  const ids = new Set(rec.sourceIds);
  return { removeSourceIds: rec.sourceIds, pageIds: state.pages.filter((p) => (p.sourceIds ?? []).some((s) => ids.has(s))).map((p) => p.id) };
}
