/**
 * 작업실 저장소 — 파일 단위로 읽고 쓴다. 실제 Google Drive(앱 drive.ts) · 기기 저장소(KV) · 테스트용 메모리가 같은 틀(FileStore)을 따른다.
 *
 * 놓는 자리
 *   state/manifest.json        작업실 · 영역 · 오늘 순서 · 이행 기록(작다)
 *   state/items/{id}.json      업무 하나 = 파일 하나(큰 파일 하나에 몰지 않는다)
 *   state/sources/{id}.json    원본 자료 하나 = 파일 하나(여러 업무가 같은 파일을 가리킨다)
 *   raw/{hash}.txt             가져온 AI 결과 원문(한 번 쓰면 바꾸지 않는다)
 *   summaries/{id}.md          사람이 읽는 업무 요약(앱이 만든다 — 사람이 고칠 필요 없다)
 *   conflicts/…                충돌했을 때 내 쪽 사본
 *
 * 규칙
 * - 쓰기 전에 내가 마지막으로 본 버전과 지금 버전을 맞춰 본다. 다르면 덮어쓰지 않고 ConflictError — 내 쪽은 충돌 사본으로 남긴다.
 * - 쓰기에 실패하면 저장된 것으로 치지 않는다(rev 도 올리지 않는다).
 * - 검색 색인 · 화면 캐시는 여기서 다시 만든다(저장하지 않는다).
 */
import {
  upgradeItem,
  upgradeManifest,
  upgradeSource,
  type Source,
  type WorkItem,
  type WorkManifest,
  type WorkState,
} from "./work.ts";

