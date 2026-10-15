/**
 * 시냅스 — 기록 · 할일에서 다시 떠올릴 만한 개념을 노드로 뽑고, 같은 글에 함께 나온 개념끼리 잇는다.
 * 테스트: synapse.test.ts
 *
 * 규칙 길(키 없이)과 모델 길(서버의 Claude 추출)이 같은 모양(ExtractedConcept[])을 내고,
 * mergeGraph 가 그것을 그래프에 합친다. 원칙:
 * - **수렴**: 같은 개념의 변형("기대돼", "설렌다")은 표준 이름 하나("설렘")로 모은다. 조사도 떼어 낸다.
 * - **감정은 혼자 두지 않는다**: 감정 노드는 같은 글의 다른 개념과 반드시 이어진다(같은 글에서 뽑혔으므로 자동).
 * - **다시 만들 수 있다**: 그래프는 글에서 언제든 다시 계산된다(rebuildGraph). 글을 지우면 그 글의 흔적도 빠진다.
 */
import { newId, type AppState, type GraphEdge, type GraphNode, type NodeKind } from "./types.ts";

export interface ExtractedConcept {
  name: string;
  kind: NodeKind;
}

export interface ExtractedRelation {
  from: string;
  to: string;
  relation?: string;
}

/** 감정 말 → 표준 감정 이름 */
const EMOTIONS: [RegExp, string][] = [
  [/(기대|설레|설렘|두근)/, "설렘"],
  // "기분이 좋다" 는 기쁨, "하면 좋겠다" 는 감정이 아니다 — 좋다 하나로는 잡지 않는다
  [/(기분\s*좋|기분이\s*좋|기쁘|기뻐|행복|좋았|뿌듯)/, "기쁨"],
  [/(불안|걱정|초조|긴장)/, "불안"],
  [/(피곤|지침|지쳤|번아웃|힘들)/, "지침"],
  [/(짜증|화나|화났|분노|열받)/, "분노"],
  [/(슬프|슬펐|우울|속상)/, "슬픔"],
];

const JOSA =
  /(으로부터|에서부터|이랑|에게서|한테서|에서는|에서도|으로는|으로도|이라도|까지는|부터는|에서|에게|한테|으로|이랑|하고|까지|부터|처럼|보다|이나|에는|에도|와는|과는|은|는|이|가|을|를|에|의|와|과|도|로|만|랑|나)$/;

/** 개념이 아닌 흔한 말 */
const STOP = new Set(
  "오늘 내일 모레 어제 이번 다음 지난 이번주 다음주 주말 오전 오후 저녁 아침 밤 시간 정도 생각 하기 해야 했다 한다 하는 그리고 그래서 하지만 그런데 너무 정말 진짜 조금 많이 다시 먼저 이제 그냥 같이 우리 나는 내가 저는 제가 이거 그거 저거 것 거 수 때 중 등 좀 더 안 못 잘 꼭 다 또 할 일 할일 메모 기록 하기로 늘리기로 했어 했음 하자 거야 같다 같아 있다 없다 있어 없어 된다 됐다 위해 대해 관련".split(
    " ",
  ),
);

