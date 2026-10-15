/**
 * 시냅스 — POST rebuildSynapse { timeZone? } : 그래프를 글에서 다시 계산한다.
 * 키가 있으면 아직 개념을 뽑지 않은 기록을 Claude 로 뽑아 기록에 붙여 둔다(extractNewScraps) — 이후 계산은 그것을 쓴다.
 * 그래프 계산 자체는 mutate 한 바퀴에서 글이 바뀔 때마다 자동으로 돈다(common.ts).
 */
import { logger } from "firebase-functions";
import { onCall } from "firebase-functions/https";

import { rebuildGraph } from "../../../packages/core/src/synapse.ts";
import type { AppState } from "../../../packages/core/src/types.ts";
import { extractWithClaude } from "../claudeTurn.ts";
import { REGION, anthropicKey, mutate, requireUid, wallClock } from "../common.ts";

/** before 에 없던(또는 개념이 비어 있는) 살아 있는 기록만 Claude 로 개념을 뽑는다. 실패한 기록은 규칙 길로 둔다 */
export async function extractNewScraps(key: string, before: AppState, after: AppState): Promise<AppState> {
  const seen = new Set(before.scraps.filter((s) => s.concepts?.length).map((s) => s.id));
  const targets = after.scraps.filter((s) => !s.deletedAt && !seen.has(s.id) && !s.concepts?.length).slice(0, 10);
  if (targets.length === 0) return after;
  const known = after.nodes.map((n) => n.name);
  const extracted = new Map<string, Awaited<ReturnType<typeof extractWithClaude>>>();
  for (const s of targets) {
    try {
      extracted.set(s.id, await extractWithClaude(key, s.text, known));
    } catch (e) {
      logger.warn("concept extraction failed", { scrap: s.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ...after, scraps: after.scraps.map((s) => (extracted.has(s.id) ? { ...s, ...extracted.get(s.id)! } : s)) };
}

export const rebuildSynapse = onCall<{ timeZone?: string }>({ region: REGION, timeoutSeconds: 300 }, async (req) => {
  const uid = requireUid(req);
  const { now } = wallClock(req.data?.timeZone);
  const key = anthropicKey();
  return mutate(uid, now, async (s) => {
    const enriched = key ? await extractNewScraps(key, { ...s, scraps: [] }, s) : s;
    const graph = rebuildGraph(enriched, now);
    return { state: { ...enriched, ...graph }, result: { nodes: graph.nodes.length, edges: graph.edges.length, via: key ? "claude" : "rules" } };
  });
});
