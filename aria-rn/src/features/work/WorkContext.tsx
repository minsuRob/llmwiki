/**
 * 작업실 상태 — 업무 · 자료 · 결정 · AI 작업 · 결과물. Firestore 를 쓰지 않는다.
 *
 * 저장소
 * - 기본: 기기 저장소(AsyncStorage · 웹은 localStorage). 사용자(uid)마다 공간을 나눈다.
 * - Drive 를 이으면: 내 드라이브의 앱 폴더(drive.file)에 쓰고 기기에 사본을 둔다. 연결이 끊기면 사본으로 읽기만.
 * - 의미 있는 변경(버튼 한 번)마다 그 업무 파일 하나만 쓴다. 실패 · 충돌은 그대로 화면에 알린다(저장됨으로 치지 않는다).
 * 저장 · 동기화 · AI 정리 상태를 따로 들고 있다.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { DriveFileStore, getMeta, listFolder, readText, formatOf, readPlan, type DriveDeps, type Fetch } from "../../../../packages/core/src/drive.ts";
import type { Scrap } from "../../../../packages/core/src/types.ts";
import {
  addOutput,
  applyRemoteMeta,
  createWorkItem,
  defaultManifest,
  findSameSource,
  linkSource,
  mergeTriage,
  newSource,
  undoChange,
  unlinkSource,
  type AiTool,
  type Importance,
  type Source,
  type TemplateKey,
  type TemplateText,
  type WorkItem,
  type WorkManifest,
  type WorkState,
} from "../../../../packages/core/src/work.ts";
import { importResult, prepareRun, type HandoffLabels, type ImportResult } from "../../../../packages/core/src/workHandoff.ts";
import { importTriage, prepareTriage as prepareTriagePack, type TriageImport, type TriageLabels } from "../../../../packages/core/src/workTriage.ts";
import { planRevert, planScrapMigration } from "../../../../packages/core/src/workMigrate.ts";
import { copyStore, KvFileStore, MirroredStore, WorkRepo, type ConflictCopy, type FileStore, type KV, type SaveOutcome } from "../../../../packages/core/src/workStore.ts";
import { dictOf, useI18n, type T } from "../../i18n";
import { driveLink as driveLinkApi, driveStatus as driveStatusApi, driveToken as driveTokenApi, driveUnlink as driveUnlinkApi, errorText } from "../../firebase/api";
import { useData } from "../../firebase/data";
import { driveConfig, localDriveToken, localDriveUrl } from "./drive/config";
import { requestLocalPick } from "./drive/LocalDrivePicker";
import { DRIVE_PLATFORM_SUPPORTED, DriveAuthError, pickDriveFiles, recallDriveToken, rememberDriveToken, requestDriveCode, requestDriveToken, revokeDriveToken, type DriveToken } from "./drive/googleDrive";
import { renderSummaryMarkdown } from "./summaryMarkdown";

export type SaveState = "saving" | "saved" | "failed" | "conflict";
export type DriveStatus = "unavailable" | "not_configured" | "disconnected" | "connecting" | "connected" | "expired" | "error";

const kv: KV = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
  getAllKeys: () => AsyncStorage.getAllKeys(),
};

const nowIso = () => new Date().toISOString();

const prefKey = (u: string, k: string) => `llmwiki:work:${u}:${k}`;
/** 저장하지 못한 업무 — 새로 고침 · 앱을 닫아도 남게 기기에 잠시 둔다(저장된 것으로 치지 않는다). 다시 저장되면 지운다 */
const pendingKey = (u: string, id: string) => prefKey(u, `pending:${id}`);
async function readPending(u: string): Promise<WorkItem[]> {
  const keys = (await AsyncStorage.getAllKeys().catch(() => [] as readonly string[])).filter((k) => k.startsWith(prefKey(u, "pending:")));
  const out: WorkItem[] = [];
  for (const k of keys) {
    const v = await AsyncStorage.getItem(k).catch(() => null);
    if (v) out.push(JSON.parse(v) as WorkItem);
  }
  return out;
}

