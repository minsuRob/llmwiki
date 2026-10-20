/**
 * 웹 — Google Identity Services(토큰) + Google Picker(파일 고르기). 웹에서만 되는 경우라 DOM 스크립트를 쓴다.
 * - 범위는 drive.file 하나 — 사용자가 고른 파일과 이 앱이 만든 파일만 보인다.
 * - 토큰은 이 탭의 sessionStorage 에만, 만료 시각과 함께 둔다(탭을 닫으면 사라진다 · localStorage · 로그 · 파일 금지).
 *   새로고침해도 다시 동의하지 않게. 만료되면 동의 화면 없이(prompt "") 한 번 눌러 다시 받는다.
 *   브라우저는 사용자가 누르지 않은 팝업을 막으므로, 앱을 열 때 저절로 다시 받지는 못한다.
 * - Firebase(Google) 로그인과 따로 묻는다 — 로그인했다고 Drive 에 들어가지 않는다.
 */
import { DRIVE_SCOPE } from "../../../../../packages/core/src/drive.ts";
import { driveConfig } from "./config";

export interface DriveToken {
  token: string;
  expiresAt: number;
}

export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
  url: string | null;
}

export class DriveAuthError extends Error {
  readonly code: "cancelled" | "not_configured" | "unsupported" | "failed";
  constructor(code: DriveAuthError["code"], message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export const DRIVE_PLATFORM_SUPPORTED = true;

type G = any;
const w = () => globalThis as unknown as { google?: G; gapi?: G; document: Document };

const loaded = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  const hit = loaded.get(src);
  if (hit) return hit;
  const p = new Promise<void>((resolve, reject) => {
    const s = w().document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loaded.delete(src);
      reject(new DriveAuthError("failed", `script ${src}`));
    };
    w().document.head.appendChild(s);
  });
  loaded.set(src, p);
  return p;
}

export async function requestDriveToken(opts: { interactive: boolean; hint?: string | null }): Promise<DriveToken> {
  if (!driveConfig) throw new DriveAuthError("not_configured");
  await loadScript("https://accounts.google.com/gsi/client");
  const google = w().google;
  return new Promise<DriveToken>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: driveConfig!.clientId,
      scope: DRIVE_SCOPE,
      ...(opts.hint ? { hint: opts.hint } : {}),
      callback: (r: { access_token?: string; expires_in?: number; error?: string; scope?: string }) => {
        if (!r.access_token) return reject(new DriveAuthError(r.error === "access_denied" ? "cancelled" : "failed", r.error));
        // 사용자가 동의 화면에서 Drive 칸을 끄면 토큰은 와도 범위가 없다
        if (r.scope && !r.scope.split(" ").includes(DRIVE_SCOPE)) return reject(new DriveAuthError("cancelled", "scope"));
        resolve({ token: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 - 60_000 });
      },
      error_callback: (e: { type?: string }) => reject(new DriveAuthError(e?.type === "popup_closed" ? "cancelled" : "failed", e?.type)),
    });
    client.requestAccessToken({ prompt: opts.interactive ? "consent" : "" });
  });
}

export function revokeDriveToken(token: string): void {
  try {
    w().google?.accounts?.oauth2?.revoke(token, () => undefined);
  } catch {
    /* 이미 끊겼다 */
  }
}

/** 파일 고르기 — 여러 개. 폴더도 고를 수 있지만 안의 파일까지 열린다고 가정하지 않는다 */
export async function pickDriveFiles(token: string): Promise<PickedFile[] | null> {
  if (!driveConfig) throw new DriveAuthError("not_configured");
  await loadScript("https://apis.google.com/js/api.js");
  const gapi = w().gapi;
  await new Promise<void>((resolve) => gapi.load("picker", () => resolve()));
  const google = w().google;
  return new Promise((resolve) => {
    const docs = new google.picker.DocsView(google.picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(true);
    const picker = new google.picker.PickerBuilder()
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .setDeveloperKey(driveConfig!.apiKey)
      .setAppId(driveConfig!.appId)
      .setOAuthToken(token)
      .addView(docs)
      .setCallback((data: Record<string, any>) => {
        const action = data[google.picker.Response.ACTION];
        if (action === google.picker.Action.PICKED) {
          const list = (data[google.picker.Response.DOCUMENTS] ?? []) as Record<string, any>[];
          resolve(
            list.map((d) => ({
              id: String(d[google.picker.Document.ID]),
              name: String(d[google.picker.Document.NAME] ?? ""),
              mimeType: String(d[google.picker.Document.MIME_TYPE] ?? ""),
              url: d[google.picker.Document.URL] ? String(d[google.picker.Document.URL]) : null,
            })),
          );
        } else if (action === google.picker.Action.CANCEL) resolve(null);
      })
      .build();
    picker.setVisible(true);
  });
}

const tokenKey = (uid: string) => `llmwiki:drive-token:${uid}`;
const session = (): Storage | null => {
  try {
    return (globalThis as unknown as { sessionStorage?: Storage }).sessionStorage ?? null;
  } catch {
    return null;
  }
};

/** 이 탭에 토큰을 기억한다(null 이면 지운다) */
export function rememberDriveToken(uid: string, t: DriveToken | null): void {
  try {
    if (t) session()?.setItem(tokenKey(uid), JSON.stringify(t));
    else session()?.removeItem(tokenKey(uid));
  } catch {
    /* 저장소를 못 쓰면 기억만 못 할 뿐 */
  }
}

/** 이 탭에 기억한 토큰 — 1분 안에 끝나면 없는 것으로 본다 */
export function recallDriveToken(uid: string): DriveToken | null {
  try {
    const raw = session()?.getItem(tokenKey(uid));
    if (!raw) return null;
    const t = JSON.parse(raw) as DriveToken;
    if (typeof t.token !== "string" || !(t.expiresAt > Date.now() + 60_000)) {
      session()?.removeItem(tokenKey(uid));
      return null;
    }
    return t;
  } catch {
    return null;
  }
}
