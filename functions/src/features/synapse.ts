/**
 * 시냅스 — POST rebuildSynapse { timeZone? } : 그래프를 글에서 다시 계산한다(규칙 길, AI API 없음).
 * 그래프 계산 자체는 mutate 한 바퀴에서 글이 바뀔 때마다 자동으로 돈다(common.ts).
 */
import { onCall } from "firebase-functions/https";

import { rebuildGraph } from "../../../packages/core/src/synapse.ts";
import { REGION, mutate, requireUid, wallClock } from "../common.ts";

export const rebuildSynapse = onCall<{ timeZone?: string }>({ region: REGION, timeoutSeconds: 120 }, async (req) => {
  const uid = requireUid(req);
  const { now } = wallClock(req.data?.timeZone);
  return mutate(uid, now, async (s) => {
    const graph = rebuildGraph(s, now);
    return { state: { ...s, ...graph }, result: { nodes: graph.nodes.length, edges: graph.edges.length, via: "rules" as const } };
  });
});
