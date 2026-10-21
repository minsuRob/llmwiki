import { createState } from "lexical";

/**
 * 할 일이 아니게 된 항목 · 블록의 체크 값 — Lexical 은 할 일이 아닌 목록에서 체크 값을 지우니 따로 담아 둔다.
 * 다시 할 일로 바꾸면 되살린다(텍스트로 바꿨다 돌아와도 — Notion 과 같다)
 */
export const wasChecked = createState("lexWasChecked", { parse: (v) => v === true });
