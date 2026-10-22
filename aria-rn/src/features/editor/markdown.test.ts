/// <reference types="node" />
/**
 * 마크다운 왕복 — 페이지 본문(마크다운 정본) → 편집기 → 마크다운이 같은 글로 돌아오나(헤드리스 Lexical).
 * 실행: npm run test:editor (scripts/test-editor.mjs 가 esbuild 로 묶는다)
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { CodeExtension } from "@lexical/code-core";
import { buildEditorFromExtensions, HorizontalRuleExtension } from "@lexical/extension";
import { LinkExtension } from "@lexical/link";
import { CheckListExtension, ListExtension } from "@lexical/list";
import { RichTextExtension } from "@lexical/rich-text";
import { $getRoot, defineExtension } from "lexical";

import { CalloutExtension } from "./CalloutExtension";
import { ImageExtension } from "./ImageExtension";
import { $fromMarkdown, $toMarkdown } from "./markdown";
import { ToggleExtension } from "./ToggleExtension";

const headless = defineExtension({
  name: "llmwiki/test",
  dependencies: [RichTextExtension, ListExtension, CheckListExtension, LinkExtension, CodeExtension, HorizontalRuleExtension, ImageExtension, ToggleExtension, CalloutExtension],
  onError(e: Error) {
    throw e;
  },
});

function roundTrip(md: string): string {
  const editor = buildEditorFromExtensions(headless);
  editor.update(() => $fromMarkdown(md), { discrete: true });
  return editor.read(() => $toMarkdown());
}

function types(md: string): string[] {
  const editor = buildEditorFromExtensions(headless);
  editor.update(() => $fromMarkdown(md), { discrete: true });
  return editor.read(() => $getRoot().getChildren().map((n) => n.getType()));
}

/** 한 번 돌린 결과는 다시 돌려도 같아야 한다(저장할 때마다 글이 바뀌지 않게) */
function stable(md: string): string {
  const once = roundTrip(md);
  assert.equal(roundTrip(once), once, "두 번째 왕복에서 바뀌었다");
  return once;
}

test("기본 블록 — 제목 · 서식 · 링크 · 목록(중첩) · 번호 · 할 일 · 코드 · 구분선은 그대로 돌아온다", () => {
  const md = [
    "# 제목 1",
    "",
    "## 제목 2",
    "",
    "**굵게** 와 *기울임* 과 `코드` 와 [링크](https://example.com)",
    "",
    "- 하나",
    "    - 둘(안쪽)",
    "- 셋",
    "",
    "1. 첫째",
    "2. 둘째",
    "",
    "- [ ] 할 일",
    "- [x] 끝난 일",
    "",
    "```ts",
    "const a = 1;",
    "```",
    "",
    "---",
  ].join("\n");
  assert.equal(stable(md), md);
});

test("인용 — 일반 마크다운 '> ' 는 인용(토글 아님)으로 읽고 '> ' 로 내보낸다", () => {
  assert.deepEqual(types("> 인용한 말"), ["quote"]);
  assert.equal(stable("> 인용한 말"), "> 인용한 말");
});

test("토글 — <details> 를 읽고 안쪽 블록(목록 · 토글 속 토글)을 지킨다", () => {
  const md = [
    "<details open><summary>**펼친** 토글</summary>",
    "",
    "- 안쪽 목록",
    "- 둘째",
    "",
    "<details><summary>안쪽 토글</summary>",
    "",
    "깊은 문단",
    "",
    "</details>",
    "",
    "</details>",
    "",
    "토글 뒤 문단",
  ].join("\n");
  assert.deepEqual(types(md), ["toggle-container", "paragraph"]);
  assert.equal(stable(md), md);
  // 짝이 없는 <details> 는 글 그대로 둔다(내용을 잃지 않게)
  assert.match(roundTrip("<details><summary>닫히지 않음</summary>\n\n본문"), /닫히지 않음/);
});

test("콜아웃 — '> [!note] 💡' + '> ' 줄들을 콜아웃 하나로, 안쪽 목록까지", () => {
  const md = ["> [!note] ⚠️", "> 주의할 점", ">", "> - 첫째", "> - 둘째", "", "뒤 문단"].join("\n");
  assert.deepEqual(types(md), ["callout", "paragraph"]);
  assert.equal(stable(md), md);
});

test("이미지 — ![설명](주소 \"너비\")", () => {
  const md = '![도표](data:image/png;base64,AAAA "320")';
  assert.deepEqual(types(md), ["image"]);
  assert.equal(stable(md), md);
  assert.equal(stable("![](https://example.com/a.png)"), "![](https://example.com/a.png)");
});

test("이행된 업무 본문 · 가져온 공고 본문이 편집기를 거쳐도 그대로", () => {
  const migrated = [
    "옛 상태: 진행 중 · 중요도 보통",
    "",
    "## 목표",
    "",
    "그룹바이 공고 중 지원할 곳을 고른다",
    "",
    "## 완료 조건",
    "",
    "- [ ] 지원 후보 10곳 이하로 추림",
    "",
    "## 할 일",
    "",
    "- [ ] 후보 표 만들기 (2026-10-25)",
    "",
    "## 결과물",
    "",
    "- [후보 정리 시트](https://docs.google.com/spreadsheets/d/x) — 최신본",
  ].join("\n");
  assert.equal(stable(migrated), migrated);
  const job = ["- **회사**: 피트인", "- **마감**: 2026-11-30", "", "## 주요 업무", "", "LLM 서비스 개발", "", "## 링크", "", "- [공고 원문](https://groupby.kr/positions/10027)"].join("\n");
  assert.equal(stable(job), job);
});
