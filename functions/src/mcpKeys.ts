/**
 * MCP 열쇠 — 이 컴퓨터의 MCP(tools/llmwiki-mcp)가 서버에서 1시간짜리 Drive access token 을 받을 때 내미는 열쇠.
 * 원칙: docs/architecture.md 원칙 4 의 표("MCP 열쇠"). 순수 함수(테스트: mcpKeys.test.ts).
 *
 * 모양: lwk_<id>.<secret>  — id 는 문서 이름(찾기용), secret 은 256비트 무작위(base64url).
 * 서버엔 secret 의 SHA-256 만 둔다. 무작위 256비트라 느린 해시가 필요 없다. 비교는 시간 일정하게.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const MCP_KEY_PREFIX = "lwk_";
export const MAX_MCP_KEYS = 5;
const ID = /^[0-9a-z]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

export interface McpKeyDoc {
  uid: string;
  /** secret 의 SHA-256(hex) */
  hash: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export const hashSecret = (secret: string) => createHash("sha256").update(secret, "utf8").digest("hex");

/** 새 열쇠 — key 는 사용자에게 한 번만 보이고, 서버엔 id · hash 만 남는다 */
export function newMcpKey(rand: (n: number) => Buffer = randomBytes): { id: string; key: string; hash: string } {
  const id = Array.from(rand(12), (b) => "0123456789abcdefghijklmnopqrstuvwxyz"[b % 36]).join("");
  const secret = rand(32).toString("base64url");
  return { id, key: `${MCP_KEY_PREFIX}${id}.${secret}`, hash: hashSecret(secret) };
}

/** Authorization 머리말이나 열쇠 문자열 → id · secret. 모양이 틀리면 null */
export function parseMcpKey(raw: string | null | undefined): { id: string; secret: string } | null {
  const v = (raw ?? "").trim().replace(/^Bearer\s+/i, "");
  if (!v.startsWith(MCP_KEY_PREFIX)) return null;
  const [id, secret, extra] = v.slice(MCP_KEY_PREFIX.length).split(".");
  if (extra !== undefined || !ID.test(id ?? "") || !SECRET.test(secret ?? "")) return null;
  return { id, secret };
}

export function verifyMcpSecret(doc: Pick<McpKeyDoc, "hash">, secret: string): boolean {
  const a = Buffer.from(doc.hash, "hex");
  const b = Buffer.from(hashSecret(secret), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 사람이 붙인 이름 — 짧게, 줄바꿈 없이 */
export function cleanLabel(v: unknown): string {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 40) : "";
  return s || "MCP";
}
