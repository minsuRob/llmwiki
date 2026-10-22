/**
 * 이 편집기의 마크다운 규칙에 맞춘다 — 일반 마크다운의 "> 인용" 은 여기서 토글(">")이라, 인용(세로줄 "| ")으로 바꿔 읽는다.
 * 코드 블록 안은 건드리지 않는다
 */
export function toEditorMarkdown(md: string): string {
  let inCode = false;
  return md
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      if (/^```/.test(line)) inCode = !inCode;
      return !inCode && /^>\s?/.test(line) ? line.replace(/^>\s?/, "| ") : line;
    })
    .join("\n");
}
