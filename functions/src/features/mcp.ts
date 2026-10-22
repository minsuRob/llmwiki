/**
 * MCP 열쇠 — 이 컴퓨터의 MCP(tools/llmwiki-mcp)가 사용자 Drive 에 쓸 1시간 access token 을 받는 길.
 * 원칙: docs/architecture.md 원칙 4 의 표("MCP 에 내주는 것" · "MCP 열쇠"). 열쇠 모양 · 해시: mcpKeys.ts
 *
 * - POST mcpKeyCreate { label }   (앱, Google 로그인 + 서버에 Drive 를 이은 사용자) 새 열쇠 — 열쇠는 이 응답에서 한 번만
 * - POST mcpKeyList {}            (앱) 이름 · 만든 시각 · 마지막 사용 — 열쇠 · 해시는 돌려주지 않는다
 * - POST mcpKeyRevoke { id }      (앱) 거두기 — 바로 막힌다
 * - POST mcpDriveToken            (MCP, Authorization: Bearer lwk_…) → { accessToken, expiresAt, email }
 *
 * refresh token 은 서버 밖으로 나가지 않는다. 열쇠 · 토큰은 로그에 남기지 않는다.
 */
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall, onRequest } from "firebase-functions/https";

import { REGION, requireUid } from "../common.ts";
import { DriveTokenError } from "../driveTokens.ts";
import { MAX_MCP_KEYS, cleanLabel, newMcpKey, parseMcpKey, verifyMcpSecret, type McpKeyDoc } from "../mcpKeys.ts";
import { SECRETS, accessFor, requireGoogleUser } from "./drive.ts";

const keys = () => getFirestore().collection("mcpKeys");
const linkRef = (uid: string) => getFirestore().collection("driveLinks").doc(uid);

export const mcpKeyCreate = onCall<{ label?: string }>({ region: REGION }, async (req) => {
  const uid = requireGoogleUser(req);
  if (!(await linkRef(uid).get()).exists) throw new HttpsError("failed-precondition", "먼저 Drive 를 서버에 이어 주세요(설정 → Drive).", { reason: "not_linked" });
  const mine = await keys().where("uid", "==", uid).get();
  if (mine.size >= MAX_MCP_KEYS) throw new HttpsError("resource-exhausted", `MCP 열쇠는 ${MAX_MCP_KEYS}개까지예요. 쓰지 않는 열쇠를 거둬 주세요.`, { reason: "too_many" });
  const k = newMcpKey();
  const doc: McpKeyDoc = { uid, hash: k.hash, label: cleanLabel(req.data?.label), createdAt: new Date().toISOString(), lastUsedAt: null };
  await keys().doc(k.id).create(doc);
  logger.info("mcp key created", { uid, keyId: k.id });
  return { id: k.id, key: k.key, label: doc.label, createdAt: doc.createdAt };
});

export const mcpKeyList = onCall({ region: REGION }, async (req) => {
  const uid = requireUid(req);
  const snap = await keys().where("uid", "==", uid).get();
  const list = snap.docs.map((d) => {
    const x = d.data() as McpKeyDoc;
    return { id: d.id, label: x.label, createdAt: x.createdAt, lastUsedAt: x.lastUsedAt };
  });
  return { keys: list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
});

export const mcpKeyRevoke = onCall<{ id?: string }>({ region: REGION }, async (req) => {
  const uid = requireUid(req);
  const id = typeof req.data?.id === "string" ? req.data.id : "";
  const ref = keys().doc(id || "-");
  const snap = id ? await ref.get() : null;
  // 남의 열쇠는 있어도 없는 것처럼
  if (!snap?.exists || (snap.data() as McpKeyDoc).uid !== uid) return { ok: true, revoked: false };
  await ref.delete();
  logger.info("mcp key revoked", { uid, keyId: id });
  return { ok: true, revoked: true };
});

type Res = { status(code: number): Res; json(body: unknown): void; set(k: string, v: string): Res };
const deny = (res: Res, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });

export const mcpDriveToken = onRequest({ ...SECRETS, cors: false, timeoutSeconds: 30 }, async (req, res: Res) => {
  res.set("Cache-Control", "no-store");
  if (req.method !== "POST") return deny(res, 405, "method", "POST 로 불러 주세요.");
  const parsed = parseMcpKey(req.get("authorization"));
  if (!parsed) return deny(res, 401, "bad_key", "MCP 열쇠가 없거나 모양이 틀려요.");
  const ref = keys().doc(parsed.id);
  const snap = await ref.get();
  const doc = snap.exists ? (snap.data() as McpKeyDoc) : null;
  if (!doc || !verifyMcpSecret(doc, parsed.secret)) return deny(res, 401, "bad_key", "MCP 열쇠가 틀렸거나 거둬졌어요. 설정에서 새로 만들어 주세요.");
  try {
    const r = await accessFor(doc.uid);
    await ref.update({ lastUsedAt: new Date().toISOString() }).catch(() => undefined);
    logger.info("mcp token issued", { uid: doc.uid, keyId: parsed.id });
    return res.status(200).json({ accessToken: r.accessToken, expiresAt: r.expiresAt, email: r.email });
  } catch (e) {
    if (e instanceof DriveTokenError) {
      if (e.code === "not_linked") return deny(res, 404, "not_linked", "서버에 이어 둔 Drive 가 없어요. 앱 설정에서 Drive 를 다시 이어 주세요.");
      if (e.code === "invalid_grant") return deny(res, 409, "invalid_grant", "Google 계정에서 Drive 권한이 거둬졌어요. 앱에서 다시 이어 주세요.");
      if (e.code === "exchange_failed") return deny(res, 503, "unavailable", "Google 과 열쇠를 주고받지 못했어요. 잠시 뒤 다시 해 주세요.");
    }
    logger.error("mcp token failed", { uid: doc.uid, keyId: parsed.id, error: e instanceof Error ? e.message : String(e) });
    return deny(res, 500, "internal", "토큰을 내지 못했어요.");
  }
});
