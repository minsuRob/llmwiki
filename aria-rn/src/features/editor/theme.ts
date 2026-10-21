import type { EditorThemeClasses } from "lexical";

/** Lexical 노드 → editor.css 클래스 */
export const editorTheme: EditorThemeClasses = {
  paragraph: "lex-paragraph",
  heading: { h1: "lex-h1", h2: "lex-h2", h3: "lex-h3", h4: "lex-h4" },
  quote: "lex-quote",
  code: "lex-code",
  hr: "lex-hr",
  link: "lex-link",
  indent: "lex-indent",
  list: {
    ul: "lex-ul",
    ol: "lex-ol",
    checklist: "lex-checklist",
    listitem: "lex-li",
    listitemChecked: "lex-li-checked",
    listitemUnchecked: "lex-li-unchecked",
    nested: { listitem: "lex-li-nested" },
    olDepth: ["lex-ol-1", "lex-ol-2", "lex-ol-3"],
    ulDepth: ["lex-ul-1", "lex-ul-2", "lex-ul-3"],
  },
  text: {
    bold: "lex-text-bold",
    italic: "lex-text-italic",
    underline: "lex-text-underline",
    strikethrough: "lex-text-strikethrough",
    underlineStrikethrough: "lex-text-underlineStrikethrough",
    code: "lex-text-code",
    highlight: "lex-text-highlight",
  },
};
