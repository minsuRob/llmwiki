"use dom";
import "./editor.css";

import type { DomWebViewProps } from "@expo/dom-webview";
import { AutoFocusExtension } from "@lexical/extension";
import { HistoryExtension } from "@lexical/history";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalExtensionComposer } from "@lexical/react/LexicalExtensionComposer";
import { RichTextExtension } from "@lexical/rich-text";
import { IS_DOM } from "expo/dom";
import { $getRoot, defineExtension } from "lexical";
import { useEffect, useRef, type CSSProperties } from "react";

import type { Palette } from "../../components/theme";
import { editorTheme } from "./theme";
import ToolbarPlugin from "./ToolbarPlugin";

/** 웹뷰에 넘기는 값 — expo/dom 의 DOMProps 는 react-native-webview 타입이 없으면 아무 키나 받으니 직접 좁힌다 */
export type EditorDomProps = Pick<DomWebViewProps, "style" | "containerStyle" | "scrollEnabled">;

export interface EditorChange {
  text: string;
  /** 편집기 상태(JSON) — 저장 · 복원용 */
  json: string;
}

/** 모듈 범위에 두어야 다시 그릴 때마다 편집기가 새로 만들어지지 않는다 */
const editorExtension = defineExtension({
  name: "llmwiki/editor",
  namespace: "llmwiki-editor",
  theme: editorTheme,
  dependencies: [RichTextExtension, HistoryExtension, AutoFocusExtension],
  onError(error: Error) {
    throw error;
  },
});

/** 내용이 바뀔 때만(선택 이동 · 기록 합치기 제외) 평문과 상태를 한 번에 보낸다 */
function ChangePlugin({ onChange }: { onChange: (change: EditorChange) => Promise<void> }) {
  const [editor] = useLexicalComposerContext();
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  }, [onChange]);
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, prevEditorState, tags }) => {
        if ((dirtyElements.size === 0 && dirtyLeaves.size === 0) || tags.has("history-merge") || prevEditorState.isEmpty()) return;
        void latest.current({ text: editorState.read(() => $getRoot().getTextContent()), json: JSON.stringify(editorState.toJSON()) });
      }),
    [editor],
  );
  return null;
}

/**
 * Lexical 기본 편집기 — 네이티브에서는 웹뷰(DOM 컴포넌트), 웹에서는 페이지에 그대로 그린다.
 * 색은 앱 팔레트를 --lex-* 변수로 받는다
 */
export default function LexicalEditor({
  palette,
  placeholder,
  onChange,
}: {
  palette: Palette;
  placeholder: string;
  onChange: (change: EditorChange) => Promise<void>;
  dom?: EditorDomProps;
}) {
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
    <div className={IS_DOM ? "lex-root lex-dom" : "lex-root"} style={vars}>
      <LexicalExtensionComposer extension={editorExtension} contentEditable={null}>
        <div className="lex-container">
          <ToolbarPlugin />
          <div className="lex-inner">
            <ContentEditable className="lex-input" aria-placeholder={placeholder} placeholder={<div className="lex-placeholder">{placeholder}</div>} />
          </div>
        </div>
        <ChangePlugin onChange={onChange} />
      </LexicalExtensionComposer>
    </div>
  );
}
