/**
 * 작업실 — 범주(Workspace) · 원본 자료(Source) · 받은 것(정리 제안) · 매니페스트(순수 함수). 페이지 트리는 pages.ts.
 *
 * 계층: 범주(개발 · 독서 · 회사 · 개인 — 사람이 정하고 자료 범위를 나눈다) → 페이지 → 하위 페이지(pages.ts).
 * 받은 것: 던진 조각(Source)은 정리 대기(inbox)로 들어오고, Claude 의 정리 제안(TriageProposal)을 사람이 받아들이면 페이지에 엮인다(filed).
 * 원칙
 * - 가져온 원본은 덮어쓰지 않는다. 바깥 원본이 바뀌면 버전으로 알아챈다.
 * - AI 가 낸 것은 제안으로만 들어오고, 사람이 받아야 바뀐다. 제안은 범주를 넘지 못한다(cross_workspace).
 * - 같은 결과를 두 번 가져와도 한 번만 들어간다(원문 해시).
 * - 화면에 보일 고정 문구는 여기 두지 않는다 — 문구 키(msg)와 값만 남기고 앱이 번역 파일로 그린다.
 * 옛 업무(스키마 2) 파일 모양은 workV2.ts — 이행만 쓴다.
 */
import type { PageRun } from "./pageHandoff.ts";
import { createPage, linkSourceToPage, pageOf, syncMeta, type BodyProposal, type PageDoc, type PageMeta } from "./pages.ts";
import { newId } from "./types.ts";

/** 2: 영역(Area) 층을 없앴다 — 범주 바로 아래가 업무 · 3: 업무 → 페이지 트리(pages.ts), 정리 제안 new_work → new_page */
export const WORK_SCHEMA_VERSION = 3;

/* ───────────────────────── 모델 ───────────────────────── */

/** 옛 작업실 종류 — 읽을 때 icon · private 로 옮긴다(upgradeManifest) */
export type WorkspaceKind = "personal" | "company";

/** 범주(개발 · 독서 · 회사 · 개인 …) — 사람이 만들고 이름을 바꾼다. 업무 · 자료는 범주 하나에 속한다. Claude 는 범주를 만들거나 바꾸지 않는다 */
export interface Workspace {
  id: string;
  name: string;
  /** WORKSPACE_ICONS 중 하나 */
  icon: string;
  /** 판단 기록 등 밖으로 내보낼 때 기본으로 뺀다(옛 회사 작업실) */
  private: boolean;
  /** 옛 값 — 남아 있어도 쓰지 않는다 */
  kind?: WorkspaceKind;
}

export type AiTool = "claude" | "codex" | "gemma" | "other";

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
  /** 바꾸기 전 모습(JSON — 페이지 문서는 본문 · 자료) */
  before: string;
  undone: boolean;
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
  /** 정리 상태 — inbox: 던졌고 아직 안 엮임 · filed: 업무 · 개념에 엮임 · dismissed: 뺌. 없으면 filed(받은 것 이전 자료) */
  triage?: SourceTriage;
  /** 어디서 던졌나 — app: 앱 입력 · share: 공유 시트 · mcp: Claude 등이 대화 중에 */
  origin?: SourceOrigin | null;
  /** 엮인 개념 이름(사람이 받아들인 것만) */
  concepts?: string[];
  createdAt: string;
  updatedAt: string;
}

export type SourceTriage = "inbox" | "filed" | "dismissed";

export interface SourceOrigin {
  via: "app" | "share" | "mcp";
  tool?: AiTool | null;
}

/** 받은 것 정리 제안 — Claude 가 내고 사람이 받아들인다. 범주를 넘지 않는다. new_work 는 옛 기록(읽을 때 열린 것은 new_page 로) */
export type TriageKind = "file_source" | "new_page" | "concept_link" | "new_work";
export type TriageFlag = "no_evidence" | "injection_suspect" | "bad_refs";

