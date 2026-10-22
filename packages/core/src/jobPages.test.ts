/**
 * 공고 → 페이지 가져오기 항목 · 줄 비교.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { jobToEntry } from "./jobPages.ts";
import { fromGroupby, fromInthiswork } from "./jobs.ts";
import { createPage, importPlan, splitMarkdownPages } from "./pages.ts";
import { diffLines, diffStats } from "./textDiff.ts";

test("그룹바이 공고 — 본문 없이 필드 목록 · 섹션 · 링크, props 로 거를 수 있다", () => {
  const job = fromGroupby({ id: "10027", status: "완료", company: "피트인", title: "AI 엔지니어", location: "서울 강남구", station: "역삼역", main: "LLM 서비스 개발", stack: "Python, TypeScript", features: "재택 주 2회", direction: "B2B SaaS", due: "2026-11-30", dev: true, devReason: "개발 직무" });
  if (!job) return assert.fail();
  const e = jobToEntry(job, null);
  assert.equal(e.externalId, "gb-10027");
  assert.equal(e.title, "피트인 — AI 엔지니어");
  assert.deepEqual(e.props, { company: "피트인", dueText: "2026-11-30", source: "groupby", dev: "true", ai: "true", dueDate: "2026-11-30", location: "서울 강남구" });
  assert.equal(
    e.markdown,
    [
      "- **회사**: 피트인",
      "- **마감**: 2026-11-30",
      "- **위치**: 서울 강남구 · 역삼역",
      "- **출처**: 그룹바이",
      "",
      "## 주요 업무",
      "",
      "LLM 서비스 개발",
      "",
      "## 스택",
      "",
      "Python, TypeScript",
      "",
      "## 특징",
      "",
      "재택 주 2회",
      "",
      "## 방향성",
      "",
      "B2B SaaS",
      "",
      "## 개발 직군 판단",
      "",
      "개발 직무",
      "",
      "## 링크",
      "",
      "- [공고 원문](https://groupby.kr/positions/10027)",
    ].join("\n"),
  );
});

test("인디스워크 공고 — 본문 · 지원 링크가 들어가고, 같은 부모 아래 다시 가져오면 같은 공고로 맞춘다", () => {
  const r = fromInthiswork({ id: "407816", career: "신입/인턴", date: "2026-10-20", company: "", pos: "백엔드 인턴", link: "https://inthiswork.com/archives/407816", apply: "https://apply.example.com/1", jobs: ["IT개발"], it: true, due: "채용 시 마감", tasks: ["API 개발"] }, "회사 소개\n\n담당 업무: API");
  if (!r) return assert.fail();
  const e = jobToEntry(r.job, r.text);
  assert.match(e.markdown, /- \*\*회사\*\*: 회사 미기재/);
  assert.match(e.markdown, /## 공고 본문\n\n회사 소개\n\n담당 업무: API/);
  assert.match(e.markdown, /- \[지원하기\]\(https:\/\/apply\.example\.com\/1\)$/);
  assert.equal(e.props?.career, "신입/인턴");
  assert.equal(e.props?.dueDate, undefined, "날짜로 시작하지 않는 마감은 날짜로 만들지 않는다");
  const parent = createPage([], { workspaceId: "ws-personal", title: "취준" }, "2026-10-22T00:00:00Z");
  if (parent.kind !== "ok") return assert.fail();
  const plan = importPlan(parent.pages, "ws-personal", parent.page.id, [e, e], "2026-10-22T00:00:00Z");
  if ("kind" in plan) return assert.fail();
  assert.equal(plan.create.length, 1, "같은 공고가 두 번 와도 하나");
});

test("줄 비교 — 같은 줄 · 지운 줄 · 더한 줄, 아주 큰 본문도 멈추지 않는다", () => {
  const d = diffLines("a\nb\nc\nd", "a\nc\nx\nd");
  assert.deepEqual(d.map((x) => `${x.op[0]}${x.text}`), ["sa", "db", "sc", "ax", "sd"]);
  assert.deepEqual(diffStats(d), { added: 1, removed: 1 });
  const big = Array.from({ length: 3000 }, (_, i) => `줄 ${i}`).join("\n");
  const big2 = Array.from({ length: 3000 }, (_, i) => `새 줄 ${i}`).join("\n");
  const t = Date.now();
  const d2 = diffLines(`머리\n${big}\n꼬리`, `머리\n${big2}\n꼬리`);
  assert.ok(Date.now() - t < 2000);
  assert.deepEqual(diffStats(d2), { added: 3000, removed: 3000 });
  assert.equal(d2[0].op, "same");
  assert.equal(d2.at(-1)?.text, "꼬리");
});

test("마크다운 붙여 넣기 — '# 제목' 마다 페이지 하나(코드 블록 속 '#' 은 그대로), 제목이 같으면 같은 바깥 id", () => {
  const md = "# 피트인\n- 1순위\n```sh\n# 주석\n```\n# 그룹바이\n본문";
  const e = splitMarkdownPages(md, "붙여 넣은 글");
  assert.deepEqual(e.map((x) => x.title), ["피트인", "그룹바이"]);
  assert.match(e[0].markdown, /# 주석/);
  assert.equal(splitMarkdownPages("# 피트인\n다른 본문", "x")[0].externalId, e[0].externalId);
  assert.deepEqual(splitMarkdownPages("제목 없는 글", "붙여 넣은 글").map((x) => x.title), ["붙여 넣은 글"]);
  assert.deepEqual(splitMarkdownPages("  \n", "x"), []);
});
