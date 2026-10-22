/**
 * 작업실 저장소 — 파일 단위로 읽고 쓴다. 실제 Google Drive(앱 drive.ts) · 기기 저장소(KV) · 테스트용 메모리가 같은 틀(FileStore)을 따른다.
 *
 * 놓는 자리
 *   state/manifest.json        작업실 · 영역 · 오늘 순서 · 이행 기록(작다)
 *   state/items/{id}.json      업무 하나 = 파일 하나(큰 파일 하나에 몰지 않는다)
 *   state/sources/{id}.json    원본 자료 하나 = 파일 하나(여러 업무가 같은 파일을 가리킨다)
 *   raw/{hash}.txt             가져온 AI 결과 원문(한 번 쓰면 바꾸지 않는다)
 *   summaries/{id}.md          사람이 읽는 업무 요약(앱이 만든다 — 사람이 고칠 필요 없다)
 *   state/index/{범주}.json    페이지 색인(트리 · 제목 · 본문 지문) — 범주 하나 = 파일 하나(pages.ts)
 *   state/pages/{id}.json      사람이 만들거나 고친 페이지 문서(본문 · 자료 · 되돌리기)
 *   state/packs/{packId}.json  가져온 본문 묶음(한 번 쓰고 고치지 않는다 — 고치면 그 페이지만 state/pages 로 옮긴다)
 *   archive/v2/{id}.json       페이지로 옮기기 전 옛 업무 원본(한 번만)
 *   conflicts/…                충돌했을 때 내 쪽 사본
 *
 * 규칙
 * - 쓰기 전에 내가 마지막으로 본 버전과 지금 버전을 맞춰 본다. 다르면 덮어쓰지 않고 ConflictError — 내 쪽은 충돌 사본으로 남긴다.
 * - 쓰기에 실패하면 저장된 것으로 치지 않는다(rev 도 올리지 않는다).
 * - 검색 색인 · 화면 캐시는 여기서 다시 만든다(저장하지 않는다).
 */
import {
  applyImportToIndex,
  bodyHashOf,
  packBodies,
  PAGES_SCHEMA_VERSION,
  upgradeDoc,
  upgradeIndex,
  type BodyRef,
  type ImportPlan,
  type PageDoc,
  type PageIndexFile,
  type PageMeta,
  type PagePack,
} from "./pages.ts";
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
  /** 기기 사본을 두지 않을 경로 — 큰 가져오기 묶음이 기기 저장소(웹 localStorage 몇 MB)를 채우지 않게 */
  private skip: (path: string) => boolean;
  constructor(remote: FileStore, mirror: KvFileStore, online: () => boolean, skip: (path: string) => boolean = (p) => p.startsWith("state/packs/")) {
    this.remote = remote;
    this.mirror = mirror;
    this.online = online;
    this.skip = skip;
  }
  async list(prefix: string) {
    return this.online() ? this.remote.list(prefix) : this.mirror.list(prefix);
  }
  async read(path: string) {
    if (!this.online()) return this.mirror.read(path);
    const f = await this.remote.read(path);
    if (f && !this.skip(path)) await this.mirror.put(path, f.text, f.version).catch(() => undefined);
    return f;
  }
  async write(path: string, text: string, expected: string | null) {
    if (!this.online()) throw new StoreError("auth_expired");
    const r = await this.remote.write(path, text, expected);
    if (!this.skip(path)) await this.mirror.put(path, text, r.version).catch(() => undefined);
    return r;
  }
  async remove(path: string) {
    if (!this.online()) throw new StoreError("auth_expired");
    await this.remote.remove(path);
    await this.mirror.remove(path).catch(() => undefined);
  }
}

