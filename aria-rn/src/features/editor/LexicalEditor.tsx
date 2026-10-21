"use dom";
import "./editor.css";

import type { DomWebViewProps } from "@expo/dom-webview";
import { registerMarkdownShortcuts } from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalExtensionComposer } from "@lexical/react/LexicalExtensionComposer";
import { mergeRegister } from "@lexical/utils";
import { IS_DOM } from "expo/dom";
import { $getRoot } from "lexical";
import { useEffect, useRef, type CSSProperties } from "react";

import type { Palette } from "../../components/theme";
import { editorExtension } from "./extension";
import FloatingToolbarPlugin from "./FloatingToolbarPlugin";
import { MARKDOWN_TRANSFORMERS, registerInstantBlocks, registerMarkdownPaste } from "./markdown";
import PlaceholderPlugin from "./PlaceholderPlugin";
import { registerBlockShortcuts } from "./shortcuts";
import SlashMenuPlugin from "./SlashMenuPlugin";
import ToolbarPlugin from "./ToolbarPlugin";

/** 웹뷰에 넘기는 값 — expo/dom 의 DOMProps 는 아무 키나 받으니 쓰는 것만 직접 좁힌다 */
export type EditorDomProps = Pick<DomWebViewProps, "style" | "containerStyle" | "scrollEnabled">;

export interface EditorChange {
  text: string;
  /** 편집기 상태(JSON) — 저장 · 복원용 */
  json: string;
}

/** 내용이 바뀔 때만(선택 이동 · 기록 합치기 제외) 평문과 상태를 한 번에 보낸다 */
function ChangePlugin({ onChange }: { onChange: (change: EditorChange) => Promise<void> }) {
  const [editor] = useLexicalComposerContext();
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  }, [onChange]);
  useEffect(() => {
    // 글자마다 보내지 않고 잠깐 멈췄을 때 한 번 — 이미지(data URL)가 들면 상태 JSON 이 커진다
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unregister = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves, prevEditorState, tags }) => {
      if ((dirtyElements.size === 0 && dirtyLeaves.size === 0) || tags.has("history-merge") || prevEditorState.isEmpty()) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const state = editor.getEditorState();
        void latest.current({ text: state.read(() => $getRoot().getTextContent()), json: JSON.stringify(state.toJSON()) });
      }, 250);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unregister();
    };
  }, [editor]);
  return null;
}

/** "# " · "- " · "[] " · "**굵게**" 같은 마크다운 단축 입력 + "```" · "---" 바로 바꾸기 + 여러 줄 마크다운 붙여넣기 */
function MarkdownPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => mergeRegister(registerMarkdownShortcuts(editor, MARKDOWN_TRANSFORMERS), registerInstantBlocks(editor), registerMarkdownPaste(editor)), [editor]);
  return null;
}

/** Cmd+Opt+숫자 블록 바꾸기 · Cmd+Enter 체크 · Cmd+D 복제 · Cmd+Shift+↑↓ 옮기기 */
function BlockShortcutsPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => registerBlockShortcuts(editor), [editor]);
  return null;
}

/**
 * Lexical 기본 편집기 — 네이티브에서는 웹뷰(DOM 컴포넌트), 웹에서는 페이지에 그대로 그린다.
 * 색은 앱 팔레트를 --lex-* 변수로 받는다
 */
export default function LexicalEditor({
  palette,
  dark,
  placeholder,
  onChange,
}: {
  palette: Palette;
  /** 다크 모드 — 글자 · 배경 색 팔레트를 어두운 값으로(.lex-dark) */
  dark: boolean;
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
    <div className={"lex-root" + (IS_DOM ? " lex-dom" : "") + (dark ? " lex-dark" : "")} style={vars}>
      <LexicalExtensionComposer extension={editorExtension} contentEditable={null}>
        <div className="lex-container">
          <ToolbarPlugin />
          <div className="lex-inner">
            <ContentEditable className="lex-input" aria-placeholder={placeholder} placeholder={<div className="lex-placeholder">{placeholder}</div>} />
          </div>
        </div>
        <MarkdownPlugin />
        <PlaceholderPlugin />
        <BlockShortcutsPlugin />
        <SlashMenuPlugin />
        <FloatingToolbarPlugin />
        <ChangePlugin onChange={onChange} />
      </LexicalExtensionComposer>
    </div>
  );
}
