"use dom";
import "./editor.css";

import { CodeExtension } from "@lexical/code-core";
import { HorizontalRuleExtension } from "@lexical/extension";
import { LinkExtension } from "@lexical/link";
import { CheckListExtension, ListExtension } from "@lexical/list";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalExtensionComposer } from "@lexical/react/LexicalExtensionComposer";
import { RichTextExtension } from "@lexical/rich-text";
import { IS_DOM } from "expo/dom";
import { $setSelection, defineExtension } from "lexical";
import { useEffect, type CSSProperties } from "react";

import type { Palette } from "../../components/theme";
import { CalloutExtension } from "./CalloutExtension";
import type { EditorDomProps } from "./LexicalEditor";
import { MARKDOWN_TRANSFORMERS } from "./markdown";
import { toEditorMarkdown } from "./markdownCompat";
import { editorTheme } from "./theme";
import { ToggleExtension } from "./ToggleExtension";

/**
 * 읽기 전용 Lexical — 마크다운을 편집기와 같은 노드 · 테마 · 마크다운 규칙(MARKDOWN_TRANSFORMERS)으로 읽어 서식 있게 보인다.
 * 편집 기능(기록 · 자동 초점 · 단축키 · 도구 막대)은 싣지 않는다. 모듈 범위에 두어야 다시 그릴 때 새로 만들어지지 않는다.
 */
const viewerExtension = defineExtension({
  name: "llmwiki/viewer",
  namespace: "llmwiki-viewer",
  theme: editorTheme,
  dependencies: [RichTextExtension, ListExtension, CheckListExtension, LinkExtension, CodeExtension, HorizontalRuleExtension, ToggleExtension, CalloutExtension],
  onError(error: Error) {
    throw error;
  },
});

/** 마크다운이 바뀔 때마다 통째로 다시 읽는다 — 업무가 바뀌면(rev) 화면도 따라간다 */
function MarkdownSyncPlugin({ markdown }: { markdown: string }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(false);
  }, [editor]);
  useEffect(() => {
    editor.update(
      () => {
        $convertFromMarkdownString(toEditorMarkdown(markdown), MARKDOWN_TRANSFORMERS);
        // 가져오기 규칙이 남긴 선택을 지운다 — 읽기 전용이라 커서 · 초점이 필요 없다
        $setSelection(null);
      },
      { tag: "llmwiki-sync" },
    );
  }, [editor, markdown]);
  return null;
}

export default function LexicalViewer({ palette, dark, markdown }: { palette: Palette; dark: boolean; markdown: string; dom?: EditorDomProps }) {
  const vars = {
    "--lex-bg": palette.bg,
    "--lex-surface": palette.surface,
    "--lex-card": palette.card,
    "--lex-text": palette.text,
    "--lex-muted": palette.muted,
    "--lex-accent": palette.accent,
    "--lex-soft": palette.soft,
    "--lex-border": palette.border,
  } as CSSProperties;
  return (
    <div className={"lex-root lex-viewer" + (IS_DOM ? " lex-dom" : "") + (dark ? " lex-dark" : "")} style={vars}>
      <LexicalExtensionComposer extension={viewerExtension} contentEditable={null}>
        <div className="lex-container">
          <div className="lex-inner">
            <ContentEditable className="lex-input" aria-readonly="true" />
          </div>
        </div>
        <MarkdownSyncPlugin markdown={markdown} />
      </LexicalExtensionComposer>
    </div>
  );
}
