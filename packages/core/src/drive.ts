/**
 * Google Drive REST(v3) — 작업실 저장소(DriveFileStore)와 원본 자료 읽기. fetch · 토큰은 바깥에서 받는다(테스트는 가짜 fetch).
 *
 * 범위: drive.file — 이 앱이 만든 파일과 사용자가 Picker 로 고른 파일만 보인다.
 * - 폴더를 골랐다고 그 안 파일이 다 보인다고 가정하지 않는다(listFolder 는 실제로 보이는 것만 돌려준다).
 * - Docs · Sheets · Slides 는 내려받기가 아니라 export(텍스트 · CSV)로 읽는다. PDF · 이미지 등은 링크로만 남긴다.
 * - 토큰은 기억에만 두고, 로그 · 파일에 남기지 않는다.
 *
 * 저장소 자리: 내 드라이브에 앱이 만든 보이는 폴더 하나(이름은 앱이 넘김) 아래
 *   업무 요약 폴더 — summaries/*.md (사람이 읽는다)
 *   앱 데이터 폴더 — state/* · raw/* · conflicts/* (앱이 관리한다)
 * 파일은 appProperties(llmwikiPath · llmwikiDir)로 찾는다 — 이름이 바뀌어도 깨지지 않는다.
 *
 * 요청 수: list 가 받은 id · 버전을 기억해 두고 read 는 그것으로 바로 내려받는다(불러오기 = 목록 1 + 파일 수).
 * write 는 언제나 직전에 Drive 에서 버전을 새로 확인한다 — 기억한 버전을 믿고 덮어쓰지 않는다.
 */
import { ConflictError, StoreError, type FileStore } from "./workStore.ts";
import type { IngestStatus, SourceFormat } from "./work.ts";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE = "https://www.googleapis.com";
const api = (d: DriveDeps) => `${d.origin ?? GOOGLE}/drive/v3/files`;
const upload = (d: DriveDeps) => `${d.origin ?? GOOGLE}/upload/drive/v3/files`;
const FOLDER = "application/vnd.google-apps.folder";

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

export interface DriveDeps {
  fetch: Fetch;
  /** 지금 토큰. 없으면 StoreError(auth_expired) */
  token: () => string | null;
  /** API 주소 — 기본은 Google. 개발용 로컬 Drive(tools/local-drive)를 쓸 때만 바꾼다 */
  origin?: string;
}

async function call(deps: DriveDeps, url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const token = deps.token();
  if (!token) throw new StoreError("auth_expired");
  let res;
  try {
    res = await deps.fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
  } catch (e) {
    throw new StoreError("offline", (e as Error)?.message);
  }
  if (res.status === 401) throw new StoreError("auth_expired");
  if (res.status === 403) throw new StoreError("forbidden", await res.text().catch(() => ""));
  return res;
}

const q = (s: string) => encodeURIComponent(s);
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/* ───────────────────────── 원본 자료 ───────────────────────── */

export interface DriveMeta {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  version?: string;
  trashed?: boolean;
  webViewLink?: string;
}

export function formatOf(mime: string): SourceFormat {
  if (mime === "application/vnd.google-apps.document") return "doc";
  if (mime === "application/vnd.google-apps.spreadsheet") return "sheet";
  if (mime === "application/vnd.google-apps.presentation") return "slides";
  if (mime === FOLDER) return "folder";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/") || mime === "application/json") return "text";
  return "other";
}

/** 글로 읽을 수 있는 형식과 그 방법 — 나머지는 링크로만 남긴다 */
export function readPlan(mime: string): { how: "export"; as: string } | { how: "download" } | null {
  if (mime === "application/vnd.google-apps.document") return { how: "export", as: "text/plain" };
  if (mime === "application/vnd.google-apps.spreadsheet") return { how: "export", as: "text/csv" }; // 첫 시트만
  if (mime === "application/vnd.google-apps.presentation") return { how: "export", as: "text/plain" };
  if (mime.startsWith("text/") || mime === "application/json") return { how: "download" };
  return null;
}

export const SUPPORTED_TEXT_FORMATS = ["Google Docs", "Google Sheets (CSV)", "Google Slides", "text/*", "JSON"];

export type MetaResult = { ok: true; meta: DriveMeta } | { ok: false; status: IngestStatus; error?: string };

