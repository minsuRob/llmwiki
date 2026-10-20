import { test } from "node:test";
import assert from "node:assert/strict";

import { checkJob, compareJobs, fromGroupby, fromInthiswork, hashJob, isExpired, parseDueDate, pickJob, planJobPrune, planJobSync, type Job } from "./jobs.ts";

const GB = {
  id: 10027,
  status: "완료",
  company: "트레독스",
  title: "AI 엔지니어 (경력)",
  location: "서울 마포구 마포대로 78",
  station: "공덕역·마포역 (추정)",
  main: "LLM 응답 품질 최적화",
  stack: "Python, FastAPI",
  features: "경력 3~10년",
  direction: "AI 문서 처리 서비스 고도화",
  due: "상시 (추정)",
  dev: true,
  devReason: "LLM·OCR AI 엔지니어링",
};

const ITW = {
  id: 407816,
  career: "신입/인턴",
  date: "2026-10-15",
  company: "유비벨록스",
  pos: "개발자 채용",
  link: "https://inthiswork.com/archives/407816",
  apply: "https://inthiswork.com/applylink",
  jobs: ["개발"],
  startup: true,
  it: true,
  ai: false,
  aititle: false,
  tool: true,
  tasks: ["백엔드 개발", "API 설계"],
  loc: "",
  due: "2026.11.6",
  short: false,
};

test("parseDueDate — 날짜로 시작하는 글만 날짜로 본다", () => {
  assert.equal(parseDueDate("2026-11-06"), "2026-11-06");
  assert.equal(parseDueDate("2026.11.6"), "2026-11-06");
  assert.equal(parseDueDate("2026.10.31"), "2026-10-31");
  assert.equal(parseDueDate("2026년10월25"), "2026-10-25");
  assert.equal(parseDueDate("2026년 10월 5일"), "2026-10-05");
  assert.equal(parseDueDate("마감일 미기재 (계약기간 2026-12-31 종료)"), null);
  assert.equal(parseDueDate("채용시 마감"), null);
  assert.equal(parseDueDate("본문 확인"), null);
  assert.equal(parseDueDate("2026-02-30"), null);
  assert.equal(parseDueDate(null), null);
});

test("isExpired — 마감 날짜가 오늘보다 앞이면 지난 공고, 오늘 마감은 아직", () => {
  assert.equal(isExpired({ dueDate: "2026-10-19" }, "2026-10-20"), true);
  assert.equal(isExpired({ dueDate: "2026-10-20" }, "2026-10-20"), false);
  assert.equal(isExpired({ dueDate: null }, "2026-10-20"), false);
});

test("fromGroupby — 상세 조사 결과를 공고로, 삭제된 공고는 뺀다", () => {
  const j = fromGroupby(GB)!;
  assert.equal(j.id, "gb-10027");
  assert.equal(j.url, "https://groupby.kr/positions/10027");
  assert.equal(j.dev, true);
  assert.equal(j.ai, true);
  assert.equal(j.dueDate, null);
  assert.equal(j.direction, "AI 문서 처리 서비스 고도화");
  assert.equal(checkJob(j), null);
  assert.equal(fromGroupby({ id: 10869, status: "미조사 (삭제된 채용공고)", reason: "삭제" }), null);
  assert.equal(fromGroupby({ ...GB, title: "Product Engineer" })!.ai, false);
  assert.equal(fromGroupby({ ...GB, title: "Email Marketer" })!.ai, false, "단어 안의 ai 는 AI 직무가 아니다");
});

test("fromInthiswork — 마감 날짜 · 본문 · 지원 링크를 옮긴다", () => {
  const r = fromInthiswork(ITW, "  본문 내용  ")!;
  assert.equal(r.job.id, "itw-407816");
  assert.equal(r.job.dueDate, "2026-11-06");
  assert.equal(r.job.applyUrl, "https://inthiswork.com/applylink");
  assert.equal(r.job.summary, "백엔드 개발 · API 설계");
  assert.equal(r.job.features, "스타트업, AI 도구 활용 언급");
  assert.equal(r.job.hasText, true);
  assert.deepEqual(r.text, { id: "itw-407816", text: "본문 내용" });
  assert.equal(checkJob(r.job), null);
  const noText = fromInthiswork(ITW, null)!;
  assert.equal(noText.job.hasText, false);
  assert.equal(noText.text, null);
  assert.equal(fromInthiswork({ ...ITW, link: "" }, null), null);
  assert.equal(fromInthiswork({ ...ITW, company: "" }, null)!.job.company, "회사 미기재");
});

