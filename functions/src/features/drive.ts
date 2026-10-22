/**
 * Drive 열쇠 — 서버가 사용자의 Drive refresh token 을 암호화해 보관하고, 필요할 때 1시간짜리 access token 을 낸다.
 * 원칙: docs/architecture.md "Drive 열쇠". 규칙 코드는 driveTokens.ts.
 *
 * - POST driveLink { code }   웹(GIS 코드 방식)이 받은 코드를 바꿔 보관 → { accessToken, expiresAt, email }
 * - POST driveToken {}        보관한 열쇠로 새 access token → 새 탭 · 만료 때 팝업 없이 이어 쓴다
 * - POST driveUnlink {}       Google 에서 열쇠를 거두고 보관본을 지운다
 * - POST driveStatus {}       연결 여부 · 계정 · 연결 시각(열쇠는 돌려주지 않는다)
 * - POST driveListWork {}     서버가 사용자 Drive 의 페이지 목록을 읽는다(색인의 제목 · 범주 · 부모만 돌려주고 저장 · 로그하지 않는다 — driveList.ts)
 *
 * 익명 사용자는 쓰지 못한다 — 열쇠의 주인을 Google 계정으로 확인할 수 있을 때만 보관한다.
 * 보관 자리 driveLinks/{uid} 는 Firestore 규칙상 앱이 읽을 수 없다(서버 Admin 만).
 */
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/https";
import { defineSecret } from "firebase-functions/params";

import { DriveFileStore } from "../../../packages/core/src/drive.ts";
import { REGION, requireUid } from "../common.ts";
import { listPages } from "../driveList.ts";
import { DriveTokenError, exchangeCode, keyFrom, refreshAccess, revoke, seal, unseal, type Fetch, type OAuthClient, type SealedToken } from "../driveTokens.ts";

const CLIENT_SECRET = defineSecret("GOOGLE_OAUTH_CLIENT_SECRET");
const TOKEN_KEY = defineSecret("DRIVE_TOKEN_KEY");
/** 공개값(웹 앱에도 들어 있다) — Firebase 가 만든 웹 OAuth 클라이언트 */
const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? "946261881838-5vr970sp0csucfb56lq5gjhj92arld3k.apps.googleusercontent.com";
export const SECRETS = { region: REGION, secrets: [CLIENT_SECRET, TOKEN_KEY] };

interface LinkDoc {
  sealed: SealedToken;
  scope: string[];
  email: string | null;
  linkedAt: string;
  lastUsedAt: string | null;
}

const linkRef = (uid: string) => getFirestore().collection("driveLinks").doc(uid);
const client = (): OAuthClient => ({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET.value() });
const http: Fetch = (url, init) => fetch(url, init);

export function requireGoogleUser(req: CallableRequest<unknown>): string {
  const uid = requireUid(req);
  const provider = (req.auth?.token as { firebase?: { sign_in_provider?: string } } | undefined)?.firebase?.sign_in_provider;
  if (provider === "anonymous") throw new HttpsError("permission-denied", "Drive 를 서버에 이어 두려면 Google 로 로그인해 주세요.");
  return uid;
}

function fail(e: unknown): never {
  if (e instanceof DriveTokenError) {
    const map: Record<DriveTokenError["code"], [string, "failed-precondition" | "invalid-argument" | "not-found" | "internal" | "unavailable"]> = {
      no_refresh_token: ["Google 이 오래 쓸 열쇠를 주지 않았어요. 한 번 더 연결해 주세요.", "failed-precondition"],
      bad_scope: ["Drive 권한 범위가 맞지 않아요(drive.file 만 허용). 다시 연결해 주세요.", "invalid-argument"],
      invalid_grant: ["Google 계정에서 Drive 권한이 거둬졌어요. 다시 연결해 주세요.", "failed-precondition"],
      exchange_failed: ["Google 과 열쇠를 주고받지 못했어요. 잠시 뒤 다시 해 주세요.", "unavailable"],
      not_linked: ["서버에 이어 둔 Drive 가 없어요.", "not-found"],
      bad_key: ["서버 설정 오류(DRIVE_TOKEN_KEY).", "internal"],
    };
    const [msg, code] = map[e.code];
    throw new HttpsError(code, msg, { reason: e.code });
  }
  throw e;
}

