/**
 * 작업실 상태 — 페이지 트리 · 받은 것(자료) · 정리 제안 · 본문 제안. Firestore 를 쓰지 않는다.
 *
 * 저장소
 * - 기본: 기기 저장소(AsyncStorage · 웹은 localStorage). 사용자(uid)마다 공간을 나눈다.
 * - Drive 를 이으면: 내 드라이브의 앱 폴더(drive.file)에 쓰고 기기에 사본을 둔다. 연결이 끊기면 사본으로 읽기만.
 * - 처음 읽을 때는 매니페스트 · 색인(범주마다 하나) · 자료만. 페이지 본문은 열 때(openDoc · readBody).
 * - 옛 업무 파일(state/items)이 색인에 없으면 그때 한 번 페이지로 옮긴다(pages.ts migrateToPages — 여러 번 돌아도 같다).
 * - 문서 · 색인 쓰기는 페이지 · 범주마다 차례로(겹쳐 쓰다 스스로 충돌하지 않게). 실패 · 충돌은 그대로 화면에 알린다.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { DriveFileStore, getMeta, listFolder, readText, formatOf, readPlan, type DriveDeps, type Fetch } from "../../../../packages/core/src/drive.ts";
import {
  acceptBodyProposal,
  childrenOf,
  createPage as createPageCore,
  editBody,
  mergeBodyProposals,
  migrateToPages,
  movePage as movePageCore,
  proposeBody,
  rejectBodyProposal,
  renamePage as renamePageCore,
  reorderPage as reorderPageCore,
  restorePage as restorePageCore,
  setPageIcon,
  syncMeta,
  trashPage as trashPageCore,
  undoDoc as undoDocCore,
  unlinkSourceFromPage,
  type BodyProposal,
  type MigrateLabels,
  type PageDoc,
  type PageMeta,
} from "../../../../packages/core/src/pages.ts";
import type { Scrap } from "../../../../packages/core/src/types.ts";
import {
  acceptTriage as acceptTriageCore,
  applyRemoteMeta,
  defaultManifest,
  fileSource,
  findSameSource,
  mergeTriage,
  newSource,
  type AiTool,
  type Source,
  type TriageState,
  type WorkManifest,
} from "../../../../packages/core/src/work.ts";
import { importTriage, prepareTriage as prepareTriagePack, type TriageImport, type TriageLabels } from "../../../../packages/core/src/workTriage.ts";
import { planRevert, planScrapMigration } from "../../../../packages/core/src/workMigrate.ts";
import { copyStore, KvFileStore, MirroredStore, PATHS, WorkRepo, type BodyCache, type ConflictCopy, type FileStore, type KV, type SaveOutcome } from "../../../../packages/core/src/workStore.ts";
import { useI18n, type T } from "../../i18n";
import { driveLink as driveLinkApi, driveStatus as driveStatusApi, driveToken as driveTokenApi, driveUnlink as driveUnlinkApi, errorText } from "../../firebase/api";
import { useData } from "../../firebase/data";
import { driveConfig, localDriveToken, localDriveUrl } from "./drive/config";
import { requestLocalPick } from "./drive/LocalDrivePicker";
import { DRIVE_PLATFORM_SUPPORTED, DriveAuthError, pickDriveFiles, recallDriveToken, rememberDriveToken, requestDriveCode, requestDriveToken, revokeDriveToken, type DriveToken } from "./drive/googleDrive";

export type SaveState = "saving" | "saved" | "failed" | "conflict";
export type DriveStatus = "unavailable" | "not_configured" | "disconnected" | "connecting" | "connected" | "expired" | "error";

/** 화면이 보는 상태 — 페이지는 색인만 */
export type PagesState = TriageState;

const kv: KV = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
  getAllKeys: () => AsyncStorage.getAllKeys(),
};

const nowIso = () => new Date().toISOString();

const prefKey = (u: string, k: string) => `llmwiki:work:${u}:${k}`;
/** 저장하지 못한 페이지 문서 — 새로 고침 · 앱을 닫아도 남게 기기에 잠시 둔다(저장된 것으로 치지 않는다). 다시 저장되면 지운다 */
const pendingKey = (u: string, id: string) => prefKey(u, `pending-doc:${id}`);
async function readPending(u: string): Promise<PageDoc[]> {
  const keys = (await AsyncStorage.getAllKeys().catch(() => [] as readonly string[])).filter((k) => k.startsWith(prefKey(u, "pending-doc:")));
  const out: PageDoc[] = [];
  for (const k of keys) {
    const v = await AsyncStorage.getItem(k).catch(() => null);
    if (v) out.push(JSON.parse(v) as PageDoc);
  }
  return out;
}

/** 본문 기기 캐시 — 작은 본문만, 개수 상한(웹 localStorage 는 몇 MB 뿐) */
const BODY_CACHE_MAX = 40_000;
function bodyCacheFor(u: string): BodyCache {
  const key = (h: string) => prefKey(u, `body:${h}`);
  return {
    get: (h) => AsyncStorage.getItem(key(h)).catch(() => null),
    put: async (h, body) => {
      if (body.length <= BODY_CACHE_MAX) await AsyncStorage.setItem(key(h), body).catch(() => undefined);
    },
  };
}

export type AcceptOutcome = SaveState | "gone" | "needs_confirm" | "stale" | "bad_raw";