export interface TriageProposal {
  id: string;
  kind: TriageKind;
  status: "open" | "accepted" | "rejected";
  /** 조각과 같은 범주 — 제안은 이 범주 안에서만 */
  workspaceId: string;
  /** 대상 조각(new_work 는 여럿일 수 있다) */
  sourceIds: string[];
  /** file_source: 이을 페이지(옛 업무 id 와 같다 — 이행이 id 를 지킨다) */
  itemId?: string | null;
  /** new_page: 새 페이지 제목 · 부모(같은 범주) */
  title?: string;
  parentId?: string | null;
  /** 옛 new_work 의 목표(지금은 note 로) */
  goal?: string;
  /** concept_link: 개념 이름 */
  concept?: string;
  /** 판단 근거로 보여 줄 말(AI 가 쓴 문장 그대로) */
  note?: string;
  /** AI 가 댄 근거("S1:2") */
  refs?: string[];
  flags?: TriageFlag[];
  runId?: string | null;
  tool?: AiTool | null;
  createdAt: string;
  decidedAt?: string | null;
}

export interface WorkPrefs {
  /** 옛 오늘 화면의 추천 순서 — 더는 쓰지 않는다(옛 파일과 맞추려고 칸만 남긴다) */
  todayOrder: string[];
}

export interface MigrationRecord {
  id: string;
  /** legacy_scraps: 옛 Firestore 기록 → 보관함 · pages_v3: 업무 → 페이지(pages.ts migrateToPages) */
  kind: "legacy_scraps" | "pages_v3";
  at: string;
  sourceIds: string[];
  /** pages_v3: 페이지가 된 업무 id */
  pageIds?: string[];
  reverted: boolean;
}

export interface WorkManifest {
  schemaVersion: number;
  workspaces: Workspace[];
  prefs: WorkPrefs;
  migrations: MigrationRecord[];
  /** 받은 것 정리 제안 — 업무가 아직 없을 수 있어(new_work) 범주 목록과 함께 둔다 */
  triage: TriageProposal[];
  /** 정리 묶음 기록 — 묶음의 S1 · W1 이 어느 조각 · 업무인지(가져올 때 되짚는다). 최근 것만 */
  triageRuns?: TriageRun[];
  /** 페이지 본문 제안(pages.ts) — 열린 것은 모두, 정한 것은 최근 것만 */
  bodyProposals?: BodyProposal[];
  /** 페이지 넘기기 기록 — 묶음의 P1 · P2 가 어느 페이지인지 · 그때 본문 지문(pageHandoff.ts). 최근 것만 */
  pageRuns?: PageRun[];
}

export interface TriageRun {
  id: string;
  workspaceId: string;
  tool: AiTool;
  /** S1, S2 … 순서대로 */
  sourceIds: string[];
  /** W1, W2 … 순서대로 */
  itemIds: string[];
  /** 조각마다 묶음에 넣은 줄 수 — 근거(S1:3) 검사 */
  refLines: Record<string, number>;
  startedAt: string;
  finishedAt?: string | null;
  /** 가져온 결과 원문 해시 — 같은 결과를 두 번 들이지 않는다 */
  rawHash?: string | null;
  counts?: { added: number; skipped: number } | null;
}

/** 받은 것 · 정리 제안이 보는 상태(스키마 3) — 페이지는 색인만 */
export interface TriageState {
  manifest: WorkManifest;
  sources: Source[];
  pages: PageMeta[];
}

/* ───────────────────────── 도우미 ───────────────────────── */

export { hashText, normalizeResult } from "./hash.ts";
import { hashText } from "./hash.ts";

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/* ───────────────────────── 작업실(범주) ───────────────────────── */

export const WORKSPACE_ICONS = ["person", "business", "briefcase", "book", "school", "code-slash", "heart", "barbell", "cash", "home", "airplane", "sparkles"] as const;

/** 처음 여는 사람의 범주 — 개인 · 회사 · 개발 · 독서(회사만 비공개). 이름은 앱이 번역해서 넘긴다 */
export function defaultManifest(names: { personal: string; company: string; dev: string; reading: string }): WorkManifest {
  return {
    schemaVersion: WORK_SCHEMA_VERSION,
    workspaces: [
      { id: "ws-personal", name: names.personal, icon: "person", private: false },
      { id: "ws-company", name: names.company, icon: "business", private: true },
      { id: "ws-dev", name: names.dev, icon: "code-slash", private: false },
      { id: "ws-reading", name: names.reading, icon: "book", private: false },
    ],
    prefs: { todayOrder: [] },
    migrations: [],
    triage: [],
  };
}

/** 새 범주 — 사람만 만든다 */
export function addWorkspace(m: WorkManifest, input: { name: string; icon: string; private: boolean }): { manifest: WorkManifest; workspace: Workspace } {
  const workspace: Workspace = { id: `ws-${newId()}`, name: input.name.trim(), icon: input.icon, private: input.private };
  return { manifest: { ...m, workspaces: [...m.workspaces, workspace] }, workspace };
}

