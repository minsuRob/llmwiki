import type { EditorThemeClasses } from "lexical";

/** Lexical 노드 → editor.css 클래스 */
export const editorTheme: EditorThemeClasses = {
  paragraph: "lex-paragraph",
  text: {
    bold: "lex-text-bold",
    italic: "lex-text-italic",
    underline: "lex-text-underline",
    strikethrough: "lex-text-strikethrough",
    underlineStrikethrough: "lex-text-underlineStrikethrough",
    code: "lex-text-code",
  },
};
