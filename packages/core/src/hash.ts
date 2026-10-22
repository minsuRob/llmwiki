/** 해시 · 결과 정규화 — work.ts · pages.ts 가 같이 쓴다(서로 부르지 않게 따로 둔다) */

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