interface WorkApi {
  ready: boolean;
  state: PagesState;
  storage: "device" | "drive";
  /** server: 서버(Functions)에 Drive 열쇠를 이어 두었나 — 이어 두면 새 탭 · 만료 때 팝업 없이 이어 쓴다 */
  drive: { status: DriveStatus; folderUrl: string | null; error: string | null; local: boolean; server?: { linked: boolean; email: string | null } };
  /** 키: 페이지 id(문서) · "index:{범주}" · "manifest" · 자료 id */
  saves: Record<string, { state: SaveState; at: string; code?: string }>;
  conflicts: ConflictCopy[];
  workspaceId: string;
  setWorkspaceId: (id: string) => void;
  /** 열어 본 페이지 문서(본문 · 자료 · 되돌리기) */
  docs: Record<string, PageDoc>;
  openDoc: (id: string) => Promise<PageDoc | null>;
  readBodies: (metas: PageMeta[]) => Promise<Map<string, string>>;
  /** 트리 — 사람만 */
  createPage: (input: { workspaceId?: string; parentId?: string | null; title: string; beforeId?: string | null; body?: string }) => Promise<PageMeta | null>;
  renamePage: (id: string, title: string) => Promise<SaveState>;
  setIcon: (id: string, icon: string | null) => Promise<SaveState>;
  movePage: (id: string, parentId: string | null, beforeId: string | null) => Promise<SaveState | "cycle" | "cross_workspace" | "gone">;
  reorderPage: (id: string, dir: -1 | 1) => Promise<SaveState>;
  trashPage: (id: string, mode: "with_children" | "lift_children") => Promise<SaveState>;
  restorePage: (id: string) => Promise<SaveState>;
  /** 본문 — 편집기가 바뀐 마크다운을 넘긴다(같으면 저장하지 않는다) */
  saveBody: (id: string, markdown: string) => Promise<SaveState>;
  undoDoc: (id: string, changeId: string) => Promise<SaveState>;
  retry: (id: string) => Promise<void>;
  /** 받은 것 · 자료 */
  addSource: (input: Parameters<typeof newSource>[0], linkTo?: string | null) => Promise<{ source: Source | null; link?: "linked" | "already" | "needs_confirm" }>;
  capture: (text: string) => Promise<Source | null>;
  /** core 가 돌려준 바뀐 조각 · 매니페스트를 저장한다(빼기 · 되돌리기 · 정리 제안 빼기) */
  applyTriage: (r: { manifest?: WorkManifest; sources?: Source[] }) => Promise<SaveState>;
  /** 정리 제안 받기 — 이을 페이지 문서를 읽어 core 에 넘기고, 문서 · 색인 · 조각 · 매니페스트를 저장 */
  acceptTriage: (proposalId: string, opts?: { pageId?: string; title?: string; confirmCross?: boolean }) => Promise<AcceptOutcome>;
  /** 손으로 잇기 */
  linkExisting: (pageId: string, sourceId: string, confirmCross?: boolean) => Promise<"linked" | "already" | "needs_confirm">;
  unlink: (pageId: string, sourceId: string) => Promise<void>;
  prepareTriage: (tool: AiTool) => Promise<{ markdown: string; runId: string; count: number; dropped: number } | null>;
  importTriageText: (text: string, opts: { runId?: string | null; tool?: AiTool }) => Promise<TriageImport | { kind: "save_failed" }>;
  saveManifest: (fn: (m: WorkManifest) => WorkManifest) => Promise<SaveState>;
  /** 본문 제안 */
  proposalBody: (p: BodyProposal) => Promise<string | null>;
  acceptBody: (proposalId: string, opts?: { force?: boolean }) => Promise<AcceptOutcome>;
  rejectBody: (proposalId: string) => Promise<SaveState>;
  /** 결과 원문 · 제안 원문 */
  saveRawText: (hash: string, text: string) => Promise<boolean>;
  rawText: (hash: string) => Promise<string | null>;
  /** 저장소(repo) — 가져오기 · 넘기기가 쓴다 */
  repo: () => Promise<WorkRepo | null>;
  /** 색인 바꾸기(범주 하나) — 최신본에 다시 얹는다 */
  commitPages: (workspaceId: string, fn: (pages: PageMeta[]) => PageMeta[]) => Promise<SaveState>;
  /** Drive */
  connectDrive: () => Promise<void>;
  disconnectDrive: () => Promise<void>;
  pickFromDrive: (linkTo?: string | null) => Promise<{ added: number; folders: number; folderVisible: number } | null>;
  refreshSources: () => Promise<{ changed: number; problems: number }>;
  cachedText: (s: Source) => string | null;
  resolveConflict: (c: ConflictCopy, choice: "mine" | "theirs") => Promise<void>;
  /** 이행 */
  migrateScraps: () => Promise<number>;
  revertMigration: (id: string) => Promise<void>;
}

const Ctx = createContext<WorkApi | null>(null);

function triageLabelsFrom(t: T): TriageLabels {
  const keys = ["title", "meta", "intro", "fragments", "works", "worksNone", "concepts", "conceptsNone", "rulesTitle", "rules", "returnFormat", "returnGuide", "droppedBudget"] as const;
  const keep = Object.fromEntries(["workspace", "run", "at", "count", "titles"].map((k) => [k, `{${k}}`]));
  return Object.fromEntries(keys.map((k) => [k, t(`triagePack.${k}`, keep)])) as unknown as TriageLabels;
}

/** 이행 본문의 고정 문구 — 번역 파일 migrate.* */
export function migrateLabelsFrom(t: T): MigrateLabels {
  const keep = { status: "{status}", importance: "{importance}", due: "{due}" };
  const pick = <K extends string>(prefix: string, keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, t(`${prefix}.${k}`)])) as Record<K, string>;
  return {
    goal: t("migrate.goal"),
    doneCriteria: t("migrate.doneCriteria"),
    summary: t("migrate.summary"),
    decisions: t("migrate.decisions"),
    actions: t("migrate.actions"),
    outputs: t("migrate.outputs"),
    latest: t("migrate.latest"),
    statusLine: t("migrate.statusLine", keep),
    dueSuffix: t("migrate.dueSuffix", keep),
    status: pick("migrate.status", ["planned", "active", "waiting", "blocked", "done", "archived"] as const),
    importance: pick("importance", ["high", "normal", "low"] as const),
    aiSection: t("migrate.aiSection"),
    aiSummary: t("migrate.aiSummary"),
    proposedDecisions: t("migrate.proposedDecisions"),
    openProposals: t("migrate.openProposals"),
    unverified: t("migrate.unverified"),
    proposalKind: pick("migrate.kind", ["task", "due_change", "output_latest", "cross_link"] as const),
    migrationNote: t("migrate.note"),
  };
}

const EMPTY: PagesState = { manifest: defaultManifest({ personal: "", company: "", dev: "", reading: "" }), pages: [], sources: [] };

/** 같은 키의 일을 차례로 — 앞의 것이 끝나야(실패해도) 다음 것 */
function useQueues() {
  const q = useRef(new Map<string, Promise<unknown>>());
  return useCallback(<R,>(key: string, job: () => Promise<R>): Promise<R> => {
    const prev = q.current.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(job);
    q.current.set(key, next);
    void next.finally(() => {
      if (q.current.get(key) === next) q.current.delete(key);
    });
    return next;
  }, []);
}

