/**
 * 작업실 — 업무 · 원본 자료 · 결정 · AI 작업 · 결과물 · 검토 카드(순수 함수).
 *
 * 계층: 작업실(회사 · 개인 — 자료 범위를 나눈다) → 영역(큰 범주) → 업무(목표와 진행 상태) → 할 일(Task 를 넓혀 쓴다).
 * 원칙
 * - 가져온 원본은 덮어쓰지 않는다. 바깥 원본이 바뀌면 버전으로 알아채고, 요약이 어느 버전을 근거로 했는지 남긴다.
 * - AI 가 낸 것(결정 · 할 일 · 결과물 최신본)은 제안으로만 들어오고, 사람이 확정해야 바뀐다.
 * - 같은 결과를 두 번 가져와도 한 번만 들어간다(원문 해시).
 * - 화면에 보일 고정 문구는 여기 두지 않는다 — 문구 키(msg)와 값만 남기고 앱이 번역 파일로 그린다.
 */
import { newId, type Task } from "./types.ts";

export const WORK_SCHEMA_VERSION = 1;

/* ───────────────────────── 모델 ───────────────────────── */

/** 옛 작업실 종류 — 읽을 때 icon · private 로 옮긴다(upgradeManifest) */
export type WorkspaceKind = "personal" | "company";

export interface Area {
  id: string;
  name: string;
}

/** 주제(개인 · 회사 · 취준 · 독서 …) — 사용자가 더하고 이름을 바꾼다. 업무 · 자료는 주제 하나에 속한다 */
export interface Workspace {
  id: string;
  name: string;
  /** WORKSPACE_ICONS 중 하나 */
  icon: string;
  /** 판단 기록 등 밖으로 내보낼 때 기본으로 뺀다(옛 회사 작업실) */
  private: boolean;
  areas: Area[];
  /** 옛 값 — 남아 있어도 쓰지 않는다 */
  kind?: WorkspaceKind;
}

export type WorkStatus = "planned" | "active" | "waiting" | "blocked" | "done" | "archived";
export const WORK_STATUSES: WorkStatus[] = ["planned", "active", "waiting", "blocked", "done", "archived"];
export type Importance = "high" | "normal" | "low";

/** 업무 요약 — 누가 썼고 어느 자료 버전을 근거로 했나 */
export interface WorkSummary {
  text: string;
  origin: "user" | "ai";
  runId?: string;
  /** 자료 id → 이 요약이 근거로 한 그 자료의 버전 */
  basedOn: Record<string, string>;
  updatedAt: string;
}

export type DecisionStatus = "proposed" | "confirmed" | "superseded" | "rejected";

export interface Decision {
  id: string;
  text: string;
  reason: string;
  evidenceSourceIds: string[];
  status: DecisionStatus;
  origin: "user" | "ai";
  runId?: string;
  createdAt: string;
  decidedAt?: string | null;
  /** 이 결정이 바꾸려는(바꾼) 이전 결정 */
  supersedes?: string | null;
  supersededBy?: string | null;
  /** AI 가 댄 근거("S1:12") */
  refs?: string[];
}

export type AiTool = "claude" | "codex" | "gemma" | "other";
export type RunStatus = "prepared" | "imported" | "parse_failed";

/**
 * 가져올 때 코드가 찾은 문제(workHandoff.importResult) — 화면이 경고로 보인다. 결과를 버리지는 않는다.
 * - forbidden_fields: status · confirmed 같은 확정 · 완료 필드가 있었다(무시했다)
 * - bad_refs: 묶음에 없는 자료 · 줄을 근거로 댔다
 * - run_mismatch: 결과의 run 이 고른 요청과 다르다
 * - injection_suspect: 결과 원문에 지시문으로 보이는 말이 있다
 */
export type RunFlag = "forbidden_fields" | "bad_refs" | "run_mismatch" | "injection_suspect";
/** 제안 하나에 붙는 경고 — due_unsupported: 근거 줄에 없는 마감 · no_evidence: 근거 참조 없음 */
export type ProposalFlag = "due_unsupported" | "no_evidence";

export interface AiRun {
  id: string;
  tool: AiTool;
  goal: string;
  scope: string;
  /** 넘긴 맥락의 버전 — 업무 rev + 맥락 해시 */
  contextVersion: string;
  inputSourceIds: string[];
  inputSourceVersions: Record<string, string>;
  status: RunStatus;
  resultSummary?: string;
  done: string[];
  outputIds: string[];
  remaining: string[];
  unverified: string[];
  /** 가져온 원문의 해시 — 같은 결과를 다시 가져오는지 본다. 원문은 저장소 raw/{hash}.txt */
  rawHash?: string;
  /** 넘긴 자료 순서(S1, S2 … 의 근거 참조를 풀 때 쓴다) — inputSourceIds 와 같은 순서 */
  refKeys?: string[];
  /** 자료 발췌를 몇 줄까지 넘겼나(S1 → 줄 수) — 없는 줄 참조를 잡는다 */
  refLines?: Record<string, number>;
  flags?: RunFlag[];
  /** 실행자가 남긴 모델 · 걸린 시간(결과 머리의 <!-- llmwiki-run {...} --> 에서) */
  model?: string | null;
  latencyMs?: number | null;
  startedAt: string;
  finishedAt?: string | null;
}

