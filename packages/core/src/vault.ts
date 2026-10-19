/**
 * 볼트 그래프 — 옵시디언 그래프 뷰를 이 앱의 데이터로 옮긴다. 테스트: vault.test.ts
 *
 * 옵시디언에서 점 하나가 노트이고 선이 [[링크]] 이듯, 여기서는 기록 · 할일 하나가 점이고
 * 글 속 [[제목]] 이 선이다. 시냅스 개념은 옵시디언의 태그 자리에 온다(설정의 "태그" 로 켜고 끈다).
 * - [[제목]] 은 같은 제목의 할일, 또는 첫 줄이 같은 기록으로 이어진다(대소문자 무시).
 * - 이어질 글이 없으면 "아직 없는 노트" 점이 된다(옵시디언의 미해결 링크).
 * - 걸러 보기(검색 · 태그 · 미연결 · 없는 노트) · 색 그룹 · 로컬 그래프(깊이) · 힘 배치(중심 · 반발 · 링크)는
 *   전부 순수 함수다. 화면은 계산된 좌표를 그리기만 한다.
 */
import { asTaskPriority, asTaskStatus, taskPriority, taskStatus, type AppState, type NodeKind, type TaskPriority, type TaskStatus } from "./types.ts";

export type VaultKind = "scrap" | "task" | "concept" | "missing";

export interface VaultNode {
  /** "scrap:<id>" · "task:<id>" · "concept:<노드 id>" · "missing:<소문자 제목>" */
  id: string;
  kind: VaultKind;
  name: string;
  /** 원래 데이터 id(기록 · 할일 · 개념) */
  refId?: string;
  conceptKind?: NodeKind;
  done?: boolean;
  /** 할일만 — 옵시디언 일감 프론트매터의 상태 · 우선순위(기본값까지 채운 값) */
  status?: TaskStatus;
  priority?: TaskPriority;
}

export interface VaultLink {
  source: string;
  target: string;
  /** link = 글 속 [[링크]](방향 있음), concept = 글 → 그 글에서 뽑힌 개념 */
  kind: "link" | "concept";
  /** link 일 때 글에 적힌 대상 제목(별칭 · 소제목을 뗀 것) */
  text?: string;
}

export interface VaultGraph {
  nodes: VaultNode[];
  links: VaultLink[];
}

export interface GraphGroup {
  query: string;
  color: string;
}

/** 옵시디언 graph.json 과 같은 갈래 — 필터 · 그룹 · 표시 · 장력, 그리고 로컬 그래프 깊이 */
export interface GraphSettings {
  search: string;
  /** 개념(옵시디언의 태그)을 점으로 보인다 */
  showTags: boolean;
  /** 아직 없는 노트([[링크]] 대상이 없음)를 숨긴다 — 옵시디언 "존재하는 파일만 표시" */
  hideUnresolved: boolean;
  /** 아무 선도 없는 점을 보인다 — 옵시디언 "미연결 노트" */
  showOrphans: boolean;
  groups: GraphGroup[];
  showArrow: boolean;
  /** 텍스트 표시 시작점 -3 ~ 3. 클수록 더 멀리서(작게 볼 때)도 이름이 보인다 */
  textFade: number;
  nodeSize: number;
  linkSize: number;
  centerStrength: number;
  repelStrength: number;
  linkStrength: number;
  linkDistance: number;
  /** 로컬 그래프 — 고른 점에서 몇 걸음까지 보일까 */
  depth: number;
}

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  search: "",
  showTags: false,
  hideUnresolved: false,
  showOrphans: true,
  groups: [],
  showArrow: false,
  textFade: 0,
  nodeSize: 1,
  linkSize: 1,
  centerStrength: 0.52,
  repelStrength: 10,
  linkStrength: 1,
  linkDistance: 250,
  depth: 1,
};

