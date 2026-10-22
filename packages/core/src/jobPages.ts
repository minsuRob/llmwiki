/**
 * 취준 공고 → 페이지 가져오기 항목(ImportEntry). 순수 함수 — 테스트: jobPages.test.ts
 *
 * - 바깥 id 는 공고 id(gb-… · itw-…) — 같은 부모 아래에서 다시 가져오면 맞춰서 고치거나 건너뛴다(pages.ts importPlan).
 * - 본문은 필드 목록 + 주요 업무 · 스택 · 특징 · 방향성 + 인디스워크 본문 + 링크. 원본에 없는 것은 쓰지 않는다.
 * - 필드는 표 대신 '- **이름**: 값' 목록으로 — 편집기에 표 블록이 없고, '|' 로 시작하는 줄은 인용으로 읽힌다.
 * - 작은 값(props)은 목차 거르기 · 표 보기에 쓴다: company · dueDate · dueText · location · career · source · dev · ai.
 * 문구는 앱이 넘긴다(JobPageLabels) — MCP · 시험은 한국어 기본값을 쓴다.
 */
import { JOB_SOURCE_NAMES, type Job, type JobText } from "./jobs.ts";
import { editorBlocks, type ImportEntry } from "./pages.ts";

export interface JobPageLabels {
  company: string;
  due: string;
  location: string;
  career: string;
  categories: string;
  source: string;
  posted: string;
  summary: string;
  stack: string;
  features: string;
  direction: string;
  note: string;
  text: string;
  links: string;
  url: string;
  apply: string;
}

export const JOB_PAGE_LABELS_KO: JobPageLabels = {
  company: "회사",
  due: "마감",
  location: "위치",
  career: "경력",
  categories: "직무",
  source: "출처",
  posted: "게시일",
  summary: "주요 업무",
  stack: "스택",
  features: "특징",
  direction: "방향성",
  note: "개발 직군 판단",
  text: "공고 본문",
  links: "링크",
  url: "공고 원문",
  apply: "지원하기",
};

/** 마크다운 안에서 줄 머리 기호로 읽히지 않게(값이 '#' · '-' 로 시작하는 등) */
const inline = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();

export function jobToEntry(job: Job, text: JobText | string | null, L: JobPageLabels = JOB_PAGE_LABELS_KO): ImportEntry {
  const body = typeof text === "string" ? text : (text?.text ?? null);
  const fields: [string, string | null][] = [
    [L.company, job.company],
    [L.due, job.dueText],
    [L.location, [job.location, job.station].filter(Boolean).join(" · ") || null],
    [L.career, job.career],
    [L.categories, job.categories.length ? job.categories.join(", ") : null],
    [L.source, JOB_SOURCE_NAMES[job.source] ?? job.source],
    [L.posted, job.postedAt],
  ];
  const out: string[] = fields.filter(([, v]) => v).map(([k, v]) => `- **${k}**: ${inline(v as string)}`);
  const section = (title: string, v: string | null) => {
    if (v?.trim()) out.push("", `## ${title}`, v.trim());
  };
  section(L.summary, job.summary);
  section(L.stack, job.stack);
  section(L.features, job.features);
  section(L.direction, job.direction);
  section(L.note, job.note);
  section(L.text, body);
  out.push("", `## ${L.links}`, `- [${L.url}](${job.url})`);
  if (job.applyUrl) out.push(`- [${L.apply}](${job.applyUrl})`);

  const props: Record<string, string> = { company: job.company, dueText: job.dueText, source: job.source, dev: job.dev ? "true" : "false", ai: job.ai ? "true" : "false" };
  if (job.dueDate) props.dueDate = job.dueDate;
  if (job.location) props.location = job.location;
  if (job.career) props.career = job.career;
  return { title: `${job.company} — ${job.title}`, markdown: editorBlocks(out.join("\n")), externalId: job.id, props };
}