export async function getMeta(deps: DriveDeps, fileId: string): Promise<MetaResult> {
  try {
    const res = await call(deps, `${api(deps)}/${q(fileId)}?fields=${q("id,name,mimeType,modifiedTime,version,trashed,webViewLink")}&supportsAllDrives=true`);
    if (res.status === 404) return { ok: false, status: "lost" };
    if (!res.ok) return { ok: false, status: "error", error: `HTTP ${res.status}` };
    const meta = (await res.json()) as DriveMeta;
    if (meta.trashed) return { ok: false, status: "deleted" };
    return { ok: true, meta };
  } catch (e) {
    if (e instanceof StoreError) return { ok: false, status: e.code === "auth_expired" ? "auth_expired" : e.code === "forbidden" ? "lost" : "error", error: e.code };
    return { ok: false, status: "error", error: String(e) };
  }
}

const TEXT_MAX = 200_000;

export async function readText(deps: DriveDeps, meta: DriveMeta): Promise<{ ok: true; text: string } | { ok: false; status: IngestStatus; error?: string }> {
  const plan = readPlan(meta.mimeType);
  if (!plan) return { ok: false, status: "unsupported" };
  try {
    const url = plan.how === "export" ? `${api(deps)}/${q(meta.id)}/export?mimeType=${q(plan.as)}` : `${api(deps)}/${q(meta.id)}?alt=media&supportsAllDrives=true`;
    const res = await call(deps, url);
    if (res.status === 404) return { ok: false, status: "lost" };
    if (!res.ok) return { ok: false, status: "error", error: `HTTP ${res.status}` };
    return { ok: true, text: (await res.text()).slice(0, TEXT_MAX) };
  } catch (e) {
    if (e instanceof StoreError) return { ok: false, status: e.code === "auth_expired" ? "auth_expired" : "error", error: e.code };
    return { ok: false, status: "error", error: String(e) };
  }
}

/** 고른 폴더 안에서 이 앱이 실제로 볼 수 있는 파일만 */
export async function listFolder(deps: DriveDeps, folderId: string): Promise<DriveMeta[]> {
  const res = await call(deps, `${api(deps)}?q=${q(`'${esc(folderId)}' in parents and trashed=false`)}&fields=${q("files(id,name,mimeType,modifiedTime,version,webViewLink)")}&pageSize=100`);
  if (!res.ok) return [];
  return ((await res.json()) as { files?: DriveMeta[] }).files ?? [];
}

/* ───────────────────────── 작업실 저장소 ───────────────────────── */

export interface DriveFolderNames {
  root: string;
  summaries: string;
  appData: string;
}

export class DriveFileStore implements FileStore {
  readonly kind = "drive" as const;
  private folders: { root: string; summaries: string; appData: string } | null = null;
  /** 경로 → 마지막으로 본 id · 버전(list · find · write 가 채운다) */
  private known = new Map<string, { id: string; version: string }>();

  private deps: DriveDeps;
  private names: DriveFolderNames;
  constructor(deps: DriveDeps, names: DriveFolderNames) {
    this.deps = deps;
    this.names = names;
  }