interface WorkApi {
  ready: boolean;
  state: WorkState;
  storage: "device" | "drive";
  /** server: 서버(Functions)에 Drive 열쇠를 이어 두었나 — 이어 두면 새 탭 · 만료 때 팝업 없이 이어 쓴다 */
  drive: { status: DriveStatus; folderUrl: string | null; error: string | null; local: boolean; server?: { linked: boolean; email: string | null } };
  saves: Record<string, { state: SaveState; at: string; code?: string }>;
  conflicts: ConflictCopy[];
  workspaceId: string;
  setWorkspaceId: (id: string) => void;
  /** 업무 하나를 바꾸고 저장한다 */
  update: (itemId: string, fn: (item: WorkItem) => WorkItem) => Promise<SaveState>;
  retry: (itemId: string) => Promise<void>;
  createItem: (input: { workspaceId: string; title: string; templateKey?: TemplateKey | null; due?: string | null; importance?: Importance }) => Promise<WorkItem | null>;
  addSource: (input: Parameters<typeof newSource>[0], linkTo?: string | null) => Promise<{ source: Source | null; link?: "linked" | "already" | "needs_confirm" }>;
  /** 받은 것 — 조각 하나를 던진다(이 범주의 정리 대기로). 묻지 않는다 */
  capture: (text: string) => Promise<Source | null>;
  /** 받은 것 — core 가 돌려준 바뀐 업무 · 조각 · 매니페스트를 저장한다 */
  applyTriage: (r: { manifest?: WorkManifest; items?: WorkItem[]; sources?: Source[] }) => Promise<SaveState>;
  /** 받은 것 — 이 범주의 정리 대기 조각을 Claude · Codex 에 보낼 정리 묶음으로. 조각이 없으면 null */
  prepareTriage: (tool: AiTool) => Promise<{ markdown: string; runId: string; count: number; dropped: number } | null>;
  /** 받은 것 — 돌아온 정리 결과를 제안으로 들인다(원문은 raw/ 에 먼저) */
  importTriageText: (text: string, opts: { runId?: string | null; tool?: AiTool }) => Promise<TriageImport | { kind: "save_failed" }>;
  linkExisting: (itemId: string, sourceId: string, confirmCross?: boolean) => Promise<"linked" | "already" | "needs_confirm">;
  unlink: (itemId: string, sourceId: string) => Promise<void>;
  saveManifest: (fn: (m: WorkManifest) => WorkManifest) => Promise<SaveState>;
  prepare: (itemId: string, input: { tool: AiTool; scope: string; doneCriteria: string; includeCross?: boolean }) => Promise<{ markdown: string; runId: string; excluded: number; dropped: number } | null>;
  importText: (itemId: string, text: string, opts: { runId?: string | null; tool?: AiTool }) => Promise<ImportResult | { kind: "save_failed" }>;
  undo: (itemId: string, changeId: string) => Promise<void>;
  rawText: (hash: string) => Promise<string | null>;
  /** Drive */
  connectDrive: () => Promise<void>;
  disconnectDrive: () => Promise<void>;
  pickFromDrive: (linkTo?: string | null) => Promise<{ added: number; folders: number; folderVisible: number } | null>;
  /** Drive 에 있는 결과물 파일을 업무의 결과물로(초안) 잇는다 */
  pickDriveOutput: (itemId: string) => Promise<number | null>;
  refreshSources: () => Promise<{ changed: number; problems: number }>;
  cachedText: (s: Source) => string | null;
  resolveConflict: (c: ConflictCopy, choice: "mine" | "theirs") => Promise<void>;
  /** 이행 */
  migrateScraps: () => Promise<number>;
  revertMigration: (id: string) => Promise<void>;
  handoffLabels: () => HandoffLabels;
  templateText: (key: TemplateKey) => TemplateText;
}