export type OutputStatus = "draft" | "review" | "final";

export interface Output {
  id: string;
  title: string;
  url?: string | null;
  /** Drive 파일 id 등 */
  externalId?: string | null;
  version?: string | null;
  runId?: string | null;
  status: OutputStatus;
  /** 이 업무의 최신본 — 사람이 정한다. 가장 최근 파일이라고 저절로 최신본이 되지 않는다 */
  isLatest: boolean;
  createdAt: string;
}

export type ProposalKind = "task" | "due_change" | "output_latest" | "cross_link";

export interface Proposal {
  id: string;
  kind: ProposalKind;
  status: "open" | "accepted" | "rejected";
  runId?: string | null;
  createdAt: string;
  /** task: 제목 · 마감 · 근거 / due_change: 할 일 · 새 마감 / output_latest: 결과물 / cross_link: 자료 */
  title?: string;
  due?: string | null;
  taskId?: string;
  outputId?: string;
  sourceId?: string;
  /** 판단 근거로 보여 줄 말(AI 가 쓴 문장 그대로) */
  note?: string;
  /** AI 가 댄 근거("S1:12") */
  refs?: string[];
  flags?: ProposalFlag[];
  /** 사람이 받아들이거나 뺀 시각 — 판단 기록(judgments.ts)에 쓴다 */
  decidedAt?: string | null;
}

/** 번역 키 + 값 — 앱이 문구로 바꾼다 */
export interface Msg {
  key: string;
  params?: Record<string, string | number>;
}

/** 바꾼 기록 — [되돌리기] 가 before 로 돌린다 */
export interface ChangeEntry {
  id: string;
  at: string;
  msg: Msg;
  /** 확인이 필요한 것이 생겼으면 그 안내 */
  attention?: Msg[];
  /** 바꾸기 전 업무(changes 는 뺀다) */
  before: string;
  undone: boolean;
}

export interface WorkItem {
  id: string;
  schemaVersion: number;
  /** 저장할 때마다 1씩 — 화면 · 저장소 · 맥락 버전이 같은 수를 본다 */
  rev: number;
  workspaceId: string;
  areaId: string;
  title: string;
  templateKey?: string | null;
  goal: string;
  doneCriteria: string[];
  status: WorkStatus;
  importance: Importance;
  due?: string | null;
  summary: WorkSummary | null;
  /** 이 업무의 할 일(Task 를 넓혀 쓴다) */
  actions: Task[];
  /** 이어 둔 자료 — 자료는 보관함에 한 벌만 있고 여기엔 id 만 */
  sourceIds: string[];
  decisions: Decision[];
  runs: AiRun[];
  outputs: Output[];
  proposals: Proposal[];
  changes: ChangeEntry[];
  createdAt: string;
  updatedAt: string;
}

export type SourceProvider = "drive" | "note" | "upload" | "paste" | "link" | "legacy";
export type SourceFormat = "doc" | "sheet" | "slides" | "pdf" | "text" | "image" | "folder" | "other";
export type IngestStatus = "ok" | "pending" | "unsupported" | "error" | "auth_expired" | "lost" | "deleted";

