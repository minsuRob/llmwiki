/**
 * 취준 공고 — 그룹바이(상세 조사 JSON) · 인디스워크(posts.json + 본문)를 한 모양(Job)으로 맞추고,
 * 지난 공고를 거르고, 저장소와 맞출 계획(쓰기 · 지우기)을 세운다. 순수 함수.
 * 테스트: jobs.test.ts
 *
 * 원칙:
 * - **날짜는 원본에 있는 것만.** 마감 글이 날짜로 시작할 때만 dueDate 를 잡는다
 *   ("마감일 미기재 (계약기간 2026-12-31 종료)" 같은 괄호 속 날짜는 마감이 아니다).
 * - **지난 공고는 넣지 않고, 이미 있으면 지운다.** dueDate < 오늘(사용자 날짜)이면 지난 공고다.
 * - **다시 돌려도 같다.** 문서 id 는 출처 + 출처 id, 내용이 같으면(hash) 다시 쓰지 않는다.
 * - 공고는 할일 · 기록과 따로 둔다(users/{uid}/jobs). 대화 · 시냅스가 매번 수천 건을 읽지 않게.
 */

export type JobSource = "groupby" | "inthiswork";
export const JOB_SOURCES: JobSource[] = ["groupby", "inthiswork"];
export const JOB_SOURCE_NAMES: Record<JobSource, string> = { groupby: "그룹바이", inthiswork: "인디스워크" };

export interface Job {
  /** "gb-10027" · "itw-407816" */
  id: string;
  source: JobSource;
  sourceId: string;
  company: string;
  title: string;
  /** 원문 공고 */
  url: string;
  /** 지원 링크(인디스워크) */
  applyUrl: string | null;
  /** 개발 직군인가(그룹바이 상세 조사 · 인디스워크 IT개발 태그) */
  dev: boolean;
  /** 제목에 AI 직무 표시가 있나 */
  ai: boolean;
  /** 경력 구분(인디스워크: 신입/인턴 · 주니어경력) 또는 그룹바이 특징에서 뽑지 않고 null */
  career: string | null;
  location: string | null;
  station: string | null;
  /** 주요 업무 한두 줄 */
  summary: string | null;
  stack: string | null;
  /** 회사 · 근무 특징 */
  features: string | null;
  /** 회사 · 서비스 방향성(그룹바이 상세 조사) */
  direction: string | null;
  /** 직무 분류(인디스워크 jobs) */
  categories: string[];
  /** 원본 마감 글 그대로 */
  dueText: string;
  /** 원본 마감 글이 날짜로 시작할 때만 "YYYY-MM-DD" */
  dueDate: string | null;
  /** 게시일(인디스워크) */
  postedAt: string | null;
  /** 개발 여부를 정한 이유(그룹바이) */
  note: string | null;
  /** 본문이 jobTexts/{id} 에 있나 */
  hasText: boolean;
  /** 본문 지문 — 본문만 바뀌어도 다시 쓰게 */
  textHash: string | null;
  /** 위 내용의 지문 — 같으면 다시 쓰지 않는다 */
  hash: string;
}

export interface JobText {
  id: string;
  text: string;
}

/** 본문은 공고 한 건당 이만큼만 둔다(원본 최대 약 2만 자) */
export const JOB_TEXT_LIMIT = 30000;

const AI_TITLE = /(^|[^A-Za-z])(AI|LLM|Agent|RAG|ML|MLOps|FDE|AX|GenAI)([^A-Za-z]|$)|에이전트|인공지능|머신러닝|딥러닝|생성형/i;