/** 기기에만 있던 작업실을 다른 저장소(Drive)로 복사한다 — 기기 쪽은 그대로 둔다. 이미 있는 파일은 건드리지 않는다 */
export async function copyStore(from: FileStore, to: FileStore, prefixes = ["state/manifest.json", "state/items/", "state/sources/", "state/index/", "state/pages/", "state/packs/", "archive/v2/", "raw/", "summaries/"]): Promise<{ copied: number; skipped: number }> {
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
  index: (workspaceId: string) => `state/index/${workspaceId}.json`,
  page: (id: string) => `state/pages/${id}.json`,
  pack: (packId: string) => `state/packs/${packId}.json`,
  archiveV2: (id: string) => `archive/v2/${id}.json`,
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

/** 한꺼번에 읽을 파일 수 — Drive 가 사용자당 초당 요청을 제한하므로 적당히 */
const READ_CONCURRENCY = 8;

/** 순서를 지키며 최대 limit 개씩 동시에 */
export async function mapLimit<T, R>(xs: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length);
  let next = 0;
  const worker = async () => {
    while (next < xs.length) {
      const i = next++;
      out[i] = await fn(xs[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, xs.length) }, worker));
  return out;
}

/** 페이지 본문 기기 캐시 — 본문 지문(bodyHash)이 키라 낡은 본문을 돌려줄 일이 없다 */
export interface BodyCache {
  get(hash: string): Promise<string | null>;
  put(hash: string, body: string): Promise<void>;
}

const bodyKey = (body: string) => bodyHashOf(body);

export class WorkRepo {
  /** 경로 → 내가 마지막으로 본 버전 */
  private versions = new Map<string, string>();
  /** 범주 → 내가 마지막으로 본 색인 파일 rev */
  private indexRevs = new Map<string, number>();
  /** 본문 지문 → 본문(이번 실행 동안) */
  private bodies = new Map<string, string>();
  /** 묶음은 한 번만 읽는다(같은 묶음의 페이지 여럿을 동시에 열어도) */
  private packs = new Map<string, Promise<PagePack | null>>();

  readonly store: FileStore;
  private fallbackManifest: WorkManifest;
  private renderSummary?: (item: WorkItem) => string;
  private bodyCache?: BodyCache;
  constructor(store: FileStore, fallbackManifest: WorkManifest, renderSummary?: (item: WorkItem) => string, opts: { bodyCache?: BodyCache } = {}) {
    this.store = store;
    this.fallbackManifest = fallbackManifest;
    this.renderSummary = renderSummary;
    this.bodyCache = opts.bodyCache;
  }

  /** 설정 · 업무 · 자료를 함께 읽는다 — Drive 는 요청 하나가 느려 차례로 읽으면 파일 수만큼 기다린다 */
  async load(): Promise<WorkState> {
    const [m, items, sources] = await Promise.all([
      this.store.read(PATHS.manifest),
      this.readAll("state/items/", (raw) => upgradeItem(raw)),
      this.readAll("state/sources/", (raw) => upgradeSource(raw)),
    ]);
    if (m) this.versions.set(PATHS.manifest, m.version);
    const manifest = upgradeManifest(m ? (JSON.parse(m.text) as Record<string, unknown>) : null, this.fallbackManifest);
    return { manifest, items, sources };
  }

  private async readAll<T>(prefix: string, up: (raw: Record<string, unknown>) => T): Promise<T[]> {
    const paths = await this.store.list(prefix);
    const files = await mapLimit(paths, READ_CONCURRENCY, (p) => this.store.read(p));
    const out: T[] = [];
    paths.forEach((p, i) => {
      const f = files[i];
      if (!f) return;
      this.versions.set(p, f.version);
      try {
        out.push(up(JSON.parse(f.text) as Record<string, unknown>));
      } catch {
        /* 깨진 파일은 건너뛴다(지우지 않는다) */
      }
    });
    return out;
  }

  /** 지금 저장소에서 다시 읽는다(충돌 후 · 다른 기기에서 바뀐 뒤) */
  async reloadItem(id: string): Promise<WorkItem | null> {
    const f = await this.store.read(PATHS.item(id));
    if (!f) return null;
    this.versions.set(PATHS.item(id), f.version);
    return upgradeItem(JSON.parse(f.text) as Record<string, unknown>);
  }