export function WorkProvider({ children }: { children: React.ReactNode }) {
  const { user, state: legacy } = useData();
  const userRef = useRef(user);
  useLayoutEffect(() => {
    userRef.current = user;
  }, [user]);
  /** 서버 보관을 쓸 수 있나 — Google 로그인 사용자 · 실제 Drive 일 때만(익명 · 개발용 로컬 Drive 는 브라우저 토큰만) */
  const serverCapable = useCallback(() => !localDriveUrl && !!driveConfig && !!userRef.current && !userRef.current.isAnonymous, []);
  /** 서버가 보관한 열쇠로 access token — 팝업 없이. 이어 두지 않았거나 거둬졌으면 null */
  const serverAccess = useCallback(async (): Promise<(DriveToken & { email: string | null }) | null> => {
    if (!serverCapable()) return null;
    try {
      const r = await driveTokenApi({});
      return { token: r.accessToken, expiresAt: r.expiresAt, email: r.email };
    } catch {
      return null;
    }
  }, [serverCapable]);
  const { t } = useI18n();
  const uid = user?.uid ?? null;
  /** 다 읽은 사용자 — 지금 사용자와 같아야 준비된 것 */
  const [loadedUid, setLoadedUid] = useState<string | null>(null);
  const ready = !!uid && loadedUid === uid;
  const [state, setState] = useState<PagesState>(EMPTY);
  const [docs, setDocs] = useState<Record<string, PageDoc>>({});
  const [storage, setStorage] = useState<"device" | "drive">("device");
  const [drive, setDrive] = useState<WorkApi["drive"]>({ status: localDriveUrl ? "disconnected" : !DRIVE_PLATFORM_SUPPORTED ? "unavailable" : driveConfig ? "disconnected" : "not_configured", folderUrl: null, error: null, local: !!localDriveUrl });
  const [saves, setSaves] = useState<WorkApi["saves"]>({});
  const [conflicts, setConflicts] = useState<ConflictCopy[]>([]);
  const [workspaceId, setWorkspaceIdState] = useState("ws-personal");
  const [cacheTick, setCacheTick] = useState(0);
  const repoRef = useRef<WorkRepo | null>(null);
  const stateRef = useRef(state);
  const docsRef = useRef(docs);
  const tokenRef = useRef<DriveToken | null>(null);
  const cacheRef = useRef<Record<string, { version: string; text: string }>>({});
  const tRef = useRef(t);
  const uidRef = useRef(uid);
  const queue = useQueues();
  // 콜백이 늘 지금 값을 읽게 — 렌더가 끝난 뒤 맞춘다
  useLayoutEffect(() => {
    stateRef.current = state;
    tRef.current = t;
    uidRef.current = uid;
  });
  /** 문서는 ref 가 원본 — 차례 기다리던 저장이 렌더 전에 돌아도 가장 최근 것을 쓰게 */
  const updateDocs = useCallback((fn: (m: Record<string, PageDoc>) => Record<string, PageDoc>) => {
    docsRef.current = fn(docsRef.current);
    setDocs(docsRef.current);
  }, []);

  const fallbackManifest = useCallback(() => defaultManifest({ personal: tRef.current("ws.personal"), company: tRef.current("ws.company"), dev: tRef.current("ws.dev"), reading: tRef.current("ws.reading") }), []);
  const deviceStore = useCallback((u: string) => new KvFileStore(kv, `llmwiki:work:${u}:device`), []);

  const driveDeps = useMemo<DriveDeps>(
    () => ({
      fetch: ((url, init) => fetch(url, init as RequestInit)) as Fetch,
      token: () => (tokenRef.current && tokenRef.current.expiresAt > Date.now() ? tokenRef.current.token : null),
      ...(localDriveUrl ? { origin: localDriveUrl } : {}),
    }),
    [],
  );

  const makeDriveStore = useCallback(
    (u: string) => {
      const remote = new DriveFileStore(driveDeps, { root: tRef.current("drive.folder.root"), summaries: tRef.current("drive.folder.summaries"), appData: tRef.current("drive.folder.appData") });
      const mirror = new KvFileStore(kv, `llmwiki:work:${u}:drive-mirror`);
      return { remote, mirror, store: new MirroredStore(remote, mirror, () => driveDeps.token() != null) };
    },
    [driveDeps],
  );

  const newRepo = useCallback((store: FileStore) => new WorkRepo(store, fallbackManifest(), undefined, uidRef.current ? { bodyCache: bodyCacheFor(uidRef.current) } : {}), [fallbackManifest]);

  /**
   * 옛 업무 → 페이지(한 번). 색인에 없는 업무 파일만 읽어 옮긴다. 순서: 원본 보관 → 문서 → 이행 제안(원문 · 매니페스트) → 색인.
   * 중간에 멈춰도 다시 돌리면 이어진다(문서는 있으면 그대로, 같은 제안은 한 번만, 색인은 id 로 합친다).
   * 쓰기가 안 되면(오프라인) 옮긴 모습을 화면에만 보인다 — 저장 실패로 알린다.
   */
  const migrate = useCallback(async (repo: WorkRepo, loaded: PagesState): Promise<{ s: PagesState; docs: PageDoc[]; failed: boolean }> => {
    const ids = await repo.listItemIds().catch(() => [] as string[]);
    const have = new Set(loaded.pages.map((p) => p.id));
    const missing = ids.filter((id) => !have.has(id));
    if (!missing.length) return { s: loaded, docs: [], failed: false };
    const items = await repo.readItems(missing);
    const now = nowIso();
    const L = migrateLabelsFrom(tRef.current);
    const m = migrateToPages(items, loaded.pages, loaded.manifest.workspaces, L, now);
    if (!m.pages.length) return { s: loaded, docs: [], failed: false };
    const pages = [...loaded.pages, ...m.pages];
    let failed = false;
    try {
      for (const a of m.archive) if (!(await repo.writeOnce(PATHS.archiveV2(a.id), a.text)).ok) failed = true;
      for (const d of m.docs) if ((await repo.ensurePageDoc(d, now)).status !== "saved") failed = true;
      let manifest = loaded.manifest;
      for (const p of m.proposals) {
        const r = proposeBody({ manifest, pages }, { pageId: p.pageId, body: p.body, tool: "other", origin: "migration", note: L.migrationNote }, now, { includePrivate: true });
        if (r.kind !== "ok") continue;
        if (!(await repo.saveRaw(r.proposal.rawHash, r.body)).ok) failed = true;
        manifest = r.manifest;
      }
      const record = m.record;
      const mine = record && !manifest.migrations.some((x) => x.kind === "pages_v3" && record.pageIds?.every((id) => x.pageIds?.includes(id))) ? { ...manifest, migrations: [...manifest.migrations, record] } : manifest;
      const saved = await repo.saveManifestWith(loaded.manifest, (cur) => mergeBodyProposals(cur, mine), now);
      if (saved.status === "saved") manifest = saved.value;
      else failed = true;
      for (const ws of [...new Set(m.pages.map((p) => p.workspaceId))]) {
        const add = m.pages.filter((p) => p.workspaceId === ws);
        const r = await repo.saveIndexWith(ws, loaded.pages, (ps) => [...ps, ...add.filter((a) => !ps.some((x) => x.id === a.id))], now);
        if (r.status !== "saved") failed = true;
      }
      return { s: { ...loaded, manifest, pages }, docs: m.docs, failed };
    } catch {
      return { s: { ...loaded, pages }, docs: m.docs, failed: true };
    }
  }, []);

  const readState = useCallback(
    async (repo: WorkRepo, opts: { migrate: boolean }) => {
      const loaded = await repo.loadPages();
      const base: PagesState = { manifest: loaded.manifest, pages: loaded.pages, sources: loaded.sources };
      const mig = opts.migrate ? await migrate(repo, base) : { s: base, docs: [] as PageDoc[], failed: false };
      const pending = uidRef.current ? await readPending(uidRef.current) : [];
      return { ...mig, pending };
    },
    [migrate],
  );

  const loadFrom = useCallback(
    async (store: FileStore) => {
      const repo = newRepo(store);
      const { s, docs: migrated, pending, failed } = await readState(repo, { migrate: true });
      repoRef.current = repo;
      setState(s);
      updateDocs(() => Object.fromEntries([...migrated, ...pending].map((d) => [d.id, d])));
      if (failed) setSaves((m) => ({ ...m, migration: { state: "failed" as SaveState, at: nowIso() } }));
      if (pending.length) setSaves((m) => ({ ...m, ...Object.fromEntries(pending.map((p) => [p.id, { state: "failed" as SaveState, at: nowIso() }])) }));
      // 충돌 사본은 화면을 막지 않고 뒤에서
      void repo
        .listConflicts()
        .then((cs) => setConflicts(cs.filter((c) => !c.resolved)))
        .catch(() => undefined);
      return { repo, s };
    },
    [newRepo, readState, updateDocs],
  );

  /** Drive 에서 다 읽기 전까지 저장은 기다린다 — 기기 사본으로 먼저 보여 준 사이에 누른 것도 잃지 않게 */
  const syncingRef = useRef<Promise<void> | null>(null);
  const getRepo = useCallback(async () => {
    if (!repoRef.current && syncingRef.current) await syncingRef.current;
    return repoRef.current;
  }, []);

  // 처음 · 사용자가 바뀔 때 — 고른 저장소에서 읽는다(Drive 면 토큰이 없으니 사본에서)
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    (async () => {
      const saved = await AsyncStorage.getItem(prefKey(uid, "storage")).catch(() => null);
      let mode: "drive" | "device" = saved === "drive" ? "drive" : "device";
      // 이 기기에서 처음 연다(고른 적 없음 · 기기 저장소도 비었음) — 다른 기기에서 Drive 를 이어 두었으면 그대로 Drive 에서 읽는다
      const deviceEmpty = async () => !(await deviceStore(uid).list("state/").catch(() => [])).length;
      if (saved == null && serverCapable() && (await deviceEmpty())) {
        const st = await driveStatusApi({}).catch(() => null);
        if (st?.linked) {
          mode = "drive";
          await AsyncStorage.setItem(prefKey(uid, "storage"), "drive").catch(() => undefined);
        }
      }
      const cache = await AsyncStorage.getItem(prefKey(uid, "textcache")).catch(() => null);
      cacheRef.current = cache ? (JSON.parse(cache) as typeof cacheRef.current) : {};
      const ws = await AsyncStorage.getItem(prefKey(uid, "workspace")).catch(() => null);
      if (ws) setWorkspaceIdState(ws);
      if (mode === "drive") {
        const { remote, mirror, store } = makeDriveStore(uid);
        // 기기 사본으로 먼저 보여 준다 — Drive 토큰 · 폴더 · 파일 읽기는 수 초 걸릴 수 있다. 다 읽으면 그것으로 바꾼다(사본으로는 이행하지 않는다)
        let synced = () => undefined as void;
        syncingRef.current = new Promise<void>((r) => (synced = r));
        const preview = await readState(newRepo(mirror), { migrate: false }).catch(() => null);
        if (alive && preview && (preview.s.pages.length || preview.s.sources.length)) {
          setState(preview.s);
          setStorage("drive");
          setLoadedUid(uid);
        }
        // 로컬 Drive(개발용)는 동의 화면이 없어 바로 다시 붙는다.
        // 실제 Drive 는 이 탭에 기억한 토큰(sessionStorage · 만료 전)이 있으면 그대로 쓴다 — 새로고침해도 다시 동의하지 않게
        // 그것도 없으면 서버에 이어 둔 열쇠로 새 토큰을 받는다(팝업 없음 — 새 탭에서도 바로 이어진다)
        let server: { linked: boolean; email: string | null } | undefined;
        if (localDriveUrl) tokenRef.current = { token: localDriveToken, expiresAt: Date.now() + 12 * 3600_000 };
        else tokenRef.current = recallDriveToken(uid);
        if (!localDriveUrl && tokenRef.current && serverCapable()) {
          // 탭에 남은 토큰으로 이어졌어도, 서버에 이어 둔 열쇠가 있는지 알아 둔다(만료 때 조용히 새로 받게).
          void driveStatusApi({})
            .then((st) => {
              if (alive && st?.linked) setDrive((d) => ({ ...d, server: { linked: true, email: st.email ?? null } }));
            })
            .catch(() => undefined);
        }
        if (!localDriveUrl && !tokenRef.current) {
          const a = await serverAccess();
          if (a) {
            tokenRef.current = { token: a.token, expiresAt: a.expiresAt };
            rememberDriveToken(uid, tokenRef.current);
            server = { linked: true, email: a.email };
          }
        }
        let folderUrl: string | null = null;
        if (tokenRef.current && !localDriveUrl) {
          try {
            await remote.ensureFolders();
            folderUrl = remote.rootFolderUrl();
          } catch {
            // 기억한 토큰이 취소 · 만료됐다 — 버리고 기기 사본으로 읽는다
            tokenRef.current = null;
            rememberDriveToken(uid, null);
          }
        }
        await loadFrom(store).finally(() => {
          syncingRef.current = null;
          synced();
        });
        if (alive) {
          setStorage("drive");
          setDrive((d) => ({ ...d, status: tokenRef.current ? "connected" : "expired", folderUrl, ...(server ? { server } : {}) }));
        }
      } else {
        await loadFrom(deviceStore(uid));
        if (alive) setStorage("device");
      }
      if (alive) setLoadedUid(uid);
    })().catch(() => alive && setLoadedUid(uid));
    return () => {
      alive = false;
    };
  }, [uid, deviceStore, makeDriveStore, loadFrom, readState, newRepo, serverAccess, serverCapable]);

  const setWorkspaceId = useCallback(
    (id: string) => {
      setWorkspaceIdState(id);
      if (uid) AsyncStorage.setItem(prefKey(uid, "workspace"), id).catch(() => undefined);
    },
    [uid],
  );

  const mark = (key: string, s: SaveState, code?: string) => setSaves((m) => ({ ...m, [key]: { state: s, at: nowIso(), ...(code ? { code } : {}) } }));
  const refreshConflicts = () =>
    repoRef.current
      ?.listConflicts()
      .then((cs) => setConflicts(cs.filter((c) => !c.resolved)))
      .catch(() => undefined);
  const outcome = <V,>(key: string, r: SaveOutcome<V>): SaveState => {
    if (r.status === "saved") {
      mark(key, "saved");
      return "saved";
    }
    if (r.status === "conflict") {
      mark(key, "conflict");
      void refreshConflicts();
      return "conflict";
    }
    mark(key, "failed", r.code);
    if (r.code === "auth_expired") setDrive((d) => (d.status === "connected" ? { ...d, status: "expired" } : d));
    return "failed";
  };

  const putSource = (v: Source) => setState((s) => ({ ...s, sources: s.sources.some((i) => i.id === v.id) ? s.sources.map((i) => (i.id === v.id ? v : i)) : [...s.sources, v] }));
  const putDoc = (d: PageDoc) => updateDocs((m) => ({ ...m, [d.id]: d }));
  const putWsPages = (ws: string, pages: PageMeta[]) => setState((s) => ({ ...s, pages: [...s.pages.filter((p) => p.workspaceId !== ws), ...pages.filter((p) => p.workspaceId === ws)] }));

  /** 색인 바꾸기 — 화면은 먼저 바꾸고(낙관적), 범주마다 차례로 저장하며 다른 곳이 먼저 고쳤으면 최신본에 다시 얹는다 */
  const commitPages = useCallback<WorkApi["commitPages"]>(
    async (ws, fn) => {
      putWsPages(ws, fn(stateRef.current.pages.filter((p) => p.workspaceId === ws)));
      return queue(`index:${ws}`, async () => {
        const repo = await getRepo();
        if (!repo) return "failed" as SaveState;
        mark(`index:${ws}`, "saving");
        const r = await repo.saveIndexWith(ws, stateRef.current.pages, fn, nowIso());
        if (r.status === "saved") putWsPages(ws, r.value);
        else if (r.status === "conflict" && r.remote) putWsPages(ws, r.remote);
        return outcome(`index:${ws}`, r);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getRepo, queue],
  );

  const metaOf = (id: string) => stateRef.current.pages.find((p) => p.id === id);

  /** 문서 쓰기(페이지마다 차례로) — 저장되면 색인의 지문 · 자료 사본을 맞춘다. 실패하면 기기에 잠시 둔다 */
  const saveDoc = useCallback(
    async (next: PageDoc): Promise<SaveState> => {
      putDoc(next);
      return queue(`doc:${next.id}`, async () => {
        const repo = await getRepo();
        if (!repo) return "failed" as SaveState;
        mark(next.id, "saving");
        const latest = docsRef.current[next.id] ?? next;
        const r = await repo.savePageDoc(latest, nowIso());
        const u = uidRef.current;
        if (u) {
          if (r.status === "failed") await AsyncStorage.setItem(pendingKey(u, latest.id), JSON.stringify(latest)).catch(() => undefined);
          else await AsyncStorage.removeItem(pendingKey(u, latest.id)).catch(() => undefined);
        }
        if (r.status === "saved") {
          // 저장 중에 더 고친 것이 있으면 rev 만 받아 둔다(다음 저장이 이어 쓴다)
          updateDocs((m) => ({ ...m, [latest.id]: m[latest.id] && m[latest.id] !== latest ? { ...m[latest.id], rev: r.value.rev } : r.value }));
          const meta = metaOf(latest.id);
          if (meta) await commitPages(meta.workspaceId, (ps) => ps.map((p) => (p.id === latest.id ? syncMeta(p, r.value, nowIso()) : p)));
        } else if (r.status === "conflict" && r.remote) putDoc(r.remote);
        return outcome(latest.id, r);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getRepo, queue, commitPages],
  );

  const openDoc = useCallback<WorkApi["openDoc"]>(
    async (id) => {
      const have = docsRef.current[id];
      if (have) return have;
      const meta = metaOf(id);
      const repo = await getRepo();
      if (!meta || !repo) return null;
      const d = await repo.readDoc(meta).catch(() => null);
      if (d) putDoc(d);
      return d;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getRepo],
  );

  const readBodies = useCallback<WorkApi["readBodies"]>(async (metas) => {
    const repo = await getRepo();
    if (!repo) return new Map();
    return repo.readBodies(metas);
  }, [getRepo]);

  /* ───────── 트리 ───────── */

  const createPage = useCallback<WorkApi["createPage"]>(
    async (input) => {
      const ws = input.workspaceId ?? workspaceId;
      const r = createPageCore(stateRef.current.pages, { workspaceId: ws, parentId: input.parentId ?? null, title: input.title, beforeId: input.beforeId, body: input.body }, nowIso());
      if (r.kind !== "ok") return null;
      putDoc(r.doc);
      // 문서를 먼저 — 색인이 문서 없는 페이지를 가리키지 않게
      const repo = await getRepo();
      if (!repo) return null;
      const d = await queue(`doc:${r.doc.id}`, () => repo.savePageDoc(r.doc, nowIso()));
      if (d.status === "saved") putDoc(d.value);
      outcome(r.doc.id, d);
      const page = r.page;
      await commitPages(ws, (ps) => (ps.some((p) => p.id === page.id) ? ps : [...ps, page]));
      return page;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId, getRepo, queue, commitPages],
  );

  const onMeta = useCallback(
    (id: string, fn: (pages: PageMeta[]) => PageMeta[]) => {
      const meta = metaOf(id);
      if (!meta) return Promise.resolve("failed" as SaveState);
      return commitPages(meta.workspaceId, fn);
    },
     
    [commitPages],
  );

  const renamePage = useCallback<WorkApi["renamePage"]>((id, title) => onMeta(id, (ps) => renamePageCore(ps, id, title, nowIso())), [onMeta]);
  const setIcon = useCallback<WorkApi["setIcon"]>((id, icon) => onMeta(id, (ps) => setPageIcon(ps, id, icon, nowIso())), [onMeta]);
  const reorderPage = useCallback<WorkApi["reorderPage"]>(
    (id, dir) => {
      // 지금 보이는 순서로 옮길 자리를 정하고(다시 얹어도 같은 자리), 옮기기로 쓴다
      const before = reorderPageCore(stateRef.current.pages, id, dir, nowIso());
      const moved = before.find((p) => p.id === id);
      if (!moved) return Promise.resolve("saved" as SaveState);
      const sibs = childrenOf(before, moved.workspaceId, moved.parentId);
      const next = sibs[sibs.findIndex((p) => p.id === id) + 1]?.id ?? null;
      return onMeta(id, (ps) => {
        const r = movePageCore(ps, id, moved.parentId, next, nowIso());
        return r.kind === "ok" ? r.pages : ps;
      });
    },
    [onMeta],
  );
  const trashPage = useCallback<WorkApi["trashPage"]>((id, mode) => onMeta(id, (ps) => trashPageCore(ps, id, mode, nowIso()).pages), [onMeta]);
  const restorePage = useCallback<WorkApi["restorePage"]>((id) => onMeta(id, (ps) => restorePageCore(ps, id, nowIso())), [onMeta]);
  const movePage = useCallback<WorkApi["movePage"]>(
    async (id, parentId, beforeId) => {
      const r = movePageCore(stateRef.current.pages, id, parentId, beforeId, nowIso());
      if (r.kind !== "ok") return r.kind;
      return onMeta(id, (ps) => {
        const again = movePageCore(ps, id, parentId, beforeId, nowIso());
        return again.kind === "ok" ? again.pages : ps;
      });
    },
    [onMeta],
  );

  /* ───────── 본문 ───────── */

  const saveBody = useCallback<WorkApi["saveBody"]>(
    async (id, markdown) => {
      const cur = docsRef.current[id] ?? (await openDoc(id));
      if (!cur) return "failed";
      const next = editBody(cur, markdown, nowIso());
      if (next === cur) return "saved";
      return saveDoc(next);
    },
    [openDoc, saveDoc],
  );

  const undoDoc = useCallback<WorkApi["undoDoc"]>(
    async (id, changeId) => {
      const cur = docsRef.current[id];
      if (!cur) return "failed";
      const r = undoDocCore(cur, changeId, nowIso());
      return r.ok ? saveDoc(r.doc) : "saved";
    },
    [saveDoc],
  );

  const retry = useCallback(
    async (id: string) => {
      const cur = docsRef.current[id];
      if (cur) await saveDoc(cur);
    },
    [saveDoc],
  );

  /* ───────── 받은 것 · 자료 ───────── */

  const saveSource = useCallback(
    async (src: Source) => {
      const repo = await getRepo();
      if (!repo) return "failed" as SaveState;
      putSource(src);
      mark(src.id, "saving");
      const r = await repo.saveSource(src, nowIso());
      if (r.status === "saved") putSource(r.value);
      else if (r.status === "conflict" && r.remote) putSource(r.remote);
      return outcome(src.id, r);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getRepo],
  );

  const saveManifest = useCallback<WorkApi["saveManifest"]>(
    async (fn) => {
      const repo = await getRepo();
      if (!repo) return "failed";
      setState((s) => ({ ...s, manifest: fn(s.manifest) }));
      return queue("manifest", async () => {
        mark("manifest", "saving");
        // 다른 곳(다른 기기 · MCP)이 먼저 고쳤으면 그 최신본에 같은 바꿈을 다시 얹는다
        const r = await repo.saveManifestWith(stateRef.current.manifest, fn, nowIso());
        if (r.status === "saved") setState((s) => ({ ...s, manifest: r.value }));
        else if (r.status === "conflict" && r.remote) setState((s) => ({ ...s, manifest: r.remote as WorkManifest }));
        return outcome("manifest", r);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getRepo, queue],
  );

  const linkExisting = useCallback<WorkApi["linkExisting"]>(
    async (pageId, sourceId, confirmCross) => {
      const meta = metaOf(pageId);
      const src = stateRef.current.sources.find((s) => s.id === sourceId);
      const doc = meta ? await openDoc(pageId) : null;
      if (!meta || !src || !doc) return "already";
      if (doc.sourceIds.includes(sourceId)) return "already";
      const r = fileSource(meta, doc, src, nowIso(), { confirmCross });
      if (r.kind === "needs_confirm") return "needs_confirm";
      if (r.source !== src) await saveSource(r.source);
      await saveDoc(r.doc);
      return "linked";
    },
     
    [openDoc, saveDoc, saveSource],
  );

  const unlink = useCallback(
    async (pageId: string, sourceId: string) => {
      const doc = await openDoc(pageId);
      if (doc) await saveDoc(unlinkSourceFromPage(doc, sourceId, nowIso()));
    },
    [openDoc, saveDoc],
  );

  const addSource = useCallback<WorkApi["addSource"]>(
    async (input, linkTo) => {
      const same = findSameSource(stateRef.current.sources, { workspaceId: input.workspaceId, provider: input.provider, externalId: input.externalId, url: input.url });
      let src = same;
      if (!src) {
        src = newSource(input, nowIso());
        const s = await saveSource(src);
        if (s === "failed") return { source: null };
      }
      if (!linkTo) return { source: src };
      return { source: src, link: await linkExisting(linkTo, src.id) };
    },
    [saveSource, linkExisting],
  );

  const capture = useCallback<WorkApi["capture"]>(
    async (text) => {
      const v = text.trim();
      if (!v) return null;
      const isUrl = /^https?:\/\/\S+$/.test(v);
      const meta = { workspaceId, triage: "inbox" as const, origin: { via: "app" as const } };
      const r = await addSource(isUrl ? { ...meta, provider: "link", title: v, url: v } : { ...meta, provider: "paste", title: v.split("\n")[0].slice(0, 80), text: v });
      return r.source;
    },
    [addSource, workspaceId],
  );

  const applyTriage = useCallback<WorkApi["applyTriage"]>(
    async (r) => {
      const results: SaveState[] = [];
      for (const s of r.sources ?? []) results.push(await saveSource(s));
      if (r.manifest) {
        const m = r.manifest;
        results.push(await saveManifest((cur) => mergeTriage(cur, m)));
      }
      return results.find((x) => x !== "saved") ?? "saved";
    },
    [saveSource, saveManifest],
  );

  const acceptTriage = useCallback<WorkApi["acceptTriage"]>(
    async (proposalId, opts = {}) => {
      let r = acceptTriageCore(stateRef.current, proposalId, nowIso(), opts);
      if (r.kind === "needs_doc") {
        const doc = await openDoc(r.pageId);
        if (!doc) return "gone";
        r = acceptTriageCore(stateRef.current, proposalId, nowIso(), { ...opts, doc });
      }
      if (r.kind === "needs_confirm" || r.kind === "gone") return r.kind;
      if (r.kind !== "ok") return "failed";
      const results: SaveState[] = [];
      if (r.doc) {
        const doc = r.doc;
        const created = r.createdPageId && r.pages?.find((p) => p.id === r.createdPageId);
        if (created) {
          // 새 페이지 — 문서를 먼저, 그다음 색인
          const repo = await getRepo();
          if (!repo) return "failed";
          putDoc(doc);
          const d = await queue(`doc:${doc.id}`, () => repo.savePageDoc(doc, nowIso()));
          if (d.status === "saved") putDoc(d.value);
          results.push(outcome(doc.id, d));
          results.push(await commitPages(created.workspaceId, (ps) => (ps.some((p) => p.id === created.id) ? ps : [...ps, created])));
        } else results.push(await saveDoc(doc));
      }
      for (const s of r.sources) results.push(await saveSource(s));
      const m = r.manifest;
      results.push(await saveManifest((cur) => mergeTriage(cur, m)));
      return results.find((x) => x !== "saved") ?? "saved";
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openDoc, getRepo, queue, commitPages, saveDoc, saveSource, saveManifest],
  );

  const cachedText = useCallback((s: Source): string | null => {
    if (s.text != null) return s.text;
    const c = cacheRef.current[s.id];
    if (!c) return null;
    return c.version === s.remoteVersion ? c.text : `${tRef.current("handoff.excerptOld", { version: c.version })}\n${c.text}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheTick]);

  const prepareTriage = useCallback<WorkApi["prepareTriage"]>(
    async (tool) => {
      const r = prepareTriagePack(stateRef.current, workspaceId, { tool }, triageLabelsFrom(tRef.current), nowIso(), cachedText);
      if (!r) return null;
      // 기록이 저장되지 않아도 묶음은 복사할 수 있다 — 다만 그러면 가져올 때 S1 · P1 을 되짚지 못한다
      await saveManifest((cur) => mergeTriage(cur, r.manifest));
      return { markdown: r.markdown, runId: r.run.id, count: r.run.sourceIds.length, dropped: r.dropped.length };
    },
    [workspaceId, cachedText, saveManifest],
  );

  const importTriageText = useCallback<WorkApi["importTriageText"]>(
    async (text, opts) => {
      const repo = await getRepo();
      if (!repo) return { kind: "save_failed" };
      const r = importTriage(stateRef.current, text, nowIso(), opts);
      if (r.kind !== "imported") return r;
      const raw = await repo.saveRaw(r.rawHash, text);
      if (!raw.ok) return { kind: "save_failed" };
      const s = await saveManifest((cur) => mergeTriage(cur, r.manifest));
      return s === "saved" ? r : { kind: "save_failed" };
    },
    [getRepo, saveManifest],
  );

  /* ───────── 본문 제안 ───────── */

  const rawText = useCallback(async (hash: string) => (await (await getRepo())?.readRaw(hash).catch(() => null)) ?? null, [getRepo]);
  const saveRawText = useCallback(async (hash: string, text: string) => !!(await (await getRepo())?.saveRaw(hash, text))?.ok, [getRepo]);
  const proposalBody = useCallback<WorkApi["proposalBody"]>((p) => rawText(p.rawHash), [rawText]);

  const acceptBody = useCallback<WorkApi["acceptBody"]>(
    async (proposalId, opts = {}) => {
      const p = (stateRef.current.manifest.bodyProposals ?? []).find((x) => x.id === proposalId);
      const meta = p ? metaOf(p.pageId) : undefined;
      if (!p || !meta) return "gone";
      const [doc, body] = await Promise.all([openDoc(meta.id), rawText(p.rawHash)]);
      if (!doc || body == null) return "gone";
      const r = acceptBodyProposal(stateRef.current.manifest, meta, doc, proposalId, body, nowIso(), opts);
      if (r.kind !== "ok") return r.kind;
      // 문서(본문 + 되돌리기) → 색인 → 매니페스트(제안 받음)
      const d = await saveDoc(r.doc);
      if (d !== "saved") return d;
      const m = r.manifest;
      return saveManifest((cur) => mergeBodyProposals(cur, m));
    },
     
    [openDoc, rawText, saveDoc, saveManifest],
  );

  const rejectBody = useCallback<WorkApi["rejectBody"]>((proposalId) => saveManifest((cur) => rejectBodyProposal(cur, proposalId, nowIso())), [saveManifest]);

  /* ───────── Drive ───────── */

  const saveCache = useCallback(() => {
    if (!uid) return;
    AsyncStorage.setItem(prefKey(uid, "textcache"), JSON.stringify(cacheRef.current)).catch(() => undefined);
    setCacheTick((x) => x + 1);
  }, [uid]);

  const connectDrive = useCallback(async () => {
    if (!uid) return;
    setDrive((d) => ({ ...d, status: "connecting", error: null }));
    try {
      // 로컬 Drive(개발용)는 OAuth 없이 고정 개발 토큰 — 실제 Google 동의가 아니다
      // Google 로그인 사용자는 코드 방식으로 받아 서버가 열쇠를 암호화해 이어 둔다(이후 팝업 없이 이어 쓰기)
      let server: { linked: boolean; email: string | null } | undefined;
      if (localDriveUrl) tokenRef.current = { token: localDriveToken, expiresAt: Date.now() + 12 * 3600_000 };
      else if (serverCapable()) {
        const code = await requestDriveCode({ hint: user?.email ?? null });
        const r = await driveLinkApi({ code });
        tokenRef.current = { token: r.accessToken, expiresAt: r.expiresAt };
        server = { linked: true, email: r.email };
      } else tokenRef.current = await requestDriveToken({ interactive: storage !== "drive", hint: user?.email ?? null });
      if (!localDriveUrl) rememberDriveToken(uid, tokenRef.current);
      const { remote, store } = makeDriveStore(uid);
      await remote.ensureFolders();
      // 기기에만 있던 작업실을 Drive 로 복사(기기 쪽은 남긴다). Drive 에 이미 있는 파일은 건드리지 않는다
      if (storage === "device") await copyStore(deviceStore(uid), store);
      // 끊긴 동안 저장하지 못한 문서 — 다시 읽은 뒤 다시 저장한다(바깥에서 바뀌었으면 충돌 사본으로, 조용히 버리지 않는다)
      await loadFrom(store);
      const unsaved = await readPending(uid);
      setDrive({ status: "connected", folderUrl: localDriveUrl ? null : remote.rootFolderUrl(), error: null, local: !!localDriveUrl, ...(server ? { server } : {}) });
      for (const d of unsaved) await saveDoc(d);
      await AsyncStorage.setItem(prefKey(uid, "storage"), "drive");
      setStorage("drive");
    } catch (e) {
      const reason = (e as { details?: { reason?: string } })?.details?.reason;
      const code = e instanceof DriveAuthError ? e.code : (reason ?? (e as { code?: string })?.code ?? errorText(e) ?? "failed");
      setDrive((d) => ({ ...d, status: code === "cancelled" ? (storage === "drive" ? "expired" : "disconnected") : "error", error: code }));
    }
  }, [uid, user, makeDriveStore, storage, deviceStore, loadFrom, saveDoc, serverCapable]);

  // 토큰이 끝나는 순간 '만료' 로 바꾼다 — 화면 위 알림이 한 번 눌러 다시 받게 한다(저장이 조용히 실패하지 않게)
  useEffect(() => {
    if (!uid || storage !== "drive" || drive.status !== "connected" || drive.local || !tokenRef.current) return;
    const left = tokenRef.current.expiresAt - Date.now();
    // 서버에 열쇠를 이어 두었으면 끝나기 2분 전에 조용히 새로 받는다(팝업 없음). 안 되면 '만료' 로
    const linked = !!drive.server?.linked;
    const timer = setTimeout(
      async () => {
        const a = linked ? await serverAccess() : null;
        if (a) {
          tokenRef.current = { token: a.token, expiresAt: a.expiresAt };
          rememberDriveToken(uid, tokenRef.current);
          setDrive((d) => ({ ...d }));
          return;
        }
        tokenRef.current = null;
        rememberDriveToken(uid, null);
        setDrive((d) => (d.status === "connected" ? { ...d, status: "expired", ...(linked ? { server: { linked: false, email: null } } : {}) } : d));
      },
      Math.max(0, left - (linked ? 120_000 : 0)),
    );
    return () => clearTimeout(timer);
    // drive 객체가 바뀔 때(새 토큰을 받은 뒤 포함) 타이머를 다시 건다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, storage, drive]);

  const disconnectDrive = useCallback(async () => {
    if (!uid) return;
    // 서버에 이어 둔 열쇠가 있으면 Google 에서 거두고 보관본을 지운다
    if (serverCapable()) await driveUnlinkApi({}).catch(() => undefined);
    if (tokenRef.current) revokeDriveToken(tokenRef.current.token);
    tokenRef.current = null;
    rememberDriveToken(uid, null);
    await AsyncStorage.setItem(prefKey(uid, "storage"), "device");
    // Drive 의 파일은 지우지 않는다. 기기 저장소로 돌아간다(Drive 에서 바꾼 것은 기기에 없을 수 있다 — 안내한다)
    await loadFrom(deviceStore(uid));
    setStorage("device");
    setDrive({ status: driveConfig || localDriveUrl ? "disconnected" : "not_configured", folderUrl: null, error: null, local: !!localDriveUrl });
  }, [uid, deviceStore, loadFrom, serverCapable]);

  const ingest = useCallback(
    async (src: Source): Promise<Source> => {
      if (src.provider !== "drive" || !src.externalId) return src;
      const m = await getMeta(driveDeps, src.externalId);
      if (!m.ok) return applyRemoteMeta(src, { ok: false, status: m.status, error: m.error }, nowIso());
      let next = applyRemoteMeta(src, { ok: true, title: m.meta.name, version: m.meta.version ?? null, modifiedAt: m.meta.modifiedTime ?? null, url: m.meta.webViewLink ?? null, mimeType: m.meta.mimeType }, nowIso());
      if (!readPlan(m.meta.mimeType)) return { ...next, format: formatOf(m.meta.mimeType), ingest: { status: "unsupported", at: nowIso() } };
      if (next.processedVersion !== next.remoteVersion || !cacheRef.current[src.id]) {
        const txt = await readText(driveDeps, m.meta);
        if (txt.ok) {
          cacheRef.current[src.id] = { version: String(next.remoteVersion), text: txt.text };
          next = { ...next, processedVersion: next.remoteVersion, ingest: { status: "ok", at: nowIso() } };
        } else next = { ...next, ingest: { status: txt.status, error: txt.error ?? null, at: nowIso() } };
      }
      return next;
    },
    [driveDeps],
  );

  const pickFromDrive = useCallback<WorkApi["pickFromDrive"]>(
    async (linkTo) => {
      const tok = driveDeps.token();
      if (!tok) {
        setDrive((d) => ({ ...d, status: storage === "drive" ? "expired" : d.status }));
        return null;
      }
      const picked = localDriveUrl ? await requestLocalPick() : await pickDriveFiles(tok);
      if (!picked) return null;
      const ws = linkTo ? (metaOf(linkTo)?.workspaceId ?? workspaceId) : workspaceId;
      let added = 0;
      let folders = 0;
      let folderVisible = 0;
      for (const f of picked) {
        const files = [f];
        if (f.mimeType === "application/vnd.google-apps.folder") {
          folders++;
          // 폴더 안에서 실제로 보이는 파일만 — drive.file 은 안 고른 파일을 보여 주지 않을 수 있다
          const kids = await listFolder(driveDeps, f.id).catch(() => []);
          folderVisible += kids.length;
          files.splice(0, 1, ...kids.filter((k) => k.mimeType !== "application/vnd.google-apps.folder").map((k) => ({ id: k.id, name: k.name, mimeType: k.mimeType, url: k.webViewLink ?? null })));
        }
        for (const file of files) {
          const base = newSource({ workspaceId: ws, provider: "drive", externalId: file.id, title: file.name, mimeType: file.mimeType, format: formatOf(file.mimeType), url: file.url }, nowIso());
          const existing = findSameSource(stateRef.current.sources, base);
          const src = existing ?? (await ingest(base));
          if (!existing) {
            const s = await saveSource(src);
            if (s === "failed") continue;
            added++;
          }
          if (linkTo) await linkExisting(linkTo, src.id);
        }
      }
      saveCache();
      return { added, folders, folderVisible };
    },
     
    [driveDeps, storage, workspaceId, ingest, saveSource, linkExisting, saveCache],
  );

  /** 연결된 Drive 자료의 버전을 다시 본다 */
  const refreshSources = useCallback(async () => {
    let changed = 0;
    let problems = 0;
    if (!driveDeps.token()) return { changed, problems };
    for (const src of stateRef.current.sources.filter((s) => s.provider === "drive")) {
      const next = await ingest(src);
      if (next.remoteVersion !== src.remoteVersion) changed++;
      if (!["ok", "unsupported"].includes(next.ingest.status)) problems++;
      if (JSON.stringify({ ...next, updatedAt: "" }) !== JSON.stringify({ ...src, updatedAt: "" })) await saveSource(next);
    }
    saveCache();
    return { changed, problems };
  }, [driveDeps, ingest, saveSource, saveCache]);

  const resolveConflict = useCallback(async (c: ConflictCopy, choice: "mine" | "theirs") => {
    const repo = repoRef.current;
    if (!repo) return;
    await repo.resolveConflict(c, choice, nowIso());
    const s = await repo.loadPages();
    setState({ manifest: s.manifest, pages: s.pages, sources: s.sources });
    // 고른 쪽 문서를 다시 읽게 비운다
    const id = /^state\/pages\/(.+)\.json$/.exec(c.path)?.[1];
    if (id) updateDocs((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== id)));
    setConflicts((await repo.listConflicts()).filter((x) => !x.resolved));
  }, [updateDocs]);

  /* ───────── 이행(옛 Firestore 기록) ───────── */

  const migrateScraps = useCallback(async () => {
    const plan = planScrapMigration(stateRef.current, legacy.scraps as Scrap[], "ws-personal", nowIso());
    if (!plan.record) return 0;
    let ok: string[] = [];
    for (const s of plan.sources) if ((await saveSource(s)) !== "failed") ok = [...ok, s.id];
    if (!ok.length) return 0;
    await saveManifest((m) => ({ ...m, migrations: [...m.migrations, { ...plan.record!, sourceIds: ok }] }));
    return ok.length;
  }, [legacy.scraps, saveSource, saveManifest]);

  const revertMigration = useCallback(
    async (id: string) => {
      const repo = repoRef.current;
      if (!repo) return;
      const plan = planRevert(stateRef.current, id);
      for (const pageId of plan.pageIds) {
        let doc = await openDoc(pageId);
        if (!doc) continue;
        for (const sid of plan.removeSourceIds) doc = unlinkSourceFromPage(doc, sid, nowIso());
        await saveDoc(doc);
      }
      for (const sid of plan.removeSourceIds) await repo.removeSource(sid).catch(() => undefined);
      setState((s) => ({ ...s, sources: s.sources.filter((x) => !plan.removeSourceIds.includes(x.id)) }));
      await saveManifest((m) => ({ ...m, migrations: m.migrations.map((x) => (x.id === id ? { ...x, reverted: true } : x)) }));
    },
    [openDoc, saveDoc, saveManifest],
  );

  const repo = useCallback(() => getRepo(), [getRepo]);

  const api = useMemo<WorkApi>(
    () => ({
      ready,
      state,
      storage,
      drive,
      saves,
      conflicts,
      workspaceId,
      setWorkspaceId,
      docs,
      openDoc,
      readBodies,
      createPage,
      renamePage,
      setIcon,
      movePage,
      reorderPage,
      trashPage,
      restorePage,
      saveBody,
      undoDoc,
      retry,
      addSource,
      capture,
      applyTriage,
      acceptTriage,
      linkExisting,
      unlink,
      prepareTriage,
      importTriageText,
      saveManifest,
      proposalBody,
      acceptBody,
      rejectBody,
      saveRawText,
      rawText,
      repo,
      commitPages,
      connectDrive,
      disconnectDrive,
      pickFromDrive,
      refreshSources,
      cachedText,
      resolveConflict,
      migrateScraps,
      revertMigration,
    }),
    [ready, state, storage, drive, saves, conflicts, workspaceId, setWorkspaceId, docs, openDoc, readBodies, createPage, renamePage, setIcon, movePage, reorderPage, trashPage, restorePage, saveBody, undoDoc, retry, addSource, capture, applyTriage, acceptTriage, linkExisting, unlink, prepareTriage, importTriageText, saveManifest, proposalBody, acceptBody, rejectBody, saveRawText, rawText, repo, commitPages, connectDrive, disconnectDrive, pickFromDrive, refreshSources, cachedText, resolveConflict, migrateScraps, revertMigration],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useWork(): WorkApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWork must be used inside WorkProvider");
  return v;
}