export function editWorkspace(m: WorkManifest, id: string, patch: Partial<Pick<Workspace, "name" | "icon" | "private">>): WorkManifest {
  return { ...m, workspaces: m.workspaces.map((w) => (w.id === id ? { ...w, ...patch, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}) } : w)) };
}

/** 지울 수 있나 — 마지막 하나가 아니고, 페이지(휴지통 포함) · 자료가 남아 있지 않을 때만(데이터를 잃지 않게) */
export function canRemoveWorkspace(state: Pick<TriageState, "manifest" | "pages" | "sources">, id: string): "ok" | "last" | "in_use" {
  if (state.manifest.workspaces.length <= 1) return "last";
  if (state.pages.some((p) => p.workspaceId === id) || state.sources.some((s) => s.workspaceId === id)) return "in_use";
  return "ok";
}

export function removeWorkspace(m: WorkManifest, id: string): WorkManifest {
  return { ...m, workspaces: m.workspaces.filter((w) => w.id !== id) };
}

/* ───────────────────────── 자료 ───────────────────────── */

export function newSource(
  input: Pick<Source, "workspaceId" | "provider" | "title"> & Partial<Pick<Source, "externalId" | "path" | "mimeType" | "format" | "url" | "remoteVersion" | "remoteModifiedAt" | "text" | "migratedFrom" | "triage" | "origin">>,
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
    ...(input.triage ? { triage: input.triage } : {}),
    ...(input.origin ? { origin: input.origin } : {}),
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

/* ───────────────────────── 받은 것(인박스) — 던지고, Claude 가 제안하고, 사람이 엮는다 ───────────────────────── */

/** 정리 상태 — 값이 없는 옛 자료는 이미 엮인 것으로 본다 */
export const sourceTriage = (s: Source): SourceTriage => s.triage ?? "filed";

/** 정리 대기 조각(이 범주) — 최신 위 */
export function inboxSources(state: Pick<TriageState, "sources">, workspaceId: string): Source[] {
  return state.sources.filter((s) => s.workspaceId === workspaceId && sourceTriage(s) === "inbox").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 이 범주의 열린 정리 제안 */
export function openTriage(manifest: WorkManifest, workspaceId: string): TriageProposal[] {
  return manifest.triage.filter((p) => p.status === "open" && p.workspaceId === workspaceId);
}

/** 받은 것 흐름에서 조각 하나가 보일 모습 — 정리 대기 · 제안 있음 · 엮임 · 뺌 */
export function fragmentState(s: Source, manifest: WorkManifest): "waiting" | "proposed" | "filed" | "dismissed" {
  const t = sourceTriage(s);
  if (t !== "inbox") return t;
  return manifest.triage.some((p) => p.status === "open" && p.sourceIds.includes(s.id)) ? "proposed" : "waiting";
}

const touch = (s: Source, patch: Partial<Source>, nowIso: string): Source => ({ ...s, ...patch, updatedAt: nowIso });

/** 조각을 뺀다(지우지 않는다 — 보관함에 남고 되돌릴 수 있다) */
export function dismissSource(s: Source, nowIso: string): Source {
  return touch(s, { triage: "dismissed" }, nowIso);
}

/** 뺀 조각을 다시 정리 대기로 */
export function restoreSource(s: Source, nowIso: string): Source {
  return touch(s, { triage: "inbox" }, nowIso);
}

/**
 * 조각을 다른 범주로 — 사람만(잘못 던졌을 때 칩 한 번). 범주가 바뀌면 그 조각에 걸린 열린 제안은 맞지 않으니 닫는다.
 * 이미 이어 둔 페이지와의 연결은 그대로 둔다(자료는 한 벌).
 */
export function moveSource(manifest: WorkManifest, s: Source, workspaceId: string, nowIso: string): { manifest: WorkManifest; source: Source } {
  if (s.workspaceId === workspaceId) return { manifest, source: s };
  const triage = manifest.triage.map((p) => (p.status === "open" && p.sourceIds.includes(s.id) ? { ...p, status: "rejected" as const, decidedAt: nowIso } : p));
  return { manifest: { ...manifest, triage }, source: touch(s, { workspaceId }, nowIso) };
}

/**
 * 손으로 잇기 — 제안 없이 사람이 바로 페이지에 엮는다. 다른 범주 페이지는 확인(confirmCross)을 받고서만.
 * doc 은 그 페이지 문서(묶음 속이면 rev 0 문서 — 저장하면 제 파일이 생긴다)
 */
export function fileSource(meta: PageMeta, doc: PageDoc, s: Source, nowIso: string, opts: { confirmCross?: boolean } = {}): { kind: "filed"; meta: PageMeta; doc: PageDoc; source: Source } | { kind: "needs_confirm" } {
  if (s.workspaceId !== meta.workspaceId && !opts.confirmCross) return { kind: "needs_confirm" };
  const next = linkSourceToPage(doc, s.id, s.title, nowIso);
  return { kind: "filed", doc: next, meta: syncMeta(meta, next, nowIso), source: sourceTriage(s) === "filed" ? s : touch(s, { triage: "filed" }, nowIso) };
}

/** Claude 가 낸 정리 제안(검사 전) */
export interface TriageInput {
  kind: TriageKind;
  flags?: TriageFlag[];
  sourceIds: string[];
  itemId?: string | null;
  title?: string;
  parentId?: string | null;
  goal?: string;
  concept?: string;
  note?: string;
  refs?: string[];
}

/** 받지 않은 이유 — 규칙에 어긋난 제안은 제안으로도 들이지 않는다(원문은 실행 기록에 남는다) */
export type TriageSkip = "no_source" | "unknown_source" | "cross_workspace" | "unknown_item" | "missing_field" | "duplicate";

const MAX_DECIDED_TRIAGE = 100;

/** 열린 것은 모두, 정한 것은 최근 것만 남긴다 — 매니페스트가 한없이 커지지 않게 */
function pruneTriage(list: TriageProposal[]): TriageProposal[] {
  const decided = list.filter((p) => p.status !== "open").sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? "")).slice(0, MAX_DECIDED_TRIAGE);
  const keep = new Set(decided.map((p) => p.id));
  return list.filter((p) => p.status === "open" || keep.has(p.id));
}