  private async put<T extends { rev: number }>(path: string, value: T, nowIso: string, parse: (text: string) => T, opts: { noCopy?: boolean } = {}): Promise<SaveOutcome<T>> {
    const next = { ...value, rev: value.rev + 1 };
    const text = JSON.stringify(next, null, 1);
    try {
      const { version } = await this.store.write(path, text, this.versions.get(path) ?? null);
      this.versions.set(path, version);
      return { status: "saved", value: next };
    } catch (e) {
      if (e instanceof ConflictError && opts.noCopy) {
        let remote: T | null = null;
        if (e.remote) {
          this.versions.set(path, e.remote.version);
          remote = parse(e.remote.text);
        }
        return { status: "conflict", remote, copyPath: "" };
      }
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

  /**
   * 매니페스트를 바꿔 쓴다 — 다른 곳(다른 기기 · MCP)이 먼저 고쳤으면 그 최신본에 fn 을 다시 적용한다(최대 3번).
   * 바꾸는 내용을 함수로 받으므로 사본 없이 합칠 수 있다. 그래도 안 되면 conflict.
   */
  async saveManifestWith(cur: WorkManifest, fn: (m: WorkManifest) => WorkManifest, nowIso: string): Promise<SaveOutcome<WorkManifest>> {
    let base = cur;
    for (let i = 0; i < 3; i++) {
      const next = fn(base) as WorkManifest & { rev?: number };
      const r = await this.put(PATHS.manifest, { ...next, rev: next.rev ?? 0 }, nowIso, (t) => upgradeManifest(JSON.parse(t) as Record<string, unknown>, next) as WorkManifest & { rev: number }, { noCopy: true });
      if (r.status !== "conflict") return r as SaveOutcome<WorkManifest>;
      if (!r.remote) return r as SaveOutcome<WorkManifest>;
      base = r.remote;
    }
    return { status: "conflict", remote: base as WorkManifest, copyPath: "" } as SaveOutcome<WorkManifest>;
  }

  async saveManifest(m: WorkManifest, nowIso: string): Promise<SaveOutcome<WorkManifest>> {
    const withRev = m as WorkManifest & { rev?: number };
    const r = await this.put(PATHS.manifest, { ...withRev, rev: withRev.rev ?? 0 }, nowIso, (t) => upgradeManifest(JSON.parse(t) as Record<string, unknown>, m) as WorkManifest & { rev: number });
    return r as SaveOutcome<WorkManifest>;
  }

  /** 원문은 해시 이름으로 한 번만 쓴다 — 이미 있으면 그대로(재시도해도 겹치지 않는다) */
  async saveRaw(hash: string, text: string): Promise<{ ok: true } | { ok: false; code: StoreErrorCode }> {
    return this.writeOnce(PATHS.raw(hash), text);
  }

  async readRaw(hash: string): Promise<string | null> {
    return (await this.store.read(PATHS.raw(hash)))?.text ?? null;
  }

  async removeSource(id: string): Promise<void> {
    await this.store.remove(PATHS.source(id));
    this.versions.delete(PATHS.source(id));
  }

  /* ───────── 페이지(스키마 3) ───────── */

  /** 매니페스트 · 색인(범주마다 하나) · 자료만 — 페이지 본문은 열 때 readBody. hasIndex: 색인이 하나라도 있나(없으면 아직 이행 전) */
  async loadPages(): Promise<{ manifest: WorkManifest; pages: PageMeta[]; sources: Source[]; hasIndex: boolean }> {
    const [m, indexes, sources] = await Promise.all([
      this.store.read(PATHS.manifest),
      this.readAll("state/index/", (raw) => raw),
      this.readAll("state/sources/", (raw) => upgradeSource(raw)),
    ]);
    if (m) this.versions.set(PATHS.manifest, m.version);
    const manifest = upgradeManifest(m ? (JSON.parse(m.text) as Record<string, unknown>) : null, this.fallbackManifest);
    const pages: PageMeta[] = [];
    for (const raw of indexes) {
      const f = upgradeIndex(raw, String(raw.workspaceId ?? ""));
      this.indexRevs.set(f.workspaceId, f.rev);
      pages.push(...f.pages);
    }
    return { manifest, pages, sources, hasIndex: indexes.length > 0 };
  }

  /**
   * 범주 하나의 색인을 바꿔 쓴다 — 다른 곳이 먼저 고쳤으면 그 최신본에 fn 을 다시 적용한다(최대 3번, saveManifestWith 와 같다).
   * cur 는 지금 아는 전체 페이지(다른 범주는 무시). 돌려주는 값은 이 범주의 페이지.
   */
  async saveIndexWith(workspaceId: string, cur: PageMeta[], fn: (pages: PageMeta[]) => PageMeta[], nowIso: string): Promise<SaveOutcome<PageMeta[]>> {
    const path = PATHS.index(workspaceId);
    let base = cur.filter((p) => p.workspaceId === workspaceId);
    for (let i = 0; i < 3; i++) {
      const file: PageIndexFile = { schemaVersion: PAGES_SCHEMA_VERSION, workspaceId, rev: this.indexRevs.get(workspaceId) ?? 0, pages: fn(base).filter((p) => p.workspaceId === workspaceId) };
      const r = await this.put(path, file, nowIso, (t) => upgradeIndex(JSON.parse(t) as Record<string, unknown>, workspaceId), { noCopy: true });
      if (r.status === "saved") {
        this.indexRevs.set(workspaceId, r.value.rev);
        return { status: "saved", value: r.value.pages };
      }
      if (r.status === "failed") return r;
      if (!r.remote) return { status: "conflict", remote: null, copyPath: "" };
      this.indexRevs.set(workspaceId, r.remote.rev);
      base = r.remote.pages;
    }
    return { status: "conflict", remote: base, copyPath: "" };
  }

  /** 페이지 문서 쓰기 — 버전 검사 · 충돌 사본(업무 파일과 같다). 묶음 속 페이지를 처음 고치면 여기서 제 파일이 생긴다 */
  async savePageDoc(doc: PageDoc, nowIso: string): Promise<SaveOutcome<PageDoc>> {
    const r = await this.put(PATHS.page(doc.id), doc, nowIso, (t) => upgradeDoc(JSON.parse(t) as Record<string, unknown>));
    if (r.status === "saved") this.remember(doc.body);
    return r;
  }

  private remember(body: string) {
    const key = bodyKey(body);
    this.bodies.set(key, body);
    void this.bodyCache?.put(key, body).catch(() => undefined);
  }

  private readPack(packId: string): Promise<PagePack | null> {
    let p = this.packs.get(packId);
    if (!p) {
      p = this.store
        .read(PATHS.pack(packId))
        .then((f) => (f ? (JSON.parse(f.text) as PagePack) : null))
        .catch((e) => {
          this.packs.delete(packId);
          throw e;
        });
      this.packs.set(packId, p);
    }
    return p;
  }

  /** 문서 하나 — 제 파일이면 그것을, 묶음 속이면 본문만 꺼내 rev 0 문서로(처음 저장할 때 제 파일이 생긴다) */
  async readDoc(meta: PageMeta): Promise<PageDoc | null> {
    if (meta.bodyRef === "file") {
      const f = await this.store.read(PATHS.page(meta.id));
      if (!f) return null;
      this.versions.set(PATHS.page(meta.id), f.version);
      const doc = upgradeDoc(JSON.parse(f.text) as Record<string, unknown>);
      this.remember(doc.body);
      return doc;
    }
    const pack = await this.readPack(meta.bodyRef.slice("pack:".length));
    const hit = pack?.pages.find((x) => x.id === meta.id);
    if (!hit) return null;
    this.remember(hit.body);
    return { id: meta.id, schemaVersion: PAGES_SCHEMA_VERSION, rev: 0, workspaceId: meta.workspaceId, body: hit.body, sourceIds: [], changes: [], updatedAt: meta.updatedAt };
  }

  /** 본문만 — 메모리 → 기기 캐시(지문 키) → 저장소(제 파일 · 묶음) 순서로 */
  async readBody(meta: PageMeta): Promise<string | null> {
    const mem = this.bodies.get(meta.bodyHash);
    if (mem != null) return mem;
    const cached = await this.bodyCache?.get(meta.bodyHash).catch(() => null);
    if (cached != null && bodyKey(cached) === meta.bodyHash) {
      this.bodies.set(meta.bodyHash, cached);
      return cached;
    }
    return (await this.readDoc(meta))?.body ?? null;
  }

  /** 여러 페이지 본문(펼쳐 보기 · 묶음) — 같은 묶음은 한 번만 읽는다 */
  async readBodies(metas: PageMeta[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const got = await mapLimit(metas, READ_CONCURRENCY, (m) => this.readBody(m).catch(() => null));
    metas.forEach((m, i) => {
      if (got[i] != null) out.set(m.id, got[i] as string);
    });
    return out;
  }

  /**
   * 가져오기를 쓴다 — 본문 묶음을 먼저(한 번 쓰고 고치지 않는다), 색인은 마지막에. 묶음 쓰기가 실패하면 색인을 건드리지 않는다
   * (남은 묶음은 아무도 가리키지 않을 뿐 해롭지 않다). 색인은 최신본에 다시 얹는다.
   */
  async applyImport(plan: ImportPlan, cur: PageMeta[], nowIso: string): Promise<SaveOutcome<PageMeta[]> & { packs?: number }> {
    const items = [...plan.create.map((c) => ({ id: c.meta.id, body: c.body })), ...plan.update.map((u) => ({ id: u.meta.id, body: u.body }))];
    const packs = packBodies(items);
    const refOf = new Map<string, BodyRef>();
    for (const pack of packs) {
      try {
        await this.store.write(PATHS.pack(pack.id), JSON.stringify(pack), null);
      } catch (e) {
        return { status: "failed", code: e instanceof StoreError ? e.code : "unknown", message: (e as Error)?.message ?? String(e) };
      }
      this.packs.set(pack.id, Promise.resolve(pack));
      for (const p of pack.pages) {
        refOf.set(p.id, `pack:${pack.id}`);
        this.remember(p.body);
      }
    }
    const r = await this.saveIndexWith(plan.workspaceId, cur, (pages) => applyImportToIndex(pages, plan, (id) => refOf.get(id) ?? "file"), nowIso);
    return { ...r, packs: packs.length };
  }

  /** 이행 — 문서가 이미 있으면(앞선 이행이 중간에 멈춤) 그것을 쓰고, 없을 때만 새로 쓴다(충돌 사본을 만들지 않는다) */
  async ensurePageDoc(doc: PageDoc, nowIso: string): Promise<SaveOutcome<PageDoc>> {
    const f = await this.store.read(PATHS.page(doc.id)).catch(() => null);
    if (f) {
      this.versions.set(PATHS.page(doc.id), f.version);
      return { status: "saved", value: upgradeDoc(JSON.parse(f.text) as Record<string, unknown>) };
    }
    return this.savePageDoc(doc, nowIso);
  }

  /** 옛 업무 파일 id(목록만 — 읽지 않는다). 이행이 필요한지 볼 때 */
  async listItemIds(): Promise<string[]> {
    return (await this.store.list("state/items/")).map((p) => p.slice("state/items/".length).replace(/\.json$/, ""));
  }

  /** 옛 업무 파일 몇 개만 읽는다(이행할 것만) */
  async readItems(ids: string[]): Promise<WorkItem[]> {
    const files = await mapLimit(ids, READ_CONCURRENCY, (id) => this.store.read(PATHS.item(id)).catch(() => null));
    const out: WorkItem[] = [];
    files.forEach((f) => {
      if (!f) return;
      try {
        out.push(upgradeItem(JSON.parse(f.text) as Record<string, unknown>));
      } catch {
        /* 깨진 파일은 건너뛴다(지우지 않는다) */
      }
    });
    return out;
  }

  /** 한 번만 쓰는 파일(원문 · 옛 업무 원본) — 이미 있으면 그대로 */
  async writeOnce(path: string, text: string): Promise<{ ok: true } | { ok: false; code: StoreErrorCode }> {
    try {
      if (await this.store.read(path)) return { ok: true };
      await this.store.write(path, text, null);
      return { ok: true };
    } catch (e) {
      if (e instanceof ConflictError) return { ok: true };
      return { ok: false, code: e instanceof StoreError ? e.code : "unknown" };
    }
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
