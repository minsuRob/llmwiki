/**
 * 줄 단위 비교 — 본문 제안을 받기 전에 사람이 무엇이 바뀌는지 본다(ProposalCompare). 순수 함수.
 *
 * 최장 공통 부분열(LCS)로 같은 줄 · 지운 줄 · 더한 줄을 낸다. 앞뒤 같은 줄은 먼저 떼어 표를 작게 하고,
 * 그래도 줄 수의 곱이 너무 크면(긴 공고 본문을 통째로 바꾼 제안) 가운데를 통째로 지움 + 더함으로 본다 — 틀리진 않고 덜 촘촘할 뿐.
 */

export type DiffOp = "same" | "del" | "add";
export interface DiffLine {
  op: DiffOp;
  text: string;
}

/** 이보다 크면 가운데 덩어리를 LCS 없이 지움 + 더함으로 */
const MAX_CELLS = 4_000_000;

const lines = (s: string) => s.replace(/\r\n?/g, "\n").split("\n");

export function diffLines(before: string, after: string): DiffLine[] {
  const a = lines(before);
  const b = lines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const am = a.slice(head, a.length - tail);
  const bm = b.slice(head, b.length - tail);
  const out: DiffLine[] = a.slice(0, head).map((text) => ({ op: "same", text }));
  if (am.length * bm.length > MAX_CELLS) {
    out.push(...am.map((text) => ({ op: "del" as const, text })), ...bm.map((text) => ({ op: "add" as const, text })));
  } else out.push(...lcs(am, bm));
  out.push(...a.slice(a.length - tail).map((text) => ({ op: "same" as const, text })));
  return out;
}

function lcs(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = a[i..] · b[j..] 의 공통 길이 — 한 줄짜리 배열로
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) out.push({ op: "del", text: a[i++] });
    else out.push({ op: "add", text: b[j++] });
  }
  while (i < n) out.push({ op: "del", text: a[i++] });
  while (j < m) out.push({ op: "add", text: b[j++] });
  return out;
}

/** 몇 줄이 더해지고 지워졌나 — 제안 띠 · 목록에 보인다 */
export function diffStats(d: DiffLine[]): { added: number; removed: number } {
  return { added: d.filter((x) => x.op === "add").length, removed: d.filter((x) => x.op === "del").length };
}