const triageKey = (p: Pick<TriageProposal, "kind" | "sourceIds" | "itemId" | "title" | "concept" | "parentId">) =>
  [p.kind, [...p.sourceIds].sort().join(","), p.itemId ?? "", norm(p.title ?? ""), norm(p.concept ?? ""), p.parentId ?? ""].join("|");

const livePage = (pages: PageMeta[], id: string | null | undefined) => {
  const p = pageOf(pages, id);
  return p && !p.trashedAt ? p : undefined;
};

/**
 * 정리 제안을 들인다 — 앱의 결과 가져오기와 MCP 가 같은 함수를 부른다.
 * 규칙: 조각은 모두 있어야 하고 한 범주여야 하며, 이을 페이지 · 새 페이지의 부모도 같은 범주여야 한다(Claude 는 범주를 넘지 않는다).
 * 옛 new_work 는 new_page 로(목표는 note 로). 근거(refs)가 없으면 들이되 표시한다. 같은 열린 제안은 한 번만.
 */
export function proposeTriage(
  state: TriageState,
  inputs: TriageInput[],
  nowIso: string,
  meta: { runId?: string | null; tool?: AiTool | null } = {},
): { manifest: WorkManifest; added: TriageProposal[]; skipped: { index: number; reason: TriageSkip }[] } {
  const added: TriageProposal[] = [];
  const skipped: { index: number; reason: TriageSkip }[] = [];
  const open = new Set(state.manifest.triage.filter((p) => p.status === "open").map(triageKey));
  inputs.forEach((raw, index) => {
    const x: TriageInput = raw.kind === "new_work" ? { ...raw, kind: "new_page", note: [raw.note, raw.goal].filter((v) => v?.trim()).join(" — ") || undefined } : raw;
    const ids = [...new Set((x.sourceIds ?? []).filter(Boolean))];
    if (!ids.length) return skipped.push({ index, reason: "no_source" });
    const srcs = ids.map((id) => state.sources.find((s) => s.id === id));
    if (srcs.some((s) => !s)) return skipped.push({ index, reason: "unknown_source" });
    const ws = (srcs[0] as Source).workspaceId;
    if (srcs.some((s) => (s as Source).workspaceId !== ws)) return skipped.push({ index, reason: "cross_workspace" });
    let itemId: string | null = null;
    if (x.kind === "file_source") {
      const page = livePage(state.pages, x.itemId);
      if (!page) return skipped.push({ index, reason: "unknown_item" });
      if (page.workspaceId !== ws) return skipped.push({ index, reason: "cross_workspace" });
      itemId = page.id;
    }
    let parentId: string | null = null;
    if (x.kind === "new_page" && x.parentId) {
      const parent = livePage(state.pages, x.parentId);
      if (!parent) return skipped.push({ index, reason: "unknown_item" });
      if (parent.workspaceId !== ws) return skipped.push({ index, reason: "cross_workspace" });
      parentId = parent.id;
    }
    const title = (x.title ?? "").trim().slice(0, 200);
    const concept = (x.concept ?? "").trim().slice(0, 80);
    if (x.kind === "new_page" && !title) return skipped.push({ index, reason: "missing_field" });
    if (x.kind === "concept_link" && !concept) return skipped.push({ index, reason: "missing_field" });
    const refs = (x.refs ?? []).filter((r) => typeof r === "string" && r.trim()).slice(0, 20);
    const p: TriageProposal = {
      id: newId(),
      kind: x.kind,
      status: "open",
      workspaceId: ws,
      sourceIds: ids,
      ...(itemId ? { itemId } : {}),
      ...(x.kind === "new_page" ? { title, ...(parentId ? { parentId } : {}) } : {}),
      ...(x.kind === "concept_link" ? { concept } : {}),
      ...(x.note ? { note: x.note.trim().slice(0, 500) } : {}),
      refs,
      ...((): { flags?: TriageFlag[] } => {
        const flags = [...new Set([...(refs.length ? [] : (["no_evidence"] as TriageFlag[])), ...(x.flags ?? [])])];
        return flags.length ? { flags } : {};
      })(),
      runId: meta.runId ?? null,
      tool: meta.tool ?? null,
      createdAt: nowIso,
    };
    const key = triageKey(p);
    if (open.has(key)) return skipped.push({ index, reason: "duplicate" });
    open.add(key);
    added.push(p);
  });
  return { manifest: { ...state.manifest, triage: pruneTriage([...state.manifest.triage, ...added]) }, added, skipped };
}