/** 보관한 열쇠 → 새 access token. 거둬진 열쇠면 보관본을 지운다(MCP 토큰 발급도 이것을 쓴다) */
export async function accessFor(uid: string): Promise<{ accessToken: string; expiresAt: number; email: string | null }> {
  const snap = await linkRef(uid).get();
  if (!snap.exists) throw new DriveTokenError("not_linked");
  const doc = snap.data() as LinkDoc;
  const key = keyFrom(TOKEN_KEY.value());
  try {
    const r = await refreshAccess(http, client(), unseal(key, uid, doc.sealed));
    await linkRef(uid).update({ lastUsedAt: new Date().toISOString() });
    return { ...r, email: doc.email };
  } catch (e) {
    if (e instanceof DriveTokenError && e.code === "invalid_grant") {
      await linkRef(uid).delete();
      logger.info("drive link dropped (invalid_grant)", { uid });
    }
    throw e;
  }
}

export const driveLink = onCall<{ code?: string }>(SECRETS, async (req) => {
  const uid = requireGoogleUser(req);
  const code = typeof req.data?.code === "string" ? req.data.code.trim() : "";
  if (!code || code.length > 2048) throw new HttpsError("invalid-argument", "code 가 필요해요.");
  try {
    const r = await exchangeCode(http, client(), code);
    // 이미 이어 둔 열쇠가 있으면 먼저 거둔다(한 사용자 = 열쇠 하나)
    const old = await linkRef(uid).get();
    if (old.exists) {
      const prev = unseal(keyFrom(TOKEN_KEY.value()), uid, (old.data() as LinkDoc).sealed);
      if (prev !== r.refreshToken) await revoke(http, prev).catch(() => undefined);
    }
    const doc: LinkDoc = { sealed: seal(keyFrom(TOKEN_KEY.value()), uid, r.refreshToken), scope: r.scope, email: r.email, linkedAt: new Date().toISOString(), lastUsedAt: null };
    await linkRef(uid).set(doc);
    logger.info("drive linked", { uid, scope: r.scope });
    return { accessToken: r.accessToken, expiresAt: r.expiresAt, email: r.email };
  } catch (e) {
    fail(e);
  }
});

export const driveToken = onCall(SECRETS, async (req) => {
  const uid = requireGoogleUser(req);
  try {
    return await accessFor(uid);
  } catch (e) {
    fail(e);
  }
});

export const driveUnlink = onCall(SECRETS, async (req) => {
  const uid = requireGoogleUser(req);
  const snap = await linkRef(uid).get();
  if (!snap.exists) return { ok: true, revoked: false };
  let revoked = false;
  try {
    await revoke(http, unseal(keyFrom(TOKEN_KEY.value()), uid, (snap.data() as LinkDoc).sealed));
    revoked = true;
  } catch (e) {
    logger.warn("drive revoke failed — deleting anyway", { uid, error: e instanceof Error ? e.message : String(e) });
  }
  await linkRef(uid).delete();
  // MCP 열쇠는 이 연결로만 쓸모가 있다 — 함께 지운다
  const keys = await getFirestore().collection("mcpKeys").where("uid", "==", uid).get();
  await Promise.all(keys.docs.map((d) => d.ref.delete()));
  logger.info("drive unlinked", { uid, revoked, mcpKeys: keys.size });
  return { ok: true, revoked };
});

export const driveStatus = onCall({ region: REGION }, async (req) => {
  const uid = requireUid(req);
  const snap = await linkRef(uid).get();
  if (!snap.exists) return { linked: false };
  const d = snap.data() as LinkDoc;
  return { linked: true, email: d.email, scope: d.scope, linkedAt: d.linkedAt, lastUsedAt: d.lastUsedAt };
});

/**
 * 서버가 사용자 Drive 를 읽는 길 — 앞으로 MCP · Gemma 연결부가 같은 accessFor 를 쓴다.
 * 지금은 페이지 목록(제목 · 범주 · 부모 · 마지막 수정)만 돌려준다(driveList.ts). 읽은 내용은 저장하지도 로그에 남기지도 않는다.
 */
export const driveListWork = onCall({ ...SECRETS, timeoutSeconds: 60 }, async (req) => {
  const uid = requireGoogleUser(req);
  let access: string;
  try {
    access = (await accessFor(uid)).accessToken;
  } catch (e) {
    fail(e);
  }
  const store = new DriveFileStore({ fetch: http as never, token: () => access }, { root: "llmwiki 작업실", summaries: "업무 요약", appData: "앱 데이터(직접 고치지 마세요)" });
  const { items, source } = await listPages(store);
  logger.info("drive read by server", { uid, action: "listPages", source, count: items.length });
  await linkRef(uid).update({ lastUsedAt: new Date().toISOString(), reads: FieldValue.increment(1) }).catch(() => undefined);
  return { items };
});