/** 저장해 둔 설정(옛 모양일 수 있다)을 기본값 위에 얹고 범위를 맞춘다 */
export function normalizeSettings(raw: unknown): GraphSettings {
  const s = { ...DEFAULT_GRAPH_SETTINGS, ...(raw && typeof raw === "object" ? (raw as Partial<GraphSettings>) : {}) };
  const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const D = DEFAULT_GRAPH_SETTINGS;
  return {
    search: typeof s.search === "string" ? s.search : "",
    showTags: !!s.showTags,
    hideUnresolved: !!s.hideUnresolved,
    showOrphans: !!s.showOrphans,
    groups: Array.isArray(s.groups) ? s.groups.filter((g) => g && typeof g.query === "string" && typeof g.color === "string") : [],
    showArrow: !!s.showArrow,
    textFade: clamp(s.textFade, -3, 3, D.textFade),
    nodeSize: clamp(s.nodeSize, 0.1, 5, D.nodeSize),
    linkSize: clamp(s.linkSize, 0.1, 5, D.linkSize),
    centerStrength: clamp(s.centerStrength, 0, 1, D.centerStrength),
    repelStrength: clamp(s.repelStrength, 0, 20, D.repelStrength),
    linkStrength: clamp(s.linkStrength, 0, 1, D.linkStrength),
    linkDistance: clamp(s.linkDistance, 30, 500, D.linkDistance),
    depth: Math.round(clamp(s.depth, 1, 5, D.depth)),
  };
}

/** 글 속 [[제목]] · [[제목|별칭]] · [[제목#소제목]] → 제목들(나온 순서, 중복 없이) */
export function parseWikiLinks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\[\[([^\[\]]+?)\]\]/g)) {
    const target = m[1].split("|")[0].split("#")[0].trim();
    if (target && !out.some((t) => t.toLowerCase() === target.toLowerCase())) out.push(target);
  }
  return out;
}

/** 기록의 제목 — 첫 줄([[ ]] 표시는 벗기고 #태그는 뺀다). 옵시디언의 파일 이름 자리 */
export function scrapTitle(text: string): string {
  const first = text.split("\n").find((l) => l.trim()) ?? "";
  const plain = first
    .replace(/\[\[([^\[\]]+?)\]\]/g, (_, inner: string) => inner.split("|").pop()!.trim())
    // #태그는 꼬리표지 제목이 아니다(옵시디언에서도 파일 이름에 들어가지 않는다)
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 40 ? `${plain.slice(0, 40)}…` : plain;
}

const titleKey = (t: string) => t.trim().toLowerCase();

interface Doc {
  id: string;
  kind: "scrap" | "task";
  refId: string;
  /** [[링크]] 로 찾을 수 있는 이름들 */
  keys: string[];
  name: string;
  body: string;
  done?: boolean;
  status?: TaskStatus;
  priority?: TaskPriority;
}

function docsOf(state: AppState): Doc[] {
  const docs: Doc[] = [];
  for (const t of state.tasks) {
    if (t.deletedAt) continue;
    docs.push({ id: `task:${t.id}`, kind: "task", refId: t.id, keys: [titleKey(t.title)], name: t.title, body: [t.title, t.notes ?? ""].join("\n"), done: t.done, status: taskStatus(t), priority: taskPriority(t) });
  }
  for (const s of state.scraps) {
    if (s.deletedAt) continue;
    const name = scrapTitle(s.text);
    const firstLine = (s.text.split("\n").find((l) => l.trim()) ?? "").trim();
    docs.push({ id: `scrap:${s.id}`, kind: "scrap", refId: s.id, keys: [...new Set([titleKey(name), titleKey(firstLine)])], name, body: s.text });
  }
  return docs;
}