  private async folder(role: string, name: string, parent?: string): Promise<string> {
    const query = `mimeType='${FOLDER}' and trashed=false and appProperties has { key='llmwikiRole' and value='${role}' }`;
    const res = await call(this.deps, `${api(this.deps)}?q=${q(query)}&fields=${q("files(id)")}&spaces=drive`);
    if (!res.ok) throw new StoreError("unknown", `HTTP ${res.status}`);
    const found = ((await res.json()) as { files?: { id: string }[] }).files?.[0];
    if (found) return found.id;
    const made = await call(this.deps, `${api(this.deps)}?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER, appProperties: { llmwikiRole: role }, ...(parent ? { parents: [parent] } : {}) }),
    });
    if (!made.ok) throw new StoreError("unknown", `HTTP ${made.status}`);
    return ((await made.json()) as { id: string }).id;
  }

  /** 연결할 때 한 번 — 폴더가 없으면 만든다 */
  async ensureFolders() {
    if (this.folders) return this.folders;
    const root = await this.folder("root", this.names.root);
    const summaries = await this.folder("summaries", this.names.summaries, root);
    const appData = await this.folder("appData", this.names.appData, root);
    this.folders = { root, summaries, appData };
    return this.folders;
  }

  rootFolderUrl(): string | null {
    return this.folders ? `https://drive.google.com/drive/folders/${this.folders.root}` : null;
  }

  private dirOf(path: string) {
    return path.slice(0, path.lastIndexOf("/") + 1);
  }

  private async find(path: string): Promise<{ id: string; version: string } | null> {
    await this.ensureFolders();
    const query = `trashed=false and appProperties has { key='llmwikiPath' and value='${esc(path)}' }`;
    const res = await call(this.deps, `${api(this.deps)}?q=${q(query)}&fields=${q("files(id,version)")}`);
    if (!res.ok) throw new StoreError("unknown", `HTTP ${res.status}`);
    const f = ((await res.json()) as { files?: { id: string; version: string }[] }).files?.[0];
    if (f) this.known.set(path, { id: f.id, version: String(f.version) });
    else this.known.delete(path);
    return f ? { id: f.id, version: String(f.version) } : null;
  }

  async list(prefix: string): Promise<string[]> {
    await this.ensureFolders();
    const out: string[] = [];
    let pageToken = "";
    do {
      const query = `trashed=false and appProperties has { key='llmwikiDir' and value='${esc(prefix)}' }`;
      const res = await call(this.deps, `${api(this.deps)}?q=${q(query)}&fields=${q("nextPageToken,files(id,version,appProperties)")}&pageSize=200${pageToken ? `&pageToken=${q(pageToken)}` : ""}`);
      if (!res.ok) throw new StoreError("unknown", `HTTP ${res.status}`);
      const body = (await res.json()) as { nextPageToken?: string; files?: { id: string; version?: string; appProperties?: Record<string, string> }[] };
      for (const f of body.files ?? []) {
        const p = f.appProperties?.llmwikiPath;
        if (p) {
          out.push(p);
          if (f.version != null) this.known.set(p, { id: f.id, version: String(f.version) });
        }
      }
      pageToken = body.nextPageToken ?? "";
    } while (pageToken);
    return out.sort();
  }

  async read(path: string) {
    // 목록에서 본 파일은 찾기 없이 바로 — 그사이 지워졌으면(404) 한 번만 다시 찾는다
    const cached = this.known.get(path);
    const f = cached ?? (await this.find(path));
    if (!f) return null;
    let res = await call(this.deps, `${api(this.deps)}/${q(f.id)}?alt=media`);
    if (res.status === 404 && cached) {
      const again = await this.find(path);
      if (!again) return null;
      res = await call(this.deps, `${api(this.deps)}/${q(again.id)}?alt=media`);
      if (res.status === 404) return null;
      if (!res.ok) throw new StoreError("unknown", `HTTP ${res.status}`);
      return { text: await res.text(), version: again.version };
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new StoreError("unknown", `HTTP ${res.status}`);
    return { text: await res.text(), version: f.version };
  }

  async write(path: string, text: string, expected: string | null) {
    const f = await this.find(path);
    // Drive v3 는 조건부 쓰기(If-Match)를 받지 않는다 — 바로 앞에서 버전을 맞춰 본다(한 사람 · 한 기기 쓰기 기준)
    if ((f ? String(f.version) : null) !== expected) {
      const remote = f ? await this.read(path) : null;
      throw new ConflictError(path, remote);
    }
    const mime = path.endsWith(".md") ? "text/markdown" : path.endsWith(".txt") ? "text/plain" : "application/json";
    let res;
    if (f) {
      res = await call(this.deps, `${upload(this.deps)}/${q(f.id)}?uploadType=media&fields=id,version`, { method: "PATCH", headers: { "Content-Type": mime }, body: text });
    } else {
      const folders = await this.ensureFolders();
      const parent = path.startsWith("summaries/") ? folders.summaries : folders.appData;
      const boundary = `llmwiki${Date.now().toString(36)}`;
      const meta = { name: path.slice(path.lastIndexOf("/") + 1), parents: [parent], mimeType: mime, appProperties: { llmwikiPath: path, llmwikiDir: this.dirOf(path) } };
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n${text}\r\n--${boundary}--`;
      res = await call(this.deps, `${upload(this.deps)}?uploadType=multipart&fields=id,version`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
    }
    if (!res.ok) throw new StoreError("unknown", `HTTP ${res.status}`);
    const out = (await res.json()) as { id: string; version: string };
    this.known.set(path, { id: out.id, version: String(out.version) });
    return { version: String(out.version) };
  }

  async remove(path: string) {
    const f = await this.find(path);
    if (!f) return;
    // 영구 삭제가 아니라 휴지통으로
    await call(this.deps, `${api(this.deps)}/${q(f.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
    this.known.delete(path);
  }
}