/** 말 하나 → 표준 형태(조사 · 어미 꼬리를 뗀다). 개념이 아니면 null */
export function normalizeTerm(raw: string): string | null {
  let t = raw.replace(/[^\p{L}\p{N}#]/gu, "").toLowerCase();
  if (!t) return null;
  if (t.startsWith("#")) return t.length > 1 ? t : null;
  // "늘리기로 · 하기로 · 가기로" 같은 동사의 명사꼴 + 조사는 개념이 아니다
  if (/기(로|를|는|가|도|에)$/.test(t)) return null;
  for (let i = 0; i < 2; i++) {
    const m = JOSA.exec(t);
    if (m && t.length - m[0].length >= 2) t = t.slice(0, -m[0].length);
  }
  // 동사 · 형용사 꼴은 개념이 아니다
  if (/(하다|했다|한다|하기|해야|하고|해서|했어|해요|합니다|된다|됐다|되다|있다|없다|같다|싶다|겠다|이다|였다)$/.test(t)) return null;
  if (/^[\d]+$/.test(t) || t.length < 2 || t.length > 20) return null;
  if (STOP.has(t)) return null;
  return t;
}

/** 규칙 길 — 글 하나에서 개념을 뽑는다. 감정은 표준 이름으로, #태그는 # 를 뗀 개념으로, 나머지 명사꼴은 주제로 */
export function extractConcepts(text: string, _label?: string): ExtractedConcept[] {
  const out = new Map<string, ExtractedConcept>();
  const add = (name: string, kind: NodeKind) => {
    const key = name.toLowerCase();
    const prev = out.get(key);
    // 같은 글에 "#발표" 와 "발표" 가 함께 나오면 주제로 둔다
    if (!prev) out.set(key, { name, kind });
    else if (prev.kind === "tag" && kind === "topic") out.set(key, { name, kind });
  };
  for (const [re, name] of EMOTIONS) if (re.test(text)) add(name, "emotion");
  // #태그는 # 를 떼고 같은 이름의 개념으로 모은다("#발표" 와 "발표" 는 한 개념)
  for (const m of text.matchAll(/#([\p{L}\p{N}_]+)/gu)) add(m[1].toLowerCase(), "tag");
  for (const word of text.split(/\s+/)) {
    if (word.startsWith("#")) continue;
    if (EMOTIONS.some(([re]) => re.test(word))) continue;
    const t = normalizeTerm(word);
    if (t) add(t, "topic");
  }
  // 라벨(_label: 결정 · 계획 …)은 기록의 분류일 뿐 생각의 내용이 아니다 — 개념으로 넣으면 모든 갈래를 한데 묶는 중심이 된다
  return [...out.values()];
}

type Doc = { type: "scrap" | "task"; id: string; text: string; label?: string; concepts?: ExtractedConcept[]; relations?: ExtractedRelation[] };

function docsOf(state: AppState): Doc[] {
  const docs: Doc[] = [];
  for (const s of state.scraps) if (!s.deletedAt) docs.push({ type: "scrap", id: s.id, text: s.text, label: s.label, concepts: s.concepts, relations: s.relations });
  for (const t of state.tasks) if (!t.deletedAt) docs.push({ type: "task", id: t.id, text: [t.title, t.notes ?? ""].join(" ") });
  return docs;
}

const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * 그래프에 글 하나의 개념을 합친다. 같은 이름(대소문자 무시)의 노드가 있으면 그 노드에 글을 더하고,
 * 같은 글의 개념끼리는 엣지 무게를 1 올린다. relations(모델 길)가 있으면 그 관계 이름을 엣지에 단다.
 */
export function mergeConcepts(
  nodes: GraphNode[],
  edges: GraphEdge[],
  ref: { type: "scrap" | "task"; id: string },
  concepts: ExtractedConcept[],
  relations: ExtractedRelation[] = [],
  now = new Date(),
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const byName = new Map(nodes.map((n) => [n.name.toLowerCase(), n]));
  const nextNodes = [...nodes];
  const ids: string[] = [];
  for (const c of concepts) {
    const key = c.name.toLowerCase();
    let node = byName.get(key);
    if (node && node.kind === "tag" && c.kind === "topic") {
      // 태그로 먼저 나온 말이 본문에서도 쓰이면 주제로 올린다
      const upgraded = { ...node, kind: "topic" as const };
      nextNodes[nextNodes.indexOf(node)] = upgraded;
      byName.set(key, upgraded);
      node = upgraded;
    }
    if (!node) {
      node = { id: newId(), name: c.name, kind: c.kind, refs: [], updatedAt: now.toISOString() };
      byName.set(key, node);
      nextNodes.push(node);
    }
    if (!node.refs.some((r) => r.type === ref.type && r.id === ref.id)) {
      const updated = { ...node, refs: [...node.refs, ref], updatedAt: now.toISOString() };
      nextNodes[nextNodes.indexOf(node)] = updated;
      byName.set(key, updated);
      node = updated;
    }
    if (!ids.includes(node.id)) ids.push(node.id);
  }
  const edgeMap = new Map(edges.map((e) => [edgeKey(e.a, e.b), e]));
  const relationOf = new Map<string, string>();
  for (const r of relations) {
    const a = byName.get(r.from.toLowerCase());
    const b = byName.get(r.to.toLowerCase());
    if (a && b && r.relation) relationOf.set(edgeKey(a.id, b.id), r.relation);
  }
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const key = edgeKey(ids[i], ids[j]);
      const [a, b] = key.split("|");
      const prev = edgeMap.get(key);
      const relation = relationOf.get(key) ?? prev?.relation;
      edgeMap.set(key, prev ? { ...prev, weight: prev.weight + 1, relation } : { id: newId(), a, b, weight: 1, ...(relation ? { relation } : {}) });
    }
  }
  return { nodes: nextNodes, edges: [...edgeMap.values()] };
}

/** 규칙 길로 그래프 전체를 다시 계산한다. 노드 id 는 이름이 같으면 이전 id 를 지킨다(링크가 깨지지 않게) */
export function rebuildGraph(state: AppState, now = new Date()): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const oldIds = new Map(state.nodes.map((n) => [n.name.toLowerCase(), n.id]));
  let nodes: GraphNode[] = [];
  let edges: GraphEdge[] = [];
  for (const doc of docsOf(state)) {
    const concepts = doc.concepts?.length ? doc.concepts : extractConcepts(doc.text, doc.label);
    ({ nodes, edges } = mergeConcepts(nodes, edges, { type: doc.type, id: doc.id }, concepts, doc.relations ?? [], now));
  }
  // 한 글에만 나온 주제는 아직 '개념' 이 아니다 — 감정 · 태그 · 사람 · 프로젝트, 그리고 두 글 이상에 나온 주제만 남긴다
  const keep = new Set(nodes.filter((n) => n.kind !== "topic" || n.refs.length >= 2).map((n) => n.id));
  const remap = new Map<string, string>();
  nodes = nodes
    .filter((n) => keep.has(n.id))
    .map((n) => {
      const id = oldIds.get(n.name.toLowerCase()) ?? n.id;
      remap.set(n.id, id);
      return { ...n, id };
    });
  edges = edges
    .filter((e) => keep.has(e.a) && keep.has(e.b))
    .map((e) => {
      const a = remap.get(e.a)!;
      const b = remap.get(e.b)!;
      return a < b ? { ...e, a, b } : { ...e, a: b, b: a };
    });
  return { nodes, edges };
}

/** 노드의 이웃 — 무게 큰 순 */
export function neighbors(graph: { nodes: GraphNode[]; edges: GraphEdge[] }, nodeId: string): { node: GraphNode; weight: number; relation?: string }[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return graph.edges
    .filter((e) => e.a === nodeId || e.b === nodeId)
    .map((e) => ({ node: byId.get(e.a === nodeId ? e.b : e.a)!, weight: e.weight, relation: e.relation }))
    .filter((x) => !!x.node)
    .sort((x, y) => y.weight - x.weight);
}

/** 노드 무게(연결 수 + 글 수) — 시냅스 탭 정렬 */
export function degree(graph: { nodes: GraphNode[]; edges: GraphEdge[] }, nodeId: string): number {
  const node = graph.nodes.find((n) => n.id === nodeId);
  return (node?.refs.length ?? 0) + graph.edges.filter((e) => e.a === nodeId || e.b === nodeId).reduce((s, e) => s + e.weight, 0);
}

/**
 * 떠올리기 — 질문 말과 이름이 맞는 노드(+ 가장 가까운 이웃 3개)를 찾고, 그 노드들이 나온 글을 모은다.
 * 맞는 노드가 없으면 글 본문에서 직접 찾는다(아직 그래프에 오르지 못한 한 번 나온 말).
 */
export function recall(state: AppState, query: string): { nodeIds: string[]; scrapIds: string[]; taskIds: string[] } {
  const terms = query
    .split(/\s+/)
    .map((w) => normalizeTerm(w) ?? w.replace(/[^\p{L}\p{N}#]/gu, "").toLowerCase())
    .filter((w) => w.length >= 2);
  const graph = { nodes: state.nodes, edges: state.edges };
  const hits = state.nodes.filter((n) => terms.some((t) => n.name.toLowerCase().includes(t) || t.includes(n.name.toLowerCase())));
  const nodeIds = new Set(hits.map((n) => n.id));
  for (const h of hits) for (const nb of neighbors(graph, h.id).slice(0, 3)) nodeIds.add(nb.node.id);
  const scrapIds = new Set<string>();
  const taskIds = new Set<string>();
  for (const h of hits) for (const r of h.refs) (r.type === "scrap" ? scrapIds : taskIds).add(r.id);
  if (scrapIds.size + taskIds.size === 0) {
    for (const s of state.scraps) if (!s.deletedAt && terms.some((t) => s.text.toLowerCase().includes(t))) scrapIds.add(s.id);
    for (const t of state.tasks) if (!t.deletedAt && terms.some((q) => t.title.toLowerCase().includes(q))) taskIds.add(t.id);
  }
  const liveScrap = new Set(state.scraps.filter((s) => !s.deletedAt).map((s) => s.id));
  const liveTask = new Set(state.tasks.filter((t) => !t.deletedAt).map((t) => t.id));
  return {
    nodeIds: [...nodeIds],
    scrapIds: [...scrapIds].filter((id) => liveScrap.has(id)).slice(0, 10),
    taskIds: [...taskIds].filter((id) => liveTask.has(id)).slice(0, 10),
  };
}