/** 기록 · 할일 · 개념을 한 그래프로. 지운 글은 빠진다 */
export function buildVault(state: AppState): VaultGraph {
  const docs = docsOf(state);
  const byKey = new Map<string, Doc>();
  // 할일 제목이 기록 첫 줄보다 먼저 — 같은 이름이면 할일로 잇는다
  for (const d of docs) for (const k of d.keys) if (k && !byKey.has(k)) byKey.set(k, d);

  const nodes: VaultNode[] = docs.map((d) => ({ id: d.id, kind: d.kind, name: d.name, refId: d.refId, ...(d.kind === "task" ? { done: !!d.done, status: d.status, priority: d.priority } : {}) }));
  const links: VaultLink[] = [];
  const seen = new Set<string>();
  const missing = new Map<string, VaultNode>();
  const push = (l: VaultLink) => {
    const key = `${l.kind}|${l.source}|${l.target}`;
    if (l.source === l.target || seen.has(key)) return;
    seen.add(key);
    links.push(l);
  };

  for (const d of docs) {
    for (const target of parseWikiLinks(d.body)) {
      const hit = byKey.get(titleKey(target));
      if (hit) {
        push({ source: d.id, target: hit.id, kind: "link", text: target });
        continue;
      }
      const mid = `missing:${titleKey(target)}`;
      if (!missing.has(mid)) missing.set(mid, { id: mid, kind: "missing", name: target });
      push({ source: d.id, target: mid, kind: "link", text: target });
    }
  }
  nodes.push(...missing.values());

  const live = new Set(docs.map((d) => d.id));
  for (const n of state.nodes) {
    const refs = n.refs.map((r) => `${r.type}:${r.id}`).filter((id) => live.has(id));
    if (refs.length === 0) continue;
    nodes.push({ id: `concept:${n.id}`, kind: "concept", name: n.name, refId: n.id, conceptKind: n.kind });
    for (const r of refs) push({ source: r, target: `concept:${n.id}`, kind: "concept" });
  }
  return { nodes, links };
}

/** 이 글을 [[링크]] 한 글들 — 옵시디언 백링크 */
export function backlinks(graph: VaultGraph, nodeId: string): VaultNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return graph.links.filter((l) => l.kind === "link" && l.target === nodeId).map((l) => byId.get(l.source)!).filter(Boolean);
}

/** 이 글이 [[링크]] 한 곳들(아직 없는 노트 포함) */
export function outgoingLinks(graph: VaultGraph, nodeId: string): VaultNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return graph.links.filter((l) => l.kind === "link" && l.source === nodeId).map((l) => byId.get(l.target)!).filter(Boolean);
}

/** 글 하나의 [[링크]] 표기(소문자) → 이어진 점 id. 화면이 글 속 링크를 누를 수 있게 한다 */
export function linkTargets(graph: VaultGraph, nodeId: string): Map<string, string> {
  return new Map(graph.links.filter((l) => l.kind === "link" && l.source === nodeId && l.text).map((l) => [titleKey(l.text!), l.target]));
}

/** 이웃 수(방향 무시) */
export function degrees(graph: VaultGraph): Map<string, number> {
  const d = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const l of graph.links) {
    d.set(l.source, (d.get(l.source) ?? 0) + 1);
    d.set(l.target, (d.get(l.target) ?? 0) + 1);
  }
  return d;
}

const KIND_WORDS: Record<string, VaultKind> = { 기록: "scrap", 메모: "scrap", scrap: "scrap", 할일: "task", task: "task", 개념: "concept", 태그: "concept", concept: "concept", 없음: "missing", missing: "missing" };

/**
 * 옵시디언 검색 문법 일부 — 공백으로 나눈 말을 모두 만족해야 한다.
 * - 그냥 말: 이름에 들어 있다
 * - tag:#발표 · tag:발표: 그 개념과 이어진 글(개념 점 자신도)
 * - path:할일 · path:기록 · path:개념: 종류(옵시디언의 폴더 자리)
 * - status:보류 · 상태:진행중 / priority:최우선 · 우선순위:하순위: 할일의 프론트매터(옵시디언 [상태:보류] 자리)
 * - -말: 위 조건의 반대
 */