test("hash — 내용이 같으면 같고, 본문만 바뀌어도 달라진다", () => {
  const a = fromInthiswork(ITW, "본문")!.job;
  assert.equal(fromInthiswork(ITW, "본문")!.job.hash, a.hash);
  assert.notEqual(fromInthiswork(ITW, "본문 수정")!.job.hash, a.hash);
  assert.equal(hashJob({ ...a, hash: "가짜" }).hash, a.hash, "받은 hash 는 무시하고 다시 계산한다");
});

const job = (id: string, over: Partial<Job> = {}): Job => hashJob({ ...fromGroupby({ ...GB, id: id.replace("gb-", "") })!, ...over });

test("planJobSync — 새것 · 바뀐 것만 쓰고, 지난 공고는 넣지 않고 지운다", () => {
  const today = "2026-10-20";
  const same = job("gb-1");
  const changed = job("gb-2", { title: "바뀐 제목" });
  const fresh = job("gb-3");
  const expiredNew = job("gb-4", { dueText: "2026-09-07", dueDate: "2026-09-07" });
  const expiredOld = job("gb-5", { dueText: "2026-10-01", dueDate: "2026-10-01" });
  const existing = [same, job("gb-2"), expiredOld, job("gb-6"), { ...job("itw-9"), id: "itw-9", source: "inthiswork" as const }];
  const plan = planJobSync(existing, [same, changed, fresh, expiredNew, expiredOld], today, ["groupby"]);
  assert.deepEqual(plan.write.map((j) => j.id).sort(), ["gb-2", "gb-3"]);
  assert.equal(plan.unchanged, 1);
  assert.deepEqual(plan.expired.sort(), ["gb-4", "gb-5"]);
  assert.deepEqual(plan.remove.sort(), ["gb-5", "gb-6"], "원본에서 사라진 그룹바이 공고도 지운다, 인디스워크는 그대로");
});

test("planJobSync — prune 없이는 원본에 없는 공고를 남긴다(나눠 보내기)", () => {
  const plan = planJobSync([job("gb-1"), job("gb-2")], [job("gb-1")], "2026-10-20");
  assert.deepEqual(plan.remove, []);
});

test("checkJob — 모양이 틀리거나 날짜를 지어낸 공고를 막는다", () => {
  const j = fromGroupby(GB)!;
  assert.match(checkJob({ ...j, id: "gb-999" })!, /id/);
  assert.match(checkJob({ ...j, url: "javascript:alert(1)" })!, /url/);
  assert.match(checkJob({ ...j, dueDate: "2026-11-01" })!, /dueDate/, "마감 글에 없는 날짜");
  assert.match(checkJob({ ...j, company: "" })!, /company/);
  assert.match(checkJob(null)!, /객체/);
});

test("compareJobs — 마감 날짜 가까운 순, 그다음 게시일 최신 순", () => {
  const a = job("gb-1", { dueDate: "2026-11-06" });
  const b = job("gb-2", { dueDate: "2026-10-25" });
  const c = job("gb-3", { postedAt: "2026-10-15" });
  const d = job("gb-4", { postedAt: "2026-09-01" });
  assert.deepEqual([c, a, d, b].sort(compareJobs).map((x) => x.id), ["gb-2", "gb-1", "gb-3", "gb-4"]);
});

test("planJobPrune — 원본에 없는 출처 공고 · 지난 공고를 지우고, 빈 원본이면 지우지 않는다", () => {
  const existing = [job("gb-1"), job("gb-2"), job("gb-3", { dueText: "2026-10-01", dueDate: "2026-10-01" }), { ...job("gb-9"), id: "itw-9", source: "inthiswork" as const }];
  assert.deepEqual(planJobPrune(existing, ["gb-1"], ["groupby"], "2026-10-20").sort(), ["gb-2", "gb-3"]);
  assert.deepEqual(planJobPrune(existing, [], ["groupby"], "2026-10-20"), ["gb-3"]);
});

test("pickJob — 모르는 필드는 버리고 hash 는 원래와 같다", () => {
  const j = fromInthiswork(ITW, "본문")!.job;
  const picked = pickJob({ ...j, evil: "x", hash: "가짜" } as unknown as Record<string, unknown>);
  assert.equal("evil" in picked, false);
  assert.equal(picked.hash, j.hash);
});