export interface Source {
  id: string;
  schemaVersion: number;
  rev: number;
  workspaceId: string;
  provider: SourceProvider;
  /** Drive 파일 id — 이름 · 경로가 바뀌어도 이것으로 잇는다 */
  externalId?: string | null;
  path?: string | null;
  title: string;
  mimeType?: string | null;
  format: SourceFormat;
  url?: string | null;
  /** 원본의 지금 버전(Drive version · 메모는 rev) */
  remoteVersion?: string | null;
  remoteModifiedAt?: string | null;
  /** 마지막으로 내용을 읽어 처리한 버전 */
  processedVersion?: string | null;
  /** 사람이 쓴 메모 · 붙여 넣은 원문(원본 그대로). Drive 자료의 본문은 기기 캐시에만 둔다 */
  text?: string | null;
  ingest: { status: IngestStatus; error?: string | null; at: string };
  /** 예전 데이터에서 옮겨 온 것 — 이행을 되돌릴 때 이것만 지운다 */
  migratedFrom?: { coll: string; id: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkPrefs {
  /** 오늘 화면에서 사람이 정한 순서(추천 키) */
  todayOrder: string[];
}

export interface MigrationRecord {
  id: string;
  kind: "legacy_scraps";
  at: string;
  sourceIds: string[];
  reverted: boolean;
}

export interface WorkManifest {
  schemaVersion: number;
  workspaces: Workspace[];
  prefs: WorkPrefs;
  migrations: MigrationRecord[];
}

export interface WorkState {
  manifest: WorkManifest;
  items: WorkItem[];
  sources: Source[];
}

/* ───────────────────────── 도우미 ───────────────────────── */

/** 짧고 안정적인 해시(FNV-1a 두 갈래) — 같은 글은 늘 같은 값 */
export function hashText(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
    h2 ^= h2 >>> 13;
  }
  return h1.toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/** 붙여 넣기마다 줄바꿈 · 앞뒤 빈칸이 달라도 같은 결과로 본다 */
export function normalizeResult(text: string): string {
  return text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trimEnd()).join("\n").trim();
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

const MAX_CHANGES = 12;

/** 업무를 바꾸고, 되돌릴 수 있게 바꾸기 전 모습을 남긴다. rev 는 저장소가 올린다 */
export function withChange(item: WorkItem, msg: Msg, nowIso: string, fn: (draft: WorkItem) => WorkItem, attention?: Msg[]): WorkItem {
  const { changes, ...rest } = item;
  const before = JSON.stringify(rest);
  const next = fn(clone(item));
  const entry: ChangeEntry = { id: newId(), at: nowIso, msg, before, undone: false, ...(attention && attention.length ? { attention } : {}) };
  return { ...next, changes: [entry, ...changes].slice(0, MAX_CHANGES), updatedAt: nowIso };
}

/** 바꾼 기록 하나를 되돌린다 — 그 뒤에 바꾼 것도 함께 사라지므로 가장 최근 것만 된다 */
export function undoChange(item: WorkItem, changeId: string, nowIso: string): { item: WorkItem; ok: boolean } {
  const latest = item.changes.find((c) => !c.undone);
  if (!latest || latest.id !== changeId) return { item, ok: false };
  const restored = JSON.parse(latest.before) as Omit<WorkItem, "changes">;
  const changes = item.changes.map((c) => (c.id === changeId ? { ...c, undone: true } : c));
  // rev 는 되돌려도 앞으로만 간다(저장소 충돌 판단)
  return { item: { ...restored, rev: item.rev, changes, updatedAt: nowIso }, ok: true };
}

/* ───────────────────────── 작업실 · 템플릿 ───────────────────────── */

export const PERSONAL_AREA_KEYS = ["jobChange", "personal", "dev", "sideJob"] as const;
export const COMPANY_AREA_KEYS = ["general"] as const;

export const WORKSPACE_ICONS = ["person", "business", "briefcase", "book", "school", "code-slash", "heart", "barbell", "cash", "home", "airplane", "sparkles"] as const;

/** 처음 열 때 — 개인 · 회사 주제. 이름은 앱이 번역해서 넘긴다 */
export function defaultManifest(names: { personal: string; company: string; areas: Record<string, string> }): WorkManifest {
  const area = (key: string): Area => ({ id: `area-${key}`, name: names.areas[key] ?? key });
  return {
    schemaVersion: WORK_SCHEMA_VERSION,
    workspaces: [
      { id: "ws-personal", name: names.personal, icon: "person", private: false, areas: PERSONAL_AREA_KEYS.map(area) },
      { id: "ws-company", name: names.company, icon: "business", private: true, areas: COMPANY_AREA_KEYS.map(area) },
    ],
    prefs: { todayOrder: [] },
    migrations: [],
  };
}

/** 새 주제 — 영역은 하나(일반)로 시작한다 */
export function addWorkspace(m: WorkManifest, input: { name: string; icon: string; private: boolean }, generalArea: string): { manifest: WorkManifest; workspace: Workspace } {
  const workspace: Workspace = { id: `ws-${newId()}`, name: input.name.trim(), icon: input.icon, private: input.private, areas: [{ id: "area-general", name: generalArea }] };
  return { manifest: { ...m, workspaces: [...m.workspaces, workspace] }, workspace };
}

export function editWorkspace(m: WorkManifest, id: string, patch: Partial<Pick<Workspace, "name" | "icon" | "private">>): WorkManifest {
  return { ...m, workspaces: m.workspaces.map((w) => (w.id === id ? { ...w, ...patch, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}) } : w)) };
}

/** 지울 수 있나 — 마지막 하나가 아니고, 업무 · 자료가 남아 있지 않을 때만(데이터를 잃지 않게) */
export function canRemoveWorkspace(state: WorkState, id: string): "ok" | "last" | "in_use" {
  if (state.manifest.workspaces.length <= 1) return "last";
  if (state.items.some((i) => i.workspaceId === id) || state.sources.some((s) => s.workspaceId === id)) return "in_use";
  return "ok";
}

export function removeWorkspace(m: WorkManifest, id: string): WorkManifest {
  return { ...m, workspaces: m.workspaces.filter((w) => w.id !== id) };
}