export function matchQuery(graph: VaultGraph, node: VaultNode, query: string): boolean {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  return terms.every((raw) => {
    const neg = raw.startsWith("-") && raw.length > 1;
    const term = (neg ? raw.slice(1) : raw).toLowerCase();
    let ok: boolean;
    if (term.startsWith("tag:")) {
      const tag = term.slice(4).replace(/^#/, "");
      ok =
        (node.kind === "concept" && node.name.toLowerCase() === tag) ||
        graph.links.some((l) => l.kind === "concept" && l.source === node.id && graph.nodes.some((n) => n.id === l.target && n.name.toLowerCase() === tag));
    } else if (/^(status|상태):/.test(term)) {
      const want = asTaskStatus(term.slice(term.indexOf(":") + 1));
      ok = !!want && node.kind === "task" && node.status === want;
    } else if (/^(priority|우선순위):/.test(term)) {
      const want = asTaskPriority(term.slice(term.indexOf(":") + 1));
      ok = !!want && node.kind === "task" && node.priority === want;
    } else if (term.startsWith("path:")) {
      const kind = KIND_WORDS[term.slice(5)];
      ok = !!kind && node.kind === kind;
    } else {
      ok = node.name.toLowerCase().includes(term);
    }
    return neg ? !ok : ok;
  });
}

/** 설정의 필터대로 거른다. 미연결은 다른 필터를 다 적용한 뒤에 판단한다(옵시디언과 같다) */
export function filterVault(graph: VaultGraph, s: Pick<GraphSettings, "search" | "showTags" | "hideUnresolved" | "showOrphans">): VaultGraph {
  let keep = graph.nodes.filter((n) => (s.showTags || n.kind !== "concept") && (!s.hideUnresolved || n.kind !== "missing"));
  if (s.search.trim()) {
    // 개념 점은 검색의 대상이 아니라 글의 꼬리표다 — 남은 글과 이어진 개념만 남긴다
    const docs = keep.filter((n) => n.kind !== "concept" && matchQuery(graph, n, s.search));
    const docIds = new Set(docs.map((n) => n.id));
    const tagIds = new Set(graph.links.filter((l) => l.kind === "concept" && docIds.has(l.source)).map((l) => l.target));
    keep = keep.filter((n) => docIds.has(n.id) || (n.kind === "concept" && (tagIds.has(n.id) || matchQuery(graph, n, s.search))));
  }
  const ids = new Set(keep.map((n) => n.id));
  const links = graph.links.filter((l) => ids.has(l.source) && ids.has(l.target));
  if (!s.showOrphans) {
    const linked = new Set(links.flatMap((l) => [l.source, l.target]));
    keep = keep.filter((n) => linked.has(n.id));
  }
  return { nodes: keep, links };
}

/** 로컬 그래프 — 고른 점에서 depth 걸음 안의 점들(방향 무시) */
export function localGraph(graph: VaultGraph, centerId: string, depth: number): VaultGraph {
  if (!graph.nodes.some((n) => n.id === centerId)) return { nodes: [], links: [] };
  const adj = new Map<string, string[]>();
  for (const l of graph.links) {
    adj.set(l.source, [...(adj.get(l.source) ?? []), l.target]);
    adj.set(l.target, [...(adj.get(l.target) ?? []), l.source]);
  }
  const seen = new Set([centerId]);
  let frontier = [centerId];
  for (let step = 0; step < depth; step++) {
    const next: string[] = [];
    for (const id of frontier) for (const nb of adj.get(id) ?? []) if (!seen.has(nb)) (seen.add(nb), next.push(nb));
    frontier = next;
  }
  return { nodes: graph.nodes.filter((n) => seen.has(n.id)), links: graph.links.filter((l) => seen.has(l.source) && seen.has(l.target)) };
}

/** 그룹 색 — 위에서부터 처음 맞는 그룹의 색(옵시디언과 같은 우선순위). 없으면 null */
export function groupColor(graph: VaultGraph, node: VaultNode, groups: GraphGroup[]): string | null {
  for (const g of groups) if (g.query.trim() && matchQuery(graph, node, g.query)) return g.color;
  return null;
}

export interface Point {
  x: number;
  y: number;
}

/** 같은 입력이면 같은 시작 자리 — 화면을 다시 그려도 그래프가 튀지 않는다 */
function seedPoint(id: string, i: number): Point {
  let h = 2166136261;
  for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 16777619);
  const angle = ((h >>> 0) % 3600) / 3600 * 2 * Math.PI;
  const r = 30 * Math.sqrt(i + 1);
  return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
}