export type StoreErrorCode = "auth_expired" | "offline" | "forbidden" | "not_configured" | "unknown";

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  constructor(code: StoreErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export class ConflictError extends Error {
  readonly path: string;
  readonly remote: { text: string; version: string } | null;
  constructor(path: string, remote: { text: string; version: string } | null) {
    super(`conflict: ${path}`);
    this.path = path;
    this.remote = remote;
  }
}

export interface FileStore {
  readonly kind: "memory" | "device" | "drive";
  list(prefix: string): Promise<string[]>;
  read(path: string): Promise<{ text: string; version: string } | null>;
  /** expected — 내가 본 버전. null 이면 아직 없어야 한다. 맞지 않으면 ConflictError */
  write(path: string, text: string, expected: string | null): Promise<{ version: string }>;
  /** 지운다(Drive 는 휴지통으로). 이행을 되돌릴 때만 쓴다 */
  remove(path: string): Promise<void>;
}

/* ───────────────────────── 메모리(테스트) ───────────────────────── */

export class MemoryFileStore implements FileStore {
  readonly kind = "memory" as const;
  files = new Map<string, { text: string; version: number }>();
  /** 다음 쓰기 몇 번을 실패시킨다(저장 실패 시험) */
  failWrites = 0;

  async list(prefix: string) {
    return [...this.files.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
  async read(path: string) {
    const f = this.files.get(path);
    return f ? { text: f.text, version: String(f.version) } : null;
  }
  async write(path: string, text: string, expected: string | null) {
    if (this.failWrites > 0) {
      this.failWrites--;
      throw new StoreError("offline", "write failed");
    }
    const f = this.files.get(path);
    const cur = f ? String(f.version) : null;
    if (cur !== expected) throw new ConflictError(path, f ? { text: f.text, version: cur as string } : null);
    const version = (f?.version ?? 0) + 1;
    this.files.set(path, { text, version });
    return { version: String(version) };
  }
  async remove(path: string) {
    this.files.delete(path);
  }
  /** 다른 기기 · 사람이 바깥에서 고친 것처럼 */
  externalWrite(path: string, text: string) {
    const f = this.files.get(path);
    this.files.set(path, { text, version: (f?.version ?? 0) + 1 });
  }
}

/* ───────────────────────── 기기(KV — AsyncStorage · localStorage) ───────────────────────── */

export interface KV {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}

export class KvFileStore implements FileStore {
  readonly kind = "device" as const;
  private kv: KV;
  private ns: string;
  constructor(kv: KV, ns: string) {
    this.kv = kv;
    this.ns = ns;
  }
  private key(path: string) {
    return `${this.ns}/${path}`;
  }
  async list(prefix: string) {
    const keys = await this.kv.getAllKeys();
    const head = this.key(prefix);
    return keys.filter((k) => k.startsWith(head)).map((k) => k.slice(this.ns.length + 1)).sort();
  }
  async read(path: string) {
    const raw = await this.kv.getItem(this.key(path));
    if (!raw) return null;
    const f = JSON.parse(raw) as { t: string; v: number };
    return { text: f.t, version: String(f.v) };
  }
  async write(path: string, text: string, expected: string | null) {
    const cur = await this.read(path);
    if ((cur?.version ?? null) !== expected) throw new ConflictError(path, cur);
    const v = Number(cur?.version ?? 0) + 1;
    try {
      await this.kv.setItem(this.key(path), JSON.stringify({ t: text, v }));
    } catch (e) {
      throw new StoreError("unknown", (e as Error)?.message);
    }
    return { version: String(v) };
  }
  async remove(path: string) {
    await this.kv.removeItem(this.key(path));
  }
  /** 캐시용 — 버전 확인 없이 바깥(Drive) 버전 그대로 적는다 */
  async put(path: string, text: string, version: string) {
    await this.kv.setItem(this.key(path), JSON.stringify({ t: text, v: version }));
  }
}

/**
 * Drive + 기기 사본. 연결돼 있으면 Drive 에서 읽고 쓰며 기기에 사본을 남기고,
 * 토큰이 없으면 기기 사본에서 읽기만 한다(쓰기는 실패 — 저장된 것으로 치지 않는다).
 * 사본에는 Drive 버전을 그대로 적어, 다시 연결했을 때 바깥 변경을 충돌로 알아챈다.
 */
export class MirroredStore implements FileStore {
  readonly kind = "drive" as const;
  private remote: FileStore;
  private mirror: KvFileStore;
  private online: () => boolean;
  constructor(remote: FileStore, mirror: KvFileStore, online: () => boolean) {
    this.remote = remote;
    this.mirror = mirror;
    this.online = online;
  }
  async list(prefix: string) {
    return this.online() ? this.remote.list(prefix) : this.mirror.list(prefix);
  }
  async read(path: string) {
    if (!this.online()) return this.mirror.read(path);
    const f = await this.remote.read(path);
    if (f) await this.mirror.put(path, f.text, f.version).catch(() => undefined);
    return f;
  }
  async write(path: string, text: string, expected: string | null) {
    if (!this.online()) throw new StoreError("auth_expired");
    const r = await this.remote.write(path, text, expected);
    await this.mirror.put(path, text, r.version).catch(() => undefined);
    return r;
  }
  async remove(path: string) {
    if (!this.online()) throw new StoreError("auth_expired");
    await this.remote.remove(path);
    await this.mirror.remove(path).catch(() => undefined);
  }
}

/** 기기에만 있던 작업실을 다른 저장소(Drive)로 복사한다 — 기기 쪽은 그대로 둔다. 이미 있는 파일은 건드리지 않는다 */
export async function copyStore(from: FileStore, to: FileStore, prefixes = ["state/manifest.json", "state/items/", "state/sources/", "raw/", "summaries/"]): Promise<{ copied: number; skipped: number }> {
  let copied = 0;
  let skipped = 0;
  for (const prefix of prefixes) {
    const paths = prefix.endsWith("/") ? await from.list(prefix) : [prefix];
    for (const p of paths) {
      const f = await from.read(p);
      if (!f) continue;
      try {
        await to.write(p, f.text, null);
        copied++;
      } catch (e) {
        if (e instanceof ConflictError) skipped++;
        else throw e;
      }
    }
  }
  return { copied, skipped };
}

/* ───────────────────────── 저장소 ───────────────────────── */

export const PATHS = {
  manifest: "state/manifest.json",
  item: (id: string) => `state/items/${id}.json`,
  source: (id: string) => `state/sources/${id}.json`,
  raw: (hash: string) => `raw/${hash}.txt`,
  summary: (id: string) => `summaries/${id}.md`,
  conflict: (path: string, at: string) => `conflicts/${at.replace(/[:.]/g, "-")}__${path.replace(/\//g, "~")}`,
};

export type SaveOutcome<T> =
  | { status: "saved"; value: T }
  | { status: "conflict"; remote: T | null; copyPath: string }
  | { status: "failed"; code: StoreErrorCode; message: string };

export interface ConflictCopy {
  copyPath: string;
  path: string;
  at: string;
  mine: string;
  resolved: boolean;
}

export class WorkRepo {
  /** 경로 → 내가 마지막으로 본 버전 */
  private versions = new Map<string, string>();

  readonly store: FileStore;
  private fallbackManifest: WorkManifest;
  private renderSummary?: (item: WorkItem) => string;
  constructor(store: FileStore, fallbackManifest: WorkManifest, renderSummary?: (item: WorkItem) => string) {
    this.store = store;
    this.fallbackManifest = fallbackManifest;
    this.renderSummary = renderSummary;
  }

  async load(): Promise<WorkState> {
    const m = await this.store.read(PATHS.manifest);
    if (m) this.versions.set(PATHS.manifest, m.version);
    const manifest = upgradeManifest(m ? (JSON.parse(m.text) as Record<string, unknown>) : null, this.fallbackManifest);
    const items = await this.readAll("state/items/", (raw) => upgradeItem(raw));
    const sources = await this.readAll("state/sources/", (raw) => upgradeSource(raw));
    return { manifest, items, sources };
  }

  private async readAll<T>(prefix: string, up: (raw: Record<string, unknown>) => T): Promise<T[]> {
    const paths = await this.store.list(prefix);
    const out: T[] = [];
    for (const p of paths) {
      const f = await this.store.read(p);
      if (!f) continue;
      this.versions.set(p, f.version);
      try {
        out.push(up(JSON.parse(f.text) as Record<string, unknown>));
      } catch {
        /* 깨진 파일은 건너뛴다(지우지 않는다) */
      }
    }
    return out;
  }

  /** 지금 저장소에서 다시 읽는다(충돌 후 · 다른 기기에서 바뀐 뒤) */
  async reloadItem(id: string): Promise<WorkItem | null> {
    const f = await this.store.read(PATHS.item(id));
    if (!f) return null;
    this.versions.set(PATHS.item(id), f.version);
    return upgradeItem(JSON.parse(f.text) as Record<string, unknown>);
  }

  private async put<T extends { rev: number }>(path: string, value: T, nowIso: string, parse: (text: string) => T): Promise<SaveOutcome<T>> {
    const next = { ...value, rev: value.rev + 1 };
    const text = JSON.stringify(next, null, 1);
    try {
      const { version } = await this.store.write(path, text, this.versions.get(path) ?? null);
      this.versions.set(path, version);
      return { status: "saved", value: next };
    } catch (e) {
      if (e instanceof ConflictError) {
        const copyPath = PATHS.conflict(path, nowIso);
        // 내 쪽을 사본으로 — 이것까지 실패하면 저장 실패로 알린다(조용히 버리지 않는다)
        try {
          await this.store.write(copyPath, JSON.stringify({ path, at: nowIso, mine: text, resolved: false }), null);
        } catch (e2) {
          return { status: "failed", code: e2 instanceof StoreError ? e2.code : "unknown", message: (e2 as Error).message };
        }
        let remote: T | null = null;
        if (e.remote) {
          this.versions.set(path, e.remote.version);
          remote = parse(e.remote.text);
        }
        return { status: "conflict", remote, copyPath };
      }
      return { status: "failed", code: e instanceof StoreError ? e.code : "unknown", message: (e as Error)?.message ?? String(e) };
    }
  }

  async saveItem(item: WorkItem, nowIso: string): Promise<SaveOutcome<WorkItem> & { summaryFailed?: boolean }> {
    const r = await this.put(PATHS.item(item.id), item, nowIso, (t) => upgradeItem(JSON.parse(t) as Record<string, unknown>));
    if (r.status !== "saved" || !this.renderSummary) return r;
    // 사람이 읽는 요약 — 상태 파일이 저장된 뒤에만. 실패해도 상태는 저장된 것이고, 따로 알린다
    const sp = PATHS.summary(item.id);
    try {
      const cur = await this.store.read(sp);
      const { version } = await this.store.write(sp, this.renderSummary(r.value), cur?.version ?? null);
      this.versions.set(sp, version);
      return r;
    } catch {
      return { ...r, summaryFailed: true };
    }
  }

  async saveSource(source: Source, nowIso: string): Promise<SaveOutcome<Source>> {
    return this.put(PATHS.source(source.id), source, nowIso, (t) => upgradeSource(JSON.parse(t) as Record<string, unknown>));
  }

  async saveManifest(m: WorkManifest, nowIso: string): Promise<SaveOutcome<WorkManifest>> {
    const withRev = m as WorkManifest & { rev?: number };
    const r = await this.put(PATHS.manifest, { ...withRev, rev: withRev.rev ?? 0 }, nowIso, (t) => upgradeManifest(JSON.parse(t) as Record<string, unknown>, m) as WorkManifest & { rev: number });
    return r as SaveOutcome<WorkManifest>;
  }

  /** 원문은 해시 이름으로 한 번만 쓴다 — 이미 있으면 그대로(재시도해도 겹치지 않는다) */
  async saveRaw(hash: string, text: string): Promise<{ ok: true } | { ok: false; code: StoreErrorCode }> {
    const p = PATHS.raw(hash);
    try {
      if (await this.store.read(p)) return { ok: true };
      await this.store.write(p, text, null);
      return { ok: true };
    } catch (e) {
      if (e instanceof ConflictError) return { ok: true };
      return { ok: false, code: e instanceof StoreError ? e.code : "unknown" };
    }
  }

  async readRaw(hash: string): Promise<string | null> {
    return (await this.store.read(PATHS.raw(hash)))?.text ?? null;
  }

  async removeSource(id: string): Promise<void> {
    await this.store.remove(PATHS.source(id));
    this.versions.delete(PATHS.source(id));
  }

  async listConflicts(): Promise<ConflictCopy[]> {
    const paths = await this.store.list("conflicts/");
    const out: ConflictCopy[] = [];
    for (const p of paths) {
      const f = await this.store.read(p);
      if (!f) continue;
      try {
        const c = JSON.parse(f.text) as Omit<ConflictCopy, "copyPath">;
        out.push({ ...c, copyPath: p });
      } catch {
        /* 건너뛴다 */
      }
    }
    return out;
  }

  /**
   * 충돌 정리 — mine: 사람이 내 쪽을 고르면 지금 저장소 버전 위에 쓴다(rev 는 둘 중 큰 것 + 1).
   * theirs: 저장소 쪽을 그대로 두고 사본만 "정리됨" 으로 남긴다(지우지 않는다).
   */
  async resolveConflict(copy: ConflictCopy, choice: "mine" | "theirs", nowIso: string): Promise<SaveOutcome<string>> {
    if (choice === "mine") {
      const cur = await this.store.read(copy.path);
      const mine = JSON.parse(copy.mine) as { rev?: number };
      const remoteRev = cur ? Number((JSON.parse(cur.text) as { rev?: number }).rev ?? 0) : 0;
      const text = JSON.stringify({ ...mine, rev: Math.max(remoteRev, mine.rev ?? 0) + 1 }, null, 1);
      try {
        const { version } = await this.store.write(copy.path, text, cur?.version ?? null);
        this.versions.set(copy.path, version);
      } catch (e) {
        if (e instanceof ConflictError) return { status: "conflict", remote: null, copyPath: copy.copyPath };
        return { status: "failed", code: e instanceof StoreError ? e.code : "unknown", message: (e as Error).message };
      }
    }
    try {
      const f = await this.store.read(copy.copyPath);
      await this.store.write(copy.copyPath, JSON.stringify({ path: copy.path, at: copy.at, mine: copy.mine, resolved: true, resolvedAt: nowIso, choice }), f?.version ?? null);
    } catch (e) {
      return { status: "failed", code: e instanceof StoreError ? e.code : "unknown", message: (e as Error).message };
    }
    return { status: "saved", value: choice };
  }
}
