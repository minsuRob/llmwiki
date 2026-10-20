/**
 * Drive 열쇠(refresh token) 보관 — 서버만 쓴다. 원칙은 docs/architecture.md "Drive 열쇠".
 *
 * - 범위는 drive.file(+ 계정 확인용 openid · email)만 받는다. 더 넓은 Drive 범위가 오면 저장하지 않고 폐기한다.
 * - refresh token 은 AES-256-GCM 으로 암호화해 driveLinks/{uid} 에 둔다(규칙상 앱은 못 읽는다). 키는 Functions secret.
 * - access token 은 저장하지 않는다. 필요할 때 받아 쓰고 1시간 안에 끝난다. 토큰 · Drive 내용은 로그에 남기지 않는다.
 * - Google 이 열쇠를 거절하면(invalid_grant — 사용자가 Google 계정에서 권한을 거뒀다) 보관본을 바로 지운다.
 * 순수 부분(암호화 · 응답 해석)은 fetch 를 받아서 시험한다(driveTokens.test.ts).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
/** 받으면 안 되는 넓은 범위 — 우리 앱은 drive.file 만 쓴다 */
const BROAD_SCOPES = ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.metadata"];
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

/** 저장 모양 — 평문 토큰은 없다 */
export interface SealedToken {
  v: 1;
  iv: string;
  tag: string;
  ct: string;
}

export class DriveTokenError extends Error {
  readonly code: "no_refresh_token" | "bad_scope" | "invalid_grant" | "exchange_failed" | "not_linked" | "bad_key";
  constructor(code: DriveTokenError["code"], message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

/** 암호화 키 — 32바이트(base64 또는 hex 64자) */
export function keyFrom(secret: string): Buffer {
  const s = secret.trim();
  const k = /^[0-9a-f]{64}$/i.test(s) ? Buffer.from(s, "hex") : Buffer.from(s, "base64");
  if (k.length !== 32) throw new DriveTokenError("bad_key", "DRIVE_TOKEN_KEY 는 32바이트여야 한다");
  return k;
}

/** uid 를 덧붙인 데이터(AAD)로 묶는다 — 다른 사용자 문서로 옮겨 붙이면 풀리지 않는다 */
export function seal(key: Buffer, uid: string, refreshToken: string): SealedToken {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(`llmwiki-drive:${uid}`));
  const ct = Buffer.concat([c.update(refreshToken, "utf8"), c.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64") };
}

export function unseal(key: Buffer, uid: string, s: SealedToken): string {
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(s.iv, "base64"));
  d.setAAD(Buffer.from(`llmwiki-drive:${uid}`));
  d.setAuthTag(Buffer.from(s.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(s.ct, "base64")), d.final()]).toString("utf8");
}

const form = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
const POST = (body: Record<string, string>) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(body) });

/** id_token 의 email — Google 토큰 창구에서 TLS 로 바로 받은 것이라 서명 검증 없이 읽는다(표시 · 대조용) */
function emailOf(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string; email_verified?: boolean };
    return payload.email_verified === false ? null : (payload.email ?? null);
  } catch {
    return null;
  }
}

export interface Linked {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  scope: string[];
  email: string | null;
}

/**
 * 웹(GIS 코드 방식 · popup)이 받은 코드를 바꾼다. redirect_uri 는 popup 방식의 약속값 "postmessage".
 * refresh token 이 없거나 범위가 맞지 않으면 받은 토큰을 바로 폐기하고 거절한다(넓은 권한을 들고 있지 않게).
 */
export async function exchangeCode(fetch: Fetch, client: OAuthClient, code: string, now = Date.now()): Promise<Linked> {
  const res = await fetch(TOKEN_URL, POST({ code, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: "postmessage", grant_type: "authorization_code" }));
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string; error?: string };
  if (!res.ok || !body.access_token) throw new DriveTokenError("exchange_failed", body.error ?? `HTTP ${res.status}`);
  const scope = (body.scope ?? "").split(/\s+/).filter(Boolean);
  const bad = !scope.includes(DRIVE_FILE_SCOPE) || scope.some((s) => BROAD_SCOPES.includes(s));
  if (bad || !body.refresh_token) {
    await revoke(fetch, body.refresh_token ?? body.access_token).catch(() => undefined);
    throw new DriveTokenError(bad ? "bad_scope" : "no_refresh_token");
  }
  return { refreshToken: body.refresh_token, accessToken: body.access_token, expiresAt: now + (body.expires_in ?? 3600) * 1000 - 60_000, scope, email: emailOf(body.id_token) };
}

/** 보관한 열쇠로 1시간짜리 access token 을 받는다. 거절되면 invalid_grant(보관본을 지워야 한다) */
export async function refreshAccess(fetch: Fetch, client: OAuthClient, refreshToken: string, now = Date.now()): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetch(TOKEN_URL, POST({ refresh_token: refreshToken, client_id: client.clientId, client_secret: client.clientSecret, grant_type: "refresh_token" }));
  const body = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (body.error === "invalid_grant") throw new DriveTokenError("invalid_grant");
  if (!res.ok || !body.access_token) throw new DriveTokenError("exchange_failed", body.error ?? `HTTP ${res.status}`);
  return { accessToken: body.access_token, expiresAt: now + (body.expires_in ?? 3600) * 1000 - 60_000 };
}

/** Google 에 열쇠를 거둬 달라고 한다(이미 거둬졌으면 그대로 성공으로 본다) */
export async function revoke(fetch: Fetch, token: string): Promise<void> {
  const res = await fetch(REVOKE_URL, POST({ token }));
  if (!res.ok && res.status !== 400) throw new DriveTokenError("exchange_failed", `revoke HTTP ${res.status}`);
}