/**
 * 힘 배치 — 옵시디언 장력 네 가지를 그대로 받는다.
 * 반발력: 모든 점이 서로 밀어낸다 · 링크 장력/거리: 이어진 점은 그 거리로 당긴다 · 중심 장력: 가운데(0,0)로 당긴다.
 * 이전 좌표(prev)가 있으면 거기서 이어 계산한다(설정을 바꿔도 모양이 크게 흔들리지 않게).
 */
export function layoutVault(
  graph: VaultGraph,
  s: Pick<GraphSettings, "centerStrength" | "repelStrength" | "linkStrength" | "linkDistance">,
  opts: { iterations?: number; prev?: Map<string, Point> } = {},
): Map<string, Point> {
  const n = graph.nodes.length;
  const pos = graph.nodes.map((node, i) => ({ ...(opts.prev?.get(node.id) ?? seedPoint(node.id, i)) }));
  const index = new Map(graph.nodes.map((node, i) => [node.id, i]));
  const edges = graph.links.map((l) => [index.get(l.source), index.get(l.target)] as const).filter((e): e is readonly [number, number] => e[0] !== undefined && e[1] !== undefined);
  const iterations = opts.iterations ?? 300;
  const repel = s.repelStrength * 400;
  const dist = s.linkDistance * 0.4;

  for (let it = 0; it < iterations; it++) {
    const cool = 1 - it / iterations;
    const fx = new Float64Array(n);
    const fy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          // 같은 자리에 겹친 점은 정해진 방향으로 떼어 낸다
          dx = (i - j) * 0.1;
          dy = 0.1;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const f = repel / Math.max(d2, 25);
        fx[i] += (dx / d) * f;
        fy[i] += (dy / d) * f;
        fx[j] -= (dx / d) * f;
        fy[j] -= (dy / d) * f;
      }
    }
    for (const [a, b] of edges) {
      const dx = pos[b].x - pos[a].x;
      const dy = pos[b].y - pos[a].y;
      const d = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
      const f = (d - dist) * s.linkStrength * 0.1;
      fx[a] += (dx / d) * f;
      fy[a] += (dy / d) * f;
      fx[b] -= (dx / d) * f;
      fy[b] -= (dy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      fx[i] -= pos[i].x * s.centerStrength * 0.02;
      fy[i] -= pos[i].y * s.centerStrength * 0.02;
      const step = Math.min(30 * cool + 1, Math.hypot(fx[i], fy[i]));
      const len = Math.hypot(fx[i], fy[i]) || 1;
      pos[i].x += (fx[i] / len) * step;
      pos[i].y += (fy[i] / len) * step;
    }
  }
  return new Map(graph.nodes.map((node, i) => [node.id, pos[i]]));
}

/** 점 반지름 — 이웃이 많을수록 크다(옵시디언처럼) */
export function nodeRadius(degree: number, nodeSize: number): number {
  return (3 + Math.sqrt(degree) * 2) * nodeSize;
}

/** 이 배율에서 이름을 보일까 — 텍스트 표시 시작점이 클수록 작게 볼 때도 보인다 */
export function showLabelAt(scale: number, textFade: number): boolean {
  return scale >= Math.pow(2, -1 - textFade);
}
