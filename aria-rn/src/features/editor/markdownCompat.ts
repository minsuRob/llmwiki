/**
 * 이 편집기의 마크다운 규칙에 맞춘다 — 일반 마크다운의 "> 인용" 은 여기서 토글(">")이라, 인용(세로줄 "| ")으로 바꿔 읽는다.
 * 코드 블록 안과 콜아웃("> [!note]" 으로 시작하는 "> " 줄들 — 콜아웃 변환이 통째로 읽는다)은 건드리지 않는다
 */
export function toEditorMarkdown(md: string): string {
  let inCode = false;
  let inCallout = false;
  return md
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      if (/^```/.test(line)) inCode = !inCode;
      if (inCode) return line;
      if (/^>\s?\[!\w+\]/.test(line)) inCallout = true;
      else if (!/^>/.test(line)) inCallout = false;
      return !inCallout && /^>\s?/.test(line) ? line.replace(/^>\s?/, "| ") : line;
    })
    .join("\n");
}