export const TEMPLATE_KEYS = ["report", "meetingFollowup", "research", "proposal", "event"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** 템플릿 내용(번역된 글) — 앱이 번역 파일에서 채워 넘긴다 */
export interface TemplateText {
  goal: string;
  doneCriteria: string[];
  actions: string[];
}

export function createWorkItem(
  input: { workspaceId: string; areaId: string; title: string; templateKey?: string | null; template?: TemplateText | null; goal?: string; due?: string | null; importance?: Importance },
  nowIso: string,
): WorkItem {
  const id = newId();
  const t = input.template;
  const actions: Task[] = (t?.actions ?? []).map((title) => ({ id: newId(), title, done: false, createdAt: nowIso, workItemId: id, origin: "user", due: null }));
  // 템플릿 할 일은 차례대로 — 앞의 것이 끝나야 다음 것
  for (let i = 1; i < actions.length; i++) actions[i].dependsOn = [actions[i - 1].id];
  return {
    id,
    schemaVersion: WORK_SCHEMA_VERSION,
    rev: 0,
    workspaceId: input.workspaceId,
    areaId: input.areaId,
    title: input.title.trim().slice(0, 200),
    templateKey: input.templateKey ?? null,
    goal: (input.goal ?? t?.goal ?? "").trim(),
    doneCriteria: t?.doneCriteria ?? [],
    status: "active",
    importance: input.importance ?? "normal",
    due: input.due ?? null,
    summary: null,
    actions,
    sourceIds: [],
    decisions: [],
    runs: [],
    outputs: [],
    proposals: [],
    changes: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/* ───────────────────────── 자료 ───────────────────────── */

export function newSource(
  input: Pick<Source, "workspaceId" | "provider" | "title"> & Partial<Pick<Source, "externalId" | "path" | "mimeType" | "format" | "url" | "remoteVersion" | "remoteModifiedAt" | "text" | "migratedFrom">>,
  nowIso: string,
): Source {
  const isText = input.provider === "note" || input.provider === "paste" || input.provider === "legacy" || (input.provider === "upload" && input.text != null);
  return {
    id: newId(),
    schemaVersion: WORK_SCHEMA_VERSION,
    rev: 0,
    workspaceId: input.workspaceId,
    provider: input.provider,
    externalId: input.externalId ?? null,
    path: input.path ?? null,
    title: input.title.trim().slice(0, 300) || "-",
    mimeType: input.mimeType ?? null,
    format: input.format ?? (isText ? "text" : "other"),
    url: input.url ?? null,
    // 사람이 쓴 글은 그 자체가 원본 — 내용 해시를 버전으로 쓴다
    remoteVersion: input.remoteVersion ?? (isText && input.text != null ? hashText(input.text) : null),
    remoteModifiedAt: input.remoteModifiedAt ?? null,
    processedVersion: isText && input.text != null ? hashText(input.text) : null,
    text: input.text ?? null,
    ingest: { status: isText ? "ok" : "pending", at: nowIso },
    migratedFrom: input.migratedFrom ?? null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/** 이미 보관함에 있는 같은 자료(Drive 는 파일 id, 같은 작업실 안에서만) — 중복 복사하지 않는다 */
export function findSameSource(sources: Source[], s: Pick<Source, "workspaceId" | "provider" | "externalId" | "url">): Source | null {
  if (s.provider === "drive" && s.externalId) return sources.find((x) => x.provider === "drive" && x.externalId === s.externalId && x.workspaceId === s.workspaceId) ?? null;
  if (s.provider === "link" && s.url) return sources.find((x) => x.provider === "link" && x.url === s.url && x.workspaceId === s.workspaceId) ?? null;
  return null;
}

export type LinkResult = { kind: "linked"; item: WorkItem } | { kind: "already"; item: WorkItem } | { kind: "needs_confirm"; reason: "cross_workspace" };

/**
 * 업무에 자료를 잇는다. 다른 작업실 자료는 사람이 확인해야 잇는다(confirmCross) —
 * 이어도 맥락에는 따로 표시되어 섞이지 않는다.
 */
export function linkSource(item: WorkItem, source: Source, nowIso: string, opts: { confirmCross?: boolean } = {}): LinkResult {
  if (item.sourceIds.includes(source.id)) return { kind: "already", item };
  if (source.workspaceId !== item.workspaceId && !opts.confirmCross) return { kind: "needs_confirm", reason: "cross_workspace" };
  const next = withChange(item, { key: "change.linkSource", params: { title: source.title } }, nowIso, (d) => ({ ...d, sourceIds: [...d.sourceIds, source.id] }));
  return { kind: "linked", item: next };
}

export function unlinkSource(item: WorkItem, sourceId: string, nowIso: string): WorkItem {
  if (!item.sourceIds.includes(sourceId)) return item;
  return withChange(item, { key: "change.unlinkSource" }, nowIso, (d) => ({ ...d, sourceIds: d.sourceIds.filter((x) => x !== sourceId) }));
}

/** 이 자료를 이어 둔 업무들(연결은 업무 쪽에만 적어 두고 거꾸로 찾는다) */
export function itemsForSource(items: WorkItem[], sourceId: string): WorkItem[] {
  return items.filter((i) => i.sourceIds.includes(sourceId));
}

/** 요약이 근거로 한 버전과 지금 원본 버전이 다른 자료 — "마지막 정리 이후 자료가 변경됨" */
export function staleSources(item: WorkItem, sources: Source[]): Source[] {
  if (!item.summary) return [];
  const basedOn = item.summary.basedOn;
  return sources.filter((s) => item.sourceIds.includes(s.id) && basedOn[s.id] != null && s.remoteVersion != null && basedOn[s.id] !== s.remoteVersion);
}

/** 원본 메타데이터를 새로 읽은 결과를 반영한다. 원본 내용은 바꾸지 않고 버전만 따라간다 */
export function applyRemoteMeta(
  s: Source,
  meta: { ok: true; title?: string; version?: string | null; modifiedAt?: string | null; url?: string | null; mimeType?: string | null } | { ok: false; status: IngestStatus; error?: string },
  nowIso: string,
): Source {
  if (!meta.ok) return { ...s, ingest: { status: meta.status, error: meta.error ?? null, at: nowIso }, updatedAt: nowIso };
  return {
    ...s,
    title: meta.title ?? s.title,
    remoteVersion: meta.version ?? s.remoteVersion ?? null,
    remoteModifiedAt: meta.modifiedAt ?? s.remoteModifiedAt ?? null,
    url: meta.url ?? s.url ?? null,
    mimeType: meta.mimeType ?? s.mimeType ?? null,
    ingest: { status: s.ingest.status === "unsupported" ? "unsupported" : s.ingest.status === "pending" ? "pending" : "ok", at: nowIso },
    updatedAt: nowIso,
  };
}

/* ───────────────────────── 사람이 직접 하는 일(곧바로 + 되돌리기) ───────────────────────── */

export function setWorkStatus(item: WorkItem, status: WorkStatus, nowIso: string): WorkItem {
  if (item.status === status) return item;
  return withChange(item, { key: "change.status", params: { status } }, nowIso, (d) => ({ ...d, status }));
}

export function editWork(item: WorkItem, patch: Partial<Pick<WorkItem, "title" | "goal" | "doneCriteria" | "importance" | "due" | "areaId">>, nowIso: string): WorkItem {
  return withChange(item, { key: "change.edit" }, nowIso, (d) => ({ ...d, ...patch }));
}

/** 사람이 쓴 현재 상황 — 근거 버전은 지금 이어 둔 자료 버전 */
export function setSummary(item: WorkItem, text: string, sources: Source[], nowIso: string): WorkItem {
  const basedOn = Object.fromEntries(sources.filter((s) => item.sourceIds.includes(s.id) && s.remoteVersion).map((s) => [s.id, s.remoteVersion as string]));
  return withChange(item, { key: "change.summary" }, nowIso, (d) => ({ ...d, summary: { text: text.trim(), origin: "user", basedOn, updatedAt: nowIso } }));
}

export function addAction(item: WorkItem, input: { title: string; due?: string | null; dependsOn?: string[] }, nowIso: string): WorkItem {
  const title = input.title.trim().slice(0, 200);
  if (!title) return item;
  const task: Task = { id: newId(), title, due: input.due ?? null, done: false, createdAt: nowIso, workItemId: item.id, origin: "user", dependsOn: input.dependsOn ?? [] };
  return withChange(item, { key: "change.addAction", params: { title } }, nowIso, (d) => ({ ...d, actions: [...d.actions, task] }));
}

export function toggleAction(item: WorkItem, taskId: string, nowIso: string): WorkItem {
  const t = item.actions.find((a) => a.id === taskId);
  if (!t) return item;
  return withChange(item, { key: t.done ? "change.reopenAction" : "change.doneAction", params: { title: t.title } }, nowIso, (d) => ({
    ...d,
    actions: d.actions.map((a) => (a.id === taskId ? { ...a, done: !a.done, completedAt: a.done ? null : nowIso } : a)),
  }));
}

/** 사람이 직접 마감을 바꾼다(AI 가 낸 마감 변경은 due_change 제안으로 따로 온다) */
export function setActionDue(item: WorkItem, taskId: string, due: string | null, nowIso: string): WorkItem {
  const t = item.actions.find((a) => a.id === taskId);
  if (!t) return item;
  return withChange(item, { key: "change.actionDue", params: { title: t.title } }, nowIso, (d) => ({ ...d, actions: d.actions.map((a) => (a.id === taskId ? { ...a, due } : a)) }));
}

export function removeAction(item: WorkItem, taskId: string, nowIso: string): WorkItem {
  const t = item.actions.find((a) => a.id === taskId);
  if (!t) return item;
  return withChange(item, { key: "change.removeAction", params: { title: t.title } }, nowIso, (d) => ({
    ...d,
    actions: d.actions.filter((a) => a.id !== taskId).map((a) => ({ ...a, dependsOn: (a.dependsOn ?? []).filter((x) => x !== taskId) })),
  }));
}

/** 사람이 적은 결정은 곧바로 확정. 같은 내용을 대신하면 이전 것을 대체됨으로 */
export function addDecision(item: WorkItem, input: { text: string; reason: string; evidenceSourceIds?: string[]; supersedes?: string | null }, nowIso: string): WorkItem {
  const d0: Decision = {
    id: newId(),
    text: input.text.trim(),
    reason: input.reason.trim(),
    evidenceSourceIds: input.evidenceSourceIds ?? [],
    status: "confirmed",
    origin: "user",
    createdAt: nowIso,
    decidedAt: nowIso,
    supersedes: input.supersedes ?? null,
  };
  if (!d0.text) return item;
  return withChange(item, { key: "change.addDecision" }, nowIso, (d) => ({ ...d, decisions: supersede([...d.decisions, d0], d0, nowIso) }));
}

function supersede(decisions: Decision[], winner: Decision, nowIso: string): Decision[] {
  if (!winner.supersedes) return decisions;
  return decisions.map((x) => (x.id === winner.supersedes && x.status === "confirmed" ? { ...x, status: "superseded" as const, supersededBy: winner.id, decidedAt: x.decidedAt ?? nowIso } : x));
}

/** 제안된 결정을 확정한다 — 이전 확정 결정을 대신하는 것이면 그것은 대체됨이 된다 */
export function confirmDecision(item: WorkItem, decisionId: string, nowIso: string): WorkItem {
  const dec = item.decisions.find((x) => x.id === decisionId);
  if (!dec || dec.status !== "proposed") return item;
  return withChange(item, { key: "change.confirmDecision" }, nowIso, (d) => {
    const confirmed: Decision = { ...dec, status: "confirmed", decidedAt: nowIso };
    return { ...d, decisions: supersede(d.decisions.map((x) => (x.id === decisionId ? confirmed : x)), confirmed, nowIso) };
  });
}

export function rejectDecision(item: WorkItem, decisionId: string, nowIso: string): WorkItem {
  const dec = item.decisions.find((x) => x.id === decisionId);
  if (!dec || dec.status !== "proposed") return item;
  return withChange(item, { key: "change.rejectDecision" }, nowIso, (d) => ({ ...d, decisions: d.decisions.map((x) => (x.id === decisionId ? { ...x, status: "rejected" as const, decidedAt: nowIso } : x)) }));
}

/** 결과물 이어 붙이기(사람이) — 초안으로 들어온다 */
export function addOutput(item: WorkItem, input: { title: string; url?: string | null; externalId?: string | null; version?: string | null }, nowIso: string): WorkItem {
  const same = item.outputs.find((o) => (input.externalId && o.externalId === input.externalId) || (input.url && o.url === input.url));
  if (same) return item;
  const out: Output = { id: newId(), title: input.title.trim() || input.url || "-", url: input.url ?? null, externalId: input.externalId ?? null, version: input.version ?? null, runId: null, status: "draft", isLatest: false, createdAt: nowIso };
  return withChange(item, { key: "change.addOutput", params: { title: out.title } }, nowIso, (d) => ({ ...d, outputs: [...d.outputs, out] }));
}

export function setOutputStatus(item: WorkItem, outputId: string, status: OutputStatus, nowIso: string): WorkItem {
  const o = item.outputs.find((x) => x.id === outputId);
  if (!o || o.status === status) return item;
  return withChange(item, { key: "change.outputStatus", params: { title: o.title, status } }, nowIso, (d) => ({ ...d, outputs: d.outputs.map((x) => (x.id === outputId ? { ...x, status } : x)) }));
}

/**
 * 최신본으로 정한다. 이미 확정본인 최신본을 바꾸는 일은 확인이 필요하다(confirmReplace).
 */
export function markLatest(item: WorkItem, outputId: string, nowIso: string, opts: { confirmReplace?: boolean } = {}): { kind: "ok"; item: WorkItem } | { kind: "needs_confirm"; current: Output } {
  const target = item.outputs.find((x) => x.id === outputId);
  if (!target) return { kind: "ok", item };
  const current = item.outputs.find((x) => x.isLatest && x.id !== outputId);
  if (current && current.status === "final" && !opts.confirmReplace) return { kind: "needs_confirm", current };
  const next = withChange(item, { key: "change.markLatest", params: { title: target.title } }, nowIso, (d) => ({
    ...d,
    outputs: d.outputs.map((x) => ({ ...x, isLatest: x.id === outputId })),
    proposals: d.proposals.map((p) => (p.kind === "output_latest" && p.outputId === outputId && p.status === "open" ? { ...p, status: "accepted" as const, decidedAt: nowIso } : p)),
  }));
  return { kind: "ok", item: next };
}

export function latestOutput(item: WorkItem): Output | null {
  return item.outputs.find((o) => o.isLatest) ?? null;
}

/* ───────────────────────── 검토 카드(제안 → 사람이 확정) ───────────────────────── */

export function acceptProposal(item: WorkItem, proposalId: string, nowIso: string): WorkItem {
  const p = item.proposals.find((x) => x.id === proposalId);
  if (!p || p.status !== "open") return item;
  if (p.kind === "output_latest" && p.outputId) {
    const r = markLatest(item, p.outputId, nowIso, { confirmReplace: true });
    return r.kind === "ok" ? r.item : item;
  }
  return withChange(item, { key: `change.accept.${p.kind}`, params: { title: p.title ?? "" } }, nowIso, (d) => {
    let actions = d.actions;
    if (p.kind === "task" && p.title) {
      const exists = actions.some((a) => !a.done && norm(a.title) === norm(p.title as string));
      if (!exists)
        actions = [
          ...actions,
          { id: `${p.id}-task`, title: p.title, due: p.due ?? null, done: false, createdAt: nowIso, workItemId: d.id, origin: "ai", basis: p.runId ? { runId: p.runId } : null, dependsOn: [] },
        ];
    }
    if (p.kind === "due_change" && p.taskId) actions = actions.map((a) => (a.id === p.taskId ? { ...a, due: p.due ?? null } : a));
    return { ...d, actions, proposals: d.proposals.map((x) => (x.id === proposalId ? { ...x, status: "accepted" as const, decidedAt: nowIso } : x)) };
  });
}

export function rejectProposal(item: WorkItem, proposalId: string, nowIso: string): WorkItem {
  const p = item.proposals.find((x) => x.id === proposalId);
  if (!p || p.status !== "open") return item;
  return withChange(item, { key: "change.rejectProposal" }, nowIso, (d) => ({ ...d, proposals: d.proposals.map((x) => (x.id === proposalId ? { ...x, status: "rejected" as const, decidedAt: nowIso } : x)) }));
}

/** 확인이 필요한 것 — 열린 제안 · 제안된 결정 · 확인되지 않은 내용 */
export function pendingReview(item: WorkItem): { proposals: Proposal[]; decisions: Decision[]; unverified: { runId: string; text: string }[] } {
  return {
    proposals: item.proposals.filter((p) => p.status === "open"),
    decisions: item.decisions.filter((d) => d.status === "proposed"),
    unverified: item.runs.flatMap((r) => r.unverified.map((text) => ({ runId: r.id, text }))),
  };
}

/** 열린 할 일 중 먼저 끝나야 할 것이 남아 있지 않은 것 */
export function isBlocked(item: WorkItem, t: Task): boolean {
  return (t.dependsOn ?? []).some((id) => item.actions.some((a) => a.id === id && !a.done));
}

export function nextActions(item: WorkItem): Task[] {
  return item.actions.filter((a) => !a.done && !a.deletedAt);
}

/* ───────────────────────── 오늘 — 추천 ───────────────────────── */

export interface Recommendation {
  key: string;
  itemId: string;
  taskId: string | null;
  title: string;
  workTitle: string;
  due: string | null;
  score: number;
  /** 왜 추천했나 — 번역 키 */
  reasons: Msg[];
  blocked: boolean;
}

function daysUntil(due: string, now: Date): number {
  const d = new Date(due.length === 10 ? `${due}T23:59` : due);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}

/**
 * 추천 행동 — 마감 · 사람이 정한 중요도 · 선행 작업 상태로 점수를 매긴다.
 * 사람이 정한 순서(todayOrder)가 있으면 그것이 먼저다. 막힌 일은 뒤로 보내고 이유를 단다.
 */
export function recommend(state: WorkState, now: Date, opts: { workspaceId?: string | null } = {}): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const item of state.items) {
    if (item.status === "done" || item.status === "archived") continue;
    if (opts.workspaceId && item.workspaceId !== opts.workspaceId) continue;
    const open = nextActions(item);
    for (const t of open) {
      const reasons: Msg[] = [];
      let score = 0;
      const due = t.due ?? item.due ?? null;
      if (due) {
        const days = daysUntil(due, now);
        if (days < 0) {
          score += 60;
          reasons.push({ key: "reason.overdue", params: { days: -days } });
        } else if (days === 0) {
          score += 50;
          reasons.push({ key: "reason.dueToday" });
        } else if (days <= 3) {
          score += 40 - days * 5;
          reasons.push({ key: "reason.dueSoon", params: { days } });
        } else if (days <= 7) {
          score += 15;
          reasons.push({ key: "reason.dueWeek", params: { days } });
        }
      }
      if (item.importance === "high") {
        score += 25;
        reasons.push({ key: "reason.important" });
      } else if (item.importance === "low") score -= 10;
      const blocked = isBlocked(item, t);
      if (blocked) {
        score -= 100;
        reasons.push({ key: "reason.blocked" });
      } else if ((t.dependsOn ?? []).length) {
        score += 10;
        reasons.push({ key: "reason.unblocked" });
      }
      if (item.status === "waiting" || item.status === "blocked") score -= 20;
      // 업무의 첫 열린 할 일이면 조금 더(이어서 할 일)
      if (open[0]?.id === t.id) score += 5;
      if (!reasons.length) reasons.push({ key: "reason.next" });
      recs.push({ key: `${item.id}:${t.id}`, itemId: item.id, taskId: t.id, title: t.title, workTitle: item.title, due, score, reasons, blocked });
    }
  }
  recs.sort((a, b) => b.score - a.score || (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.title.localeCompare(b.title));
  const order = state.manifest.prefs.todayOrder;
  if (!order.length) return recs;
  const pos = new Map(order.map((k, i) => [k, i]));
  const pinned = recs.filter((r) => pos.has(r.key)).sort((a, b) => (pos.get(a.key) as number) - (pos.get(b.key) as number));
  return [...pinned, ...recs.filter((r) => !pos.has(r.key))];
}

/** 사람이 오늘 순서를 옮긴다(위 · 아래) — 지금 보이는 순서를 통째로 고정한다 */
export function moveRecommendation(prefs: WorkPrefs, visible: string[], key: string, dir: -1 | 1): WorkPrefs {
  const list = [...visible];
  const i = list.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return prefs;
  [list[i], list[j]] = [list[j], list[i]];
  return { ...prefs, todayOrder: list };
}

/** 이어서 할 업무 — 최근에 손댄 진행 중 업무 */
export function continueItems(state: WorkState, workspaceId?: string | null): WorkItem[] {
  return state.items
    .filter((i) => i.status !== "done" && i.status !== "archived" && (!workspaceId || i.workspaceId === workspaceId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/* ───────────────────────── 검색(기기 안 — 언제든 다시 만든다) ───────────────────────── */

export interface SearchHit {
  type: "item" | "source" | "decision" | "run" | "output";
  id: string;
  itemId?: string;
  title: string;
  snippet: string;
}

export function searchWork(state: WorkState, query: string, workspaceId?: string | null): SearchHit[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  const hit = (text: string) => {
    const n = norm(text);
    return words.every((w) => n.includes(w));
  };
  const snip = (text: string) => {
    const n = text.replace(/\s+/g, " ");
    const i = n.toLowerCase().indexOf(words[0]);
    return n.slice(Math.max(0, i - 30), Math.max(0, i - 30) + 120);
  };
  const out: SearchHit[] = [];
  const inWs = (ws: string) => !workspaceId || ws === workspaceId;
  for (const it of state.items) {
    if (!inWs(it.workspaceId)) continue;
    const body = [it.title, it.goal, it.summary?.text ?? "", ...it.actions.map((a) => a.title)].join("\n");
    if (hit(body)) out.push({ type: "item", id: it.id, itemId: it.id, title: it.title, snippet: snip(body) });
    for (const d of it.decisions) if (hit(`${d.text}\n${d.reason}`)) out.push({ type: "decision", id: d.id, itemId: it.id, title: d.text, snippet: snip(d.reason || d.text) });
    for (const r of it.runs) {
      const t = [r.goal, r.resultSummary ?? "", ...r.done, ...r.remaining].join("\n");
      if (hit(t)) out.push({ type: "run", id: r.id, itemId: it.id, title: r.goal || r.scope, snippet: snip(t) });
    }
    for (const o of it.outputs) if (hit(o.title)) out.push({ type: "output", id: o.id, itemId: it.id, title: o.title, snippet: o.url ?? "" });
  }
  for (const s of state.sources) {
    if (!inWs(s.workspaceId)) continue;
    const t = `${s.title}\n${s.text ?? ""}`;
    if (hit(t)) out.push({ type: "source", id: s.id, title: s.title, snippet: snip(s.text || s.title) });
  }
  return out;
}

/* ───────────────────────── 스키마 이행(파일 단위) ───────────────────────── */

/** 예전 모양의 업무 파일을 지금 모양으로 — 빠진 칸만 채우고 아무것도 지우지 않는다 */
export function upgradeItem(raw: Record<string, unknown>): WorkItem {
  const v = Number(raw.schemaVersion ?? 0);
  const it = { ...raw } as unknown as WorkItem;
  if (v < 1) {
    it.actions ??= [];
    it.sourceIds ??= [];
    it.decisions ??= [];
    it.runs ??= [];
    it.outputs ??= [];
    it.proposals ??= [];
    it.changes ??= [];
    it.doneCriteria ??= [];
    it.importance ??= "normal";
    it.summary ??= null;
    it.rev ??= 0;
  }
  it.schemaVersion = WORK_SCHEMA_VERSION;
  return it;
}

export function upgradeSource(raw: Record<string, unknown>): Source {
  const s = { ...raw } as unknown as Source;
  s.rev ??= 0;
  s.ingest ??= { status: "ok", at: s.createdAt };
  s.schemaVersion = WORK_SCHEMA_VERSION;
  return s;
}

export function upgradeManifest(raw: Record<string, unknown> | null, fallback: WorkManifest): WorkManifest {
  if (!raw) return fallback;
  const m = { ...raw } as unknown as WorkManifest;
  m.prefs ??= { todayOrder: [] };
  m.prefs.todayOrder ??= [];
  m.migrations ??= [];
  m.workspaces = (m.workspaces ?? fallback.workspaces).map((w) => ({
    ...w,
    icon: w.icon ?? (w.kind === "company" ? "business" : "person"),
    private: w.private ?? w.kind === "company",
  }));
  m.schemaVersion = WORK_SCHEMA_VERSION;
  return m;
}