export type TriageAccept =
  /** pages: 바뀐 뒤 전체 색인(새 페이지 · 자료 사본) · doc: 저장할 페이지 문서 */
  | { kind: "ok"; manifest: WorkManifest; sources: Source[]; pages?: PageMeta[]; doc?: PageDoc; createdPageId?: string }
  /** 제안이 없거나 이미 정했거나, 조각 · 페이지가 사라졌다 */
  | { kind: "gone" }
  /** 사람이 고른 다른 곳이 다른 범주 — 확인 뒤 다시 */
  | { kind: "needs_confirm" }
  /** 이을 페이지의 문서가 필요하다 — 읽어서 opts.doc 으로 다시 */
  | { kind: "needs_doc"; pageId: string };

/**
 * 정리 제안을 받아들인다 — 사람만. 바뀐 색인 · 문서 · 조각 · 매니페스트를 돌려주고, 저장은 부르는 쪽이 한다.
 * opts.pageId: [다른 곳] — 제안 대신 사람이 고른 페이지에 잇는다. opts.title: 새 페이지 제목을 고쳐서. opts.doc: 이을 페이지 문서.
 */
export function acceptTriage(state: TriageState, proposalId: string, nowIso: string, opts: { pageId?: string; title?: string; confirmCross?: boolean; doc?: PageDoc | null } = {}): TriageAccept {
  const p = state.manifest.triage.find((x) => x.id === proposalId);
  if (!p || p.status !== "open") return { kind: "gone" };
  const srcs = p.sourceIds.map((id) => state.sources.find((s) => s.id === id));
  if (srcs.some((s) => !s)) return { kind: "gone" };
  const sources = srcs as Source[];
  const decided = () => ({ ...state.manifest, triage: pruneTriage(state.manifest.triage.map((x) => (x.id === proposalId ? { ...x, status: "accepted" as const, decidedAt: nowIso } : x))) });

  if (p.kind === "concept_link" && !opts.pageId) {
    const concept = p.concept as string;
    const outSources = sources.map((s) => {
      const has = (s.concepts ?? []).some((c) => norm(c) === norm(concept));
      return touch(s, { triage: "filed", concepts: has ? (s.concepts ?? []) : [...(s.concepts ?? []), concept] }, nowIso);
    });
    return { kind: "ok", manifest: decided(), sources: outSources };
  }

  let pages = state.pages;
  let meta: PageMeta | undefined;
  let doc: PageDoc | null | undefined = opts.doc;
  let createdPageId: string | undefined;
  if (opts.pageId || p.kind === "file_source") {
    meta = livePage(pages, opts.pageId ?? p.itemId);
    if (!meta) return { kind: "gone" };
    if (opts.pageId && meta.workspaceId !== p.workspaceId && !opts.confirmCross) return { kind: "needs_confirm" };
    if (!doc || doc.id !== meta.id) return { kind: "needs_doc", pageId: meta.id };
  } else {
    const parent = livePage(pages, p.parentId);
    const r = createPage(pages, { workspaceId: p.workspaceId, parentId: parent && parent.workspaceId === p.workspaceId ? parent.id : null, title: (opts.title ?? p.title ?? "").trim() || sources[0].title }, nowIso);
    if (r.kind !== "ok") return { kind: "gone" };
    pages = r.pages;
    meta = r.page;
    doc = r.doc;
    createdPageId = r.page.id;
  }
  let next = doc as PageDoc;
  for (const s of sources) next = linkSourceToPage(next, s.id, s.title, nowIso);
  const synced = syncMeta(meta, next, nowIso);
  pages = pages.map((x) => (x.id === synced.id ? synced : x));
  const outSources = sources.map((s) => (sourceTriage(s) === "filed" ? s : touch(s, { triage: "filed" }, nowIso)));
  return { kind: "ok", manifest: decided(), sources: outSources, pages, doc: next, ...(createdPageId ? { createdPageId } : {}) };
}