const DATE_HEAD = /^\s*(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/;

/** 마감 글이 날짜로 시작하면 그 날짜("YYYY-MM-DD"), 아니면 null */
export function parseDueDate(text: string | null | undefined): string | null {
  const m = DATE_HEAD.exec(text ?? "");
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** today 는 사용자 날짜 "YYYY-MM-DD" */
export function isExpired(job: Pick<Job, "dueDate">, today: string): boolean {
  return !!job.dueDate && job.dueDate < today;
}

const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
};

/** FNV-1a 32비트 — 앱 · 서버 어디서나 같은 값(암호용 아님, 바뀜 감지용) */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** 내용 지문 — hash 를 뺀 나머지로 계산한다. 서버는 받은 hash 를 믿지 않고 이것으로 다시 계산한다 */
export function hashJob(j: Omit<Job, "hash"> & { hash?: string }): Job {
  const { hash: _ignored, ...rest } = j;
  return { ...rest, hash: fnv1a(JSON.stringify(rest)) };
}

/**
 * 그룹바이 .groupby-data/out/<id>.json 한 건. 조사하지 못한(삭제된) 공고는 null.
 * 필드: id, status, company, title, location, station, main, stack, features, direction(방향성), due, dev, devReason
 */
export function fromGroupby(raw: Record<string, unknown>): Job | null {
  const sourceId = String(raw.id ?? "").trim();
  const company = str(raw.company);
  const title = str(raw.title);
  if (!sourceId || raw.status !== "완료" || !company || !title) return null;
  const dueText = str(raw.due) ?? "마감일 미기재";
  return hashJob({
    id: `gb-${sourceId}`,
    source: "groupby",
    sourceId,
    company,
    title,
    url: `https://groupby.kr/positions/${sourceId}`,
    applyUrl: null,
    dev: raw.dev === true,
    ai: AI_TITLE.test(title),
    career: null,
    location: str(raw.location),
    station: str(raw.station),
    summary: str(raw.main),
    stack: str(raw.stack),
    features: str(raw.features),
    direction: str(raw.direction),
    categories: [],
    dueText,
    dueDate: parseDueDate(dueText),
    postedAt: null,
    note: str(raw.devReason),
    hasText: false,
    textHash: null,
  });
}

/**
 * 인디스워크 posts.json 한 건과 본문(text/<id>.txt, 없으면 null).
 * 필드: id, career, date, company, pos, link, apply, jobs[], startup, it, ai, aititle, tool, tasks[], loc, due, short
 */
export function fromInthiswork(raw: Record<string, unknown>, text: string | null): { job: Job; text: JobText | null } | null {
  const sourceId = String(raw.id ?? "").trim();
  // 회사명이 비어 있는 공고가 있다(제목에만 회사가 적힘) — 지어내지 않고 미기재로 둔다
  const company = str(raw.company) ?? "회사 미기재";
  const title = str(raw.pos);
  const url = str(raw.link);
  if (!sourceId || !title || !url) return null;
  const id = `itw-${sourceId}`;
  const body = str(text);
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.filter((t): t is string => typeof t === "string" && !!t.trim()) : [];
  const dueText = str(raw.due) ?? "본문 확인";
  const kept = body ? body.slice(0, JOB_TEXT_LIMIT) : null;
  const job = hashJob({
    id,
    source: "inthiswork",
    sourceId,
    company,
    title,
    url,
    applyUrl: str(raw.apply),
    dev: raw.it === true,
    ai: raw.aititle === true || AI_TITLE.test(title),
    career: str(raw.career),
    location: str(raw.loc),
    station: null,
    summary: tasks.length ? tasks.slice(0, 3).join(" · ") : null,
    stack: null,
    features: [raw.startup === true ? "스타트업" : null, raw.tool === true ? "AI 도구 활용 언급" : null, raw.ai === true && raw.aititle !== true ? "본문에 AI 언급" : null]
      .filter(Boolean)
      .join(", ") || null,
    direction: null,
    categories: Array.isArray(raw.jobs) ? raw.jobs.filter((x): x is string => typeof x === "string") : [],
    dueText,
    dueDate: parseDueDate(dueText),
    postedAt: str(raw.date),
    note: null,
    hasText: !!kept,
    textHash: kept ? fnv1a(kept) : null,
  });
  return { job, text: kept ? { id, text: kept } : null };
}

export interface JobSyncPlan {
  /** 새로 생기거나 바뀐 공고 */
  write: Job[];
  /** 지울 공고 id — 지난 공고 + (prune 일 때) 이번 원본에 없는 공고 */
  remove: string[];
  /** 지난 공고라서 넣지 않거나 지우는 id */
  expired: string[];
  /** 내용이 같아 건너뛴 수 */
  unchanged: number;
}

/**
 * 저장소에 있는 공고(existing: id · hash · dueDate)와 이번 원본(incoming)을 맞춘다.
 * prune 에 출처를 주면 그 출처의 공고 중 incoming 에 없는 것을 지운다(원본에서 사라진 공고).
 * 같은 id 가 여러 번 오면 마지막 것을 쓴다.
 */
export function planJobSync(
  existing: Pick<Job, "id" | "hash" | "dueDate" | "source">[],
  incoming: Job[],
  today: string,
  prune: JobSource[] = [],
): JobSyncPlan {
  const have = new Map(existing.map((e) => [e.id, e]));
  const next = new Map(incoming.map((j) => [j.id, j]));
  const write: Job[] = [];
  const remove = new Set<string>();
  const expired = new Set<string>();
  let unchanged = 0;
  for (const j of next.values()) {
    if (isExpired(j, today)) {
      expired.add(j.id);
      if (have.has(j.id)) remove.add(j.id);
      continue;
    }
    if (have.get(j.id)?.hash === j.hash) unchanged++;
    else write.push(j);
  }
  for (const e of have.values()) {
    if (next.has(e.id)) continue;
    if (isExpired(e, today)) {
      expired.add(e.id);
      remove.add(e.id);
    } else if (prune.includes(e.source)) remove.add(e.id);
  }
  return { write, remove: [...remove], expired: [...expired], unchanged };
}

/** 함수가 받은 공고를 믿기 전에 모양을 확인한다. 틀리면 이유 한 줄 */
export function checkJob(v: unknown): string | null {
  if (!v || typeof v !== "object") return "공고가 객체가 아니에요.";
  const j = v as Record<string, unknown>;
  if (j.source !== "groupby" && j.source !== "inthiswork") return "source 가 groupby · inthiswork 가 아니에요.";
  const prefix = j.source === "groupby" ? "gb-" : "itw-";
  if (typeof j.id !== "string" || j.id !== `${prefix}${j.sourceId}` || !/^[\w-]{1,80}$/.test(j.id)) return "id 가 출처-출처id 모양이 아니에요.";
  for (const k of ["company", "title", "url", "dueText"]) if (typeof j[k] !== "string" || !(j[k] as string).trim()) return `${k} 가 비었어요.`;
  if (!/^https:\/\//.test(j.url as string)) return "url 이 https 가 아니에요.";
  if (j.dueDate !== null && (typeof j.dueDate !== "string" || parseDueDate(j.dueDate) !== j.dueDate)) return "dueDate 가 날짜가 아니에요.";
  if (j.dueDate !== parseDueDate(j.dueText as string)) return "dueDate 가 마감 글과 맞지 않아요.";
  if (typeof j.dev !== "boolean" || typeof j.ai !== "boolean" || typeof j.hasText !== "boolean") return "dev · ai · hasText 는 참/거짓이어야 해요.";
  if (!Array.isArray(j.categories)) return "categories 가 목록이 아니에요.";
  if (JSON.stringify(j).length > 8000) return "공고 한 건이 너무 커요.";
  return null;
}

/** 목록 정렬 — 마감 날짜가 있는 것(가까운 순) 먼저, 그다음 게시일 최신 순, 회사 이름 순 */
export function compareJobs(a: Job, b: Job): number {
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  if (!!a.dueDate !== !!b.dueDate) return a.dueDate ? -1 : 1;
  const pa = a.postedAt ?? "";
  const pb = b.postedAt ?? "";
  if (pa !== pb) return pa > pb ? -1 : 1;
  return a.company.localeCompare(b.company, "ko");
}

/**
 * 나눠 보낸 뒤 마무리 — keepIds(이번 원본 전체 id)에 없는 sources 의 공고와, 지난 공고를 지운다.
 * 원본이 비었는데 지우라고 하면(keepIds 0건) 실수로 보고 아무것도 지우지 않는다.
 */
export function planJobPrune(existing: Pick<Job, "id" | "dueDate" | "source">[], keepIds: string[], sources: JobSource[], today: string): string[] {
  const keep = new Set(keepIds);
  return existing
    .filter((e) => isExpired(e, today) || (keep.size > 0 && sources.includes(e.source) && !keep.has(e.id)))
    .map((e) => e.id);
}

const JOB_KEYS = [
  "id", "source", "sourceId", "company", "title", "url", "applyUrl", "dev", "ai", "career", "location", "station", "summary",
  "stack", "features", "direction", "categories", "dueText", "dueDate", "postedAt", "note", "hasText", "textHash",
] as const;

/** 밖에서 받은 공고에서 아는 필드만 남기고 hash 를 다시 계산한다(checkJob 을 통과한 것만 넣을 것) */
export function pickJob(v: Record<string, unknown>): Job {
  const out: Record<string, unknown> = {};
  for (const k of JOB_KEYS) out[k] = v[k] === undefined ? null : v[k];
  return hashJob(out as unknown as Job);
}
