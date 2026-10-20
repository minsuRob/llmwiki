import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { DRIVE_FILE_SCOPE, DriveTokenError, exchangeCode, keyFrom, refreshAccess, revoke, seal, unseal, type Fetch } from "./driveTokens.ts";

const KEY = randomBytes(32);
const CLIENT = { clientId: "cid", clientSecret: "secret" };
const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email, email_verified: true })).toString("base64url")}.y`;

function fakeFetch(responses: Record<string, { status?: number; body: unknown }>) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  const f: Fetch = async (url, init) => {
    const body = new URLSearchParams(init.body);
    calls.push({ url, body });
    const key = url.endsWith("/revoke") ? "revoke" : (body.get("grant_type") ?? "?");
    const r = responses[key] ?? { status: 200, body: {} };
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body };
  };
  return { f, calls };
}

test("암호화 — 풀면 같고, 다른 사용자 uid 로는 풀리지 않는다(문서를 옮겨 붙여도 못 씀)", () => {
  const s = seal(KEY, "u1", "1//refresh");
  assert.equal(unseal(KEY, "u1", s), "1//refresh");
  assert.ok(!JSON.stringify(s).includes("refresh"), "저장본에 평문이 없다");
  assert.throws(() => unseal(KEY, "u2", s));
  assert.throws(() => unseal(randomBytes(32), "u1", s));
  assert.equal(keyFrom(KEY.toString("base64")).length, 32);
  assert.throws(() => keyFrom("짧은 키"), DriveTokenError);
});

test("코드 교환 — drive.file 이면 열쇠 · 이메일을 받는다", async () => {
  const { f, calls } = fakeFetch({ authorization_code: { body: { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: `openid email ${DRIVE_FILE_SCOPE}`, id_token: idToken("a@b.c") } } });
  const r = await exchangeCode(f, CLIENT, "code-1", 0);
  assert.deepEqual([r.refreshToken, r.accessToken, r.email], ["rt", "at", "a@b.c"]);
  assert.equal(r.expiresAt, 3600_000 - 60_000);
  assert.equal(calls[0].body.get("redirect_uri"), "postmessage");
  assert.equal(calls[0].body.get("client_secret"), "secret");
});

test("코드 교환 — 넓은 Drive 범위 · refresh token 없음은 거절하고 받은 토큰을 폐기한다", async () => {
  const broad = fakeFetch({ authorization_code: { body: { access_token: "at", refresh_token: "rt", scope: `${DRIVE_FILE_SCOPE} https://www.googleapis.com/auth/drive` } } });
  await assert.rejects(exchangeCode(broad.f, CLIENT, "c"), (e: DriveTokenError) => e.code === "bad_scope");
  assert.equal(broad.calls.at(-1)?.url, "https://oauth2.googleapis.com/revoke");
  assert.equal(broad.calls.at(-1)?.body.get("token"), "rt");

  const none = fakeFetch({ authorization_code: { body: { access_token: "at", scope: DRIVE_FILE_SCOPE } } });
  await assert.rejects(exchangeCode(none.f, CLIENT, "c"), (e: DriveTokenError) => e.code === "no_refresh_token");
  assert.equal(none.calls.at(-1)?.body.get("token"), "at");

  const fail = fakeFetch({ authorization_code: { status: 400, body: { error: "invalid_grant" } } });
  await assert.rejects(exchangeCode(fail.f, CLIENT, "c"), (e: DriveTokenError) => e.code === "exchange_failed");
});

test("새 access token — 거둬진 열쇠는 invalid_grant 로 알린다", async () => {
  const ok = fakeFetch({ refresh_token: { body: { access_token: "at2", expires_in: 100 } } });
  assert.deepEqual(await refreshAccess(ok.f, CLIENT, "rt", 0), { accessToken: "at2", expiresAt: 40_000 });
  const gone = fakeFetch({ refresh_token: { status: 400, body: { error: "invalid_grant" } } });
  await assert.rejects(refreshAccess(gone.f, CLIENT, "rt"), (e: DriveTokenError) => e.code === "invalid_grant");
});

test("폐기 — 이미 거둬진 열쇠(400)도 성공으로 본다", async () => {
  await revoke(fakeFetch({ revoke: { status: 400, body: {} } }).f, "rt");
  await assert.rejects(revoke(fakeFetch({ revoke: { status: 500, body: {} } }).f, "rt"));
});