/**
 * 정리 제안 · 묶음 기록 · 본문 제안을 다른 쪽 최신 매니페스트에 합친다(같은 id 는 정한 쪽 · 끝난 쪽이 이긴다).
 * 앱과 MCP 가 같은 매니페스트를 번갈아 쓸 때 — 내가 바꾼 것만 얹고 상대가 더한 것은 남긴다.
 */
export function mergeTriage(cur: WorkManifest, mine: WorkManifest): WorkManifest {
  const byId = new Map(cur.triage.map((p) => [p.id, p]));
  for (const p of mine.triage) {
    const c = byId.get(p.id);
    if (!c || (c.status === "open" && p.status !== "open")) byId.set(p.id, p);
  }
  const runs = new Map((cur.triageRuns ?? []).map((r) => [r.id, r]));
  for (const r of mine.triageRuns ?? []) {
    const c = runs.get(r.id);
    if (!c || (!c.finishedAt && r.finishedAt)) runs.set(r.id, r);
  }
  return { ...cur, triage: pruneTriage([...byId.values()]), triageRuns: [...runs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).slice(-20) };
}

/** 정리 제안을 뺀다 — 조각은 정리 대기로 남는다 */
export function rejectTriage(manifest: WorkManifest, proposalId: string, nowIso: string): WorkManifest {
  const triage = manifest.triage.map((x) => (x.id === proposalId && x.status === "open" ? { ...x, status: "rejected" as const, decidedAt: nowIso } : x));
  return { ...manifest, triage: pruneTriage(triage) };
}

/* ───────────────────────── 스키마 이행(파일 단위) ───────────────────────── */

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
  m.triage ??= [];
  m.triageRuns ??= [];
  m.bodyProposals ??= [];
  m.pageRuns ??= [];
  // 3: 열린 new_work(옛 MCP · 옛 묶음) → new_page. 목표는 note 로만 남긴다
  m.triage = m.triage.map((p) =>
    p.kind === "new_work" && p.status === "open" ? { ...p, kind: "new_page" as const, note: [p.note, p.goal].filter((v) => v?.trim()).join(" — ") || undefined, goal: undefined } : p,
  );
  // 기존 사용자의 범주는 그대로 — 새 기본 범주(개발 · 독서)를 억지로 더하지 않는다. 영역(areas)은 지운다
  m.workspaces = (m.workspaces ?? fallback.workspaces).map((w) => {
    const { areas: _areas, ...rest } = w as Workspace & { areas?: unknown };
    return { ...rest, icon: w.icon ?? (w.kind === "company" ? "business" : "person"), private: w.private ?? w.kind === "company" };
  });
  m.schemaVersion = WORK_SCHEMA_VERSION;
  return m;
}