const Ctx = createContext<WorkApi | null>(null);

function triageLabelsFrom(t: T): TriageLabels {
  const keys = ["title", "meta", "intro", "fragments", "works", "worksNone", "concepts", "conceptsNone", "rulesTitle", "rules", "returnFormat", "returnGuide", "droppedBudget"] as const;
  const keep = Object.fromEntries(["workspace", "run", "at", "count", "titles"].map((k) => [k, `{${k}}`]));
  return Object.fromEntries(keys.map((k) => [k, t(`triagePack.${k}`, keep)])) as unknown as TriageLabels;
}

function labelsFrom(t: T): HandoffLabels {
  const keys = ["title", "meta", "goal", "doneCriteria", "status", "summaryNone", "summaryStale", "decisions", "decisionsNone", "sources", "sourcesNone", "sourceAccess", "sourceNoExcerpt", "excludedCross", "scope", "taskDone", "openQuestions", "openNone", "nextActions", "returnFormat", "returnGuide", "rules", "rulesTitle", "droppedBudget"] as const;
  // 자리표시({title} 등)는 core 가 채운다 — 여기서는 비워 두지 않도록 그대로 돌려준다
  const keep = Object.fromEntries(["title", "workspace", "version", "run", "at", "titles", "count"].map((k) => [k, `{${k}}`]));
  return Object.fromEntries(keys.map((k) => [k, t(`handoff.pack.${k}`, keep)])) as unknown as HandoffLabels;
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
  const { t, lang } = useI18n();
  const uid = user?.uid ?? null;
  /** 다 읽은 사용자 — 지금 사용자와 같아야 준비된 것 */
  const [loadedUid, setLoadedUid] = useState<string | null>(null);
  const ready = !!uid && loadedUid === uid;
  const [state, setState] = useState<WorkState>({ manifest: defaultManifest({ personal: "", company: "", dev: "", reading: "" }), items: [], sources: [] });
  const [storage, setStorage] = useState<"device" | "drive">("device");
  const [drive, setDrive] = useState<WorkApi["drive"]>({ status: localDriveUrl ? "disconnected" : !DRIVE_PLATFORM_SUPPORTED ? "unavailable" : driveConfig ? "disconnected" : "not_configured", folderUrl: null, error: null, local: !!localDriveUrl });
  const [saves, setSaves] = useState<WorkApi["saves"]>({});
  const [conflicts, setConflicts] = useState<ConflictCopy[]>([]);
  const [workspaceId, setWorkspaceIdState] = useState("ws-personal");
  const [cacheTick, setCacheTick] = useState(0);
  const repoRef = useRef<WorkRepo | null>(null);
  const stateRef = useRef(state);
  const tokenRef = useRef<DriveToken | null>(null);
  const cacheRef = useRef<Record<string, { version: string; text: string }>>({});
  const tRef = useRef(t);
  // 콜백이 늘 지금 값을 읽게 — 렌더가 끝난 뒤 맞춘다
  useLayoutEffect(() => {
    stateRef.current = state;
    tRef.current = t;
    uidRef.current = uid;
  });

  const fallbackManifest = useCallback(
    () =>
      defaultManifest({
        personal: tRef.current("ws.personal"),
        company: tRef.current("ws.company"),
        dev: tRef.current("ws.dev"),
        reading: tRef.current("ws.reading"),
      }),
    [],
  );
  const render = useCallback((item: WorkItem) => renderSummaryMarkdown(item, stateRef.current, tRef.current), []);

  const deviceStore = useCallback((u: string) => new KvFileStore(kv, `llmwiki:work:${u}:device`), []);
  const uidRef = useRef(uid);

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

  const readState = useCallback(
    async (repo: WorkRepo) => {
      const [loaded, pending] = await Promise.all([repo.load(), uidRef.current ? readPending(uidRef.current) : Promise.resolve([] as WorkItem[])]);
      return { s: { ...loaded, items: [...loaded.items.filter((i) => !pending.some((p) => p.id === i.id)), ...pending] }, pending };
    },
    [],
  );

  const loadFrom = useCallback(
    async (store: FileStore) => {
      const repo = new WorkRepo(store, fallbackManifest(), render);
      const { s, pending } = await readState(repo);
      repoRef.current = repo;
      setState(s);
      if (pending.length) setSaves((m) => ({ ...m, ...Object.fromEntries(pending.map((p) => [p.id, { state: "failed" as SaveState, at: nowIso() }])) }));
      // 충돌 사본은 화면을 막지 않고 뒤에서
      void repo
        .listConflicts()
        .then((cs) => setConflicts(cs.filter((c) => !c.resolved)))
        .catch(() => undefined);
      return { repo, s };
    },
    [fallbackManifest, render, readState],
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
      if (saved == null && serverCapable() && !(await deviceStore(uid).list("state/items/").catch(() => [])).length) {
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
        // 기기 사본으로 먼저 보여 준다 — Drive 토큰 · 폴더 · 파일 읽기는 수 초 걸릴 수 있다. 다 읽으면 그것으로 바꾼다
        let synced = () => undefined as void;
        syncingRef.current = new Promise<void>((r) => (synced = r));
        const preview = await readState(new WorkRepo(mirror, fallbackManifest(), render)).catch(() => null);
        if (alive && preview && (preview.s.items.length || preview.s.sources.length)) {
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
          // 함수가 깨어나는 데 수 초 걸릴 수 있어 읽기를 막지 않고 뒤에서
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
  }, [uid, deviceStore, makeDriveStore, loadFrom, readState, fallbackManifest, render, serverAccess, serverCapable]);

  const setWorkspaceId = useCallback(
    (id: string) => {
      setWorkspaceIdState(id);
      if (uid) AsyncStorage.setItem(prefKey(uid, "workspace"), id).catch(() => undefined);
    },
    [uid],
  );

  const mark = (key: string, s: SaveState, code?: string) => setSaves((m) => ({ ...m, [key]: { state: s, at: nowIso(), ...(code ? { code } : {}) } }));

  const applyOutcome = useCallback(<V extends { id: string }>(key: string, r: SaveOutcome<V>, put: (v: V) => void): SaveState => {
    if (r.status === "saved") {
      put(r.value);
      mark(key, "saved");
      return "saved";
    }
    if (r.status === "conflict") {
      if (r.remote) put(r.remote);
      mark(key, "conflict");
      repoRef.current
        ?.listConflicts()
        .then((cs) => setConflicts(cs.filter((c) => !c.resolved)))
        .catch(() => undefined);
      return "conflict";
    }
    mark(key, "failed", r.code);
    if (r.code === "auth_expired") setDrive((d) => (d.status === "connected" ? { ...d, status: "expired" } : d));
    return "failed";
  }, []);

  const putItem = (v: WorkItem) => setState((s) => ({ ...s, items: s.items.some((i) => i.id === v.id) ? s.items.map((i) => (i.id === v.id ? v : i)) : [...s.items, v] }));
  const putSource = (v: Source) => setState((s) => ({ ...s, sources: s.sources.some((i) => i.id === v.id) ? s.sources.map((i) => (i.id === v.id ? v : i)) : [...s.sources, v] }));

  /** 바꾼 업무를 쓴다. 실패하면 화면엔 바꾼 모습이 남되 "저장 안 됨" 으로 보이고 다시 시도할 수 있다 */
  const saveItem = useCallback(
    async (next: WorkItem): Promise<SaveState> => {
      const repo = await getRepo();
      if (!repo) return "failed";
      putItem(next);
      mark(next.id, "saving");
      const r = await repo.saveItem(next, nowIso());
      const u = uidRef.current;
      if (u) {
        if (r.status === "failed") await AsyncStorage.setItem(pendingKey(u, next.id), JSON.stringify(next)).catch(() => undefined);
        else await AsyncStorage.removeItem(pendingKey(u, next.id)).catch(() => undefined);
      }
      return applyOutcome(next.id, r, putItem);
    },
    [getRepo, applyOutcome],
  );

  const update = useCallback<WorkApi["update"]>(
    async (itemId, fn) => {
      const cur = stateRef.current.items.find((i) => i.id === itemId);
      if (!cur) return "failed";
      const next = fn(cur);
      if (next === cur) return "saved";
      return saveItem(next);
    },
    [saveItem],
  );

  const retry = useCallback(
    async (itemId: string) => {
      const cur = stateRef.current.items.find((i) => i.id === itemId);
      if (cur) await saveItem(cur);
    },
    [saveItem],
  );

  const templateText = useCallback(
    (key: TemplateKey): TemplateText => {
      const tpl = (dictOf(lang).template as Record<string, Record<string, unknown>>)[key];
      const list = (v: unknown) => Object.values((v as Record<string, string>) ?? {});
      return { goal: String(tpl?.goal ?? ""), doneCriteria: list(tpl?.done), actions: list(tpl?.actions) };
    },
    [lang],
  );

  const createItem = useCallback<WorkApi["createItem"]>(
    async (input) => {
      const item = createWorkItem({ ...input, template: input.templateKey ? templateText(input.templateKey) : null }, nowIso());
      if (!item.title) return null;
      const s = await saveItem(item);
      return s === "saved" ? (stateRef.current.items.find((i) => i.id === item.id) ?? item) : item;
    },
    [saveItem, templateText],
  );

  const saveSource = useCallback(
    async (src: Source) => {
      const repo = await getRepo();
      if (!repo) return "failed" as SaveState;
      putSource(src);
      mark(src.id, "saving");
      return applyOutcome(src.id, await repo.saveSource(src, nowIso()), putSource);
    },
    [getRepo, applyOutcome],
  );

  const linkExisting = useCallback<WorkApi["linkExisting"]>(
    async (itemId, sourceId, confirmCross) => {
      const item = stateRef.current.items.find((i) => i.id === itemId);
      const src = stateRef.current.sources.find((s) => s.id === sourceId);
      if (!item || !src) return "already";
      const r = linkSource(item, src, nowIso(), { confirmCross });
      if (r.kind === "linked") await saveItem(r.item);
      return r.kind;
    },
    [saveItem],
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

  const unlink = useCallback(async (itemId: string, sourceId: string) => void (await update(itemId, (i) => unlinkSource(i, sourceId, nowIso()))), [update]);

  const saveManifest = useCallback<WorkApi["saveManifest"]>(
    async (fn) => {
      const repo = await getRepo();
      if (!repo) return "failed";
      const next = fn(stateRef.current.manifest);
      setState((s) => ({ ...s, manifest: next }));
      mark("manifest", "saving");
      // 다른 곳(다른 기기 · MCP)이 먼저 고쳤으면 그 최신본에 같은 바꿈을 다시 얹는다
      const r = await repo.saveManifestWith(stateRef.current.manifest, fn, nowIso());
      if (r.status === "saved") {
        setState((s) => ({ ...s, manifest: r.value }));
        mark("manifest", "saved");
        return "saved";
      }
      if (r.status === "conflict" && r.remote) setState((s) => ({ ...s, manifest: r.remote as WorkManifest }));
      mark("manifest", r.status === "conflict" ? "conflict" : "failed");
      return r.status === "conflict" ? "conflict" : "failed";
    },
    [getRepo, ],
  );

  const applyTriage = useCallback<WorkApi["applyTriage"]>(
    async (r) => {
      const results: SaveState[] = [];
      for (const s of r.sources ?? []) results.push(await saveSource(s));
      for (const i of r.items ?? []) results.push(await saveItem(i));
      if (r.manifest) {
        const m = r.manifest;
        results.push(await saveManifest((cur) => mergeTriage(cur, m)));
      }
      return results.find((x) => x !== "saved") ?? "saved";
    },
    [saveSource, saveItem, saveManifest],
  );

  const handoffLabels = useCallback(() => labelsFrom(tRef.current), []);

  const cachedText = useCallback((s: Source): string | null => {
    if (s.text != null) return s.text;
    const c = cacheRef.current[s.id];
    if (!c) return null;
    return c.version === s.remoteVersion ? c.text : `${tRef.current("handoff.excerptOld", { version: c.version })}\n${c.text}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheTick]);

  const prepare = useCallback<WorkApi["prepare"]>(
    async (itemId, input) => {
      const item = stateRef.current.items.find((i) => i.id === itemId);
      if (!item) return null;
      const r = prepareRun(item, stateRef.current.sources, stateRef.current.manifest.workspaces, { ...input, statusLabel: tRef.current(`work.status.${item.status}`) }, labelsFrom(tRef.current), nowIso(), cachedText);
      // 작업 기록이 저장되지 않아도 묶음은 복사할 수 있다(저장 상태는 따로 보인다)
      await saveItem(r.item);
      return { markdown: r.markdown, runId: r.run.id, excluded: r.excluded.length, dropped: r.dropped.length };
    },
    [saveItem, cachedText],
  );

  const importText = useCallback<WorkApi["importText"]>(
    async (itemId, text, opts) => {
      const repo = await getRepo();
      const item = stateRef.current.items.find((i) => i.id === itemId);
      if (!item || !repo) return { kind: "save_failed" };
      // 근거 줄 검사 — 묶음을 만들 때와 같은 발췌(기기 캐시)를 줄로
      const lines = (sourceId: string) => {
        const src = stateRef.current.sources.find((x) => x.id === sourceId);
        const body = src ? cachedText(src) : null;
        return body ? body.replace(/\r\n?/g, "\n").split("\n") : null;
      };
      const r = importResult(item, text, nowIso(), { ...opts, lines });
      if (r.kind === "duplicate") return r;
      // 원문부터 — 원문이 저장되지 않으면 아무것도 반영하지 않는다(유실 방지)
      const raw = await repo.saveRaw(r.rawHash, text);
      if (!raw.ok) {
        mark(itemId, "failed", raw.code);
        return { kind: "save_failed" };
      }
      const s = await saveItem(r.item);
      return s === "failed" ? { kind: "save_failed" } : r;
    },
    [getRepo, saveItem, cachedText],
  );

  const prepareTriage = useCallback<WorkApi["prepareTriage"]>(
    async (tool) => {
      const r = prepareTriagePack(stateRef.current, workspaceId, { tool }, triageLabelsFrom(tRef.current), nowIso(), cachedText);
      if (!r) return null;
      // 기록이 저장되지 않아도 묶음은 복사할 수 있다 — 다만 그러면 가져올 때 S1 · W1 을 되짚지 못한다
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

  const undo = useCallback(
    async (itemId: string, changeId: string) => {
      await update(itemId, (i) => {
        const r = undoChange(i, changeId, nowIso());
        return r.ok ? r.item : i;
      });
    },
    [update],
  );

  const rawText = useCallback(async (hash: string) => (await repoRef.current?.readRaw(hash).catch(() => null)) ?? null, []);

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
      // 처음 연결은 동의 화면을 보이고, 이미 Drive 를 쓰던 중 다시 받을 때는 동의 화면 없이(이미 허락한 범위)
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
      // 끊긴 동안 저장하지 못한 업무 — 다시 읽은 뒤 다시 저장한다(바깥에서 바뀌었으면 충돌 사본으로, 조용히 버리지 않는다)
      await loadFrom(store);
      const unsaved = await readPending(uid);
      setDrive({ status: "connected", folderUrl: localDriveUrl ? null : remote.rootFolderUrl(), error: null, local: !!localDriveUrl, ...(server ? { server } : {}) });
      for (const i of unsaved) await saveItem(i);
      await AsyncStorage.setItem(prefKey(uid, "storage"), "drive");
      setStorage("drive");
      setDrive({ status: "connected", folderUrl: localDriveUrl ? null : remote.rootFolderUrl(), error: null, local: !!localDriveUrl, ...(server ? { server } : {}) });
    } catch (e) {
      const reason = (e as { details?: { reason?: string } })?.details?.reason;
      const code = e instanceof DriveAuthError ? e.code : (reason ?? (e as { code?: string })?.code ?? errorText(e) ?? "failed");
      setDrive((d) => ({ ...d, status: code === "cancelled" ? (storage === "drive" ? "expired" : "disconnected") : "error", error: code }));
    }
  }, [uid, user, makeDriveStore, storage, deviceStore, loadFrom, saveItem, serverCapable]);

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
      const ws = linkTo ? (stateRef.current.items.find((i) => i.id === linkTo)?.workspaceId ?? workspaceId) : workspaceId;
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

  const pickDriveOutput = useCallback<WorkApi["pickDriveOutput"]>(
    async (itemId) => {
      const tok = driveDeps.token();
      if (!tok) return null;
      const picked = localDriveUrl ? await requestLocalPick() : await pickDriveFiles(tok);
      if (!picked) return null;
      let n = 0;
      for (const f of picked) {
        const m = await getMeta(driveDeps, f.id);
        const version = m.ok ? (m.meta.version ?? null) : null;
        const s = await update(itemId, (i) => addOutput(i, { title: f.name, url: f.url ?? (m.ok ? (m.meta.webViewLink ?? null) : null), externalId: f.id, version }, nowIso()));
        if (s !== "failed") n++;
      }
      return n;
    },
    [driveDeps, update],
  );

  /** 연결된 Drive 자료의 버전을 다시 본다 — 바뀌었으면 요약이 옛 버전 기준이라고 화면에 뜬다 */
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

  const resolveConflict = useCallback(
    async (c: ConflictCopy, choice: "mine" | "theirs") => {
      const repo = repoRef.current;
      if (!repo) return;
      await repo.resolveConflict(c, choice, nowIso());
      const s = await repo.load();
      setState(s);
      setConflicts((await repo.listConflicts()).filter((x) => !x.resolved));
    },
    [],
  );

  /* ───────── 이행 ───────── */

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
      for (const itemId of plan.itemIds) await update(itemId, (i) => plan.removeSourceIds.reduce((acc, sid) => unlinkSource(acc, sid, nowIso()), i));
      for (const sid of plan.removeSourceIds) await repo.removeSource(sid).catch(() => undefined);
      setState((s) => ({ ...s, sources: s.sources.filter((x) => !plan.removeSourceIds.includes(x.id)) }));
      await saveManifest((m) => ({ ...m, migrations: m.migrations.map((x) => (x.id === id ? { ...x, reverted: true } : x)) }));
    },
    [update, saveManifest],
  );

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
      update,
      retry,
      createItem,
      addSource,
      capture,
      applyTriage,
      prepareTriage,
      importTriageText,
      linkExisting,
      unlink,
      saveManifest,
      prepare,
      importText,
      undo,
      rawText,
      connectDrive,
      disconnectDrive,
      pickFromDrive,
      pickDriveOutput,
      refreshSources,
      cachedText,
      resolveConflict,
      migrateScraps,
      revertMigration,
      handoffLabels,
      templateText,
    }),
    [ready, state, storage, drive, saves, conflicts, workspaceId, setWorkspaceId, update, retry, createItem, addSource, capture, applyTriage, prepareTriage, importTriageText, linkExisting, unlink, saveManifest, prepare, importText, undo, rawText, connectDrive, disconnectDrive, pickFromDrive, pickDriveOutput, refreshSources, cachedText, resolveConflict, migrateScraps, revertMigration, handoffLabels, templateText],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useWork(): WorkApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWork must be used inside WorkProvider");
  return v;
}
