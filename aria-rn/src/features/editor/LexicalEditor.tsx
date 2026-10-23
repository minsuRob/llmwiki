"use dom";
import "./editor.css";

import type { DomWebViewProps } from "@expo/dom-webview";
import { $generateHtmlFromNodes } from "@lexical/html";
import { registerMarkdownShortcuts } from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalExtensionComposer } from "@lexical/react/LexicalExtensionComposer";
import { mergeRegister } from "@lexical/utils";
import { IS_DOM } from "expo/dom";
import { $getRoot, BLUR_COMMAND, CLEAR_HISTORY_COMMAND, COMMAND_PRIORITY_LOW } from "lexical";
import { useEffect, useRef, type CSSProperties } from "react";

import type { Palette } from "../../components/theme";
import BlockSelectionPlugin from "./BlockSelectionPlugin";
import DraggableBlockPlugin from "./DraggableBlockPlugin";
import { editorExtension } from "./extension";
import LinkHoverPlugin from "./LinkHoverPlugin";
import FloatingToolbarPlugin from "./FloatingToolbarPlugin";
import { registerListStyles } from "./listStyle";
import { $fromMarkdown, $toMarkdown, MARKDOWN_TRANSFORMERS, registerInstantBlocks, registerMarkdownPaste } from "./markdown";
import PlaceholderPlugin from "./PlaceholderPlugin";
import { registerBlockShortcuts, registerImeEnter } from "./shortcuts";
import SlashMenuPlugin from "./SlashMenuPlugin";
import ToolbarPlugin from "./ToolbarPlugin";

/** 웹뷰에 넘기는 값 — expo/dom 의 DOMProps 는 아무 키나 받으니 쓰는 것만 직접 좁힌다 */
export type EditorDomProps = Pick<DomWebViewProps, "style" | "containerStyle" | "scrollEnabled">;

export interface EditorChange {
  text: string;
  /** 편집기 상태(JSON) — 저장 · 복원용 */
  json: string;
  /** 편집기 내용을 HTML 로 — 원본 보기용 */
  html: string;
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
        const { text, html } = editor.read(() => ({ text: $getRoot().getTextContent(), html: $generateHtmlFromNodes(editor, null) }));
        void latest.current({ text, json: JSON.stringify(state.toJSON()), html });
      }, 250);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unregister();
    };
  }, [editor]);
  return null;
}

const LOAD_TAG = "llmwiki-load";
/** 마크다운 저장 — 멈추고 이만큼 지나면(또는 초점을 잃으면) 한 번 */
const SAVE_DEBOUNCE_MS = 1500;

/**
 * 처음 내용(페이지 본문 마크다운)을 넣고, 바뀐 마크다운을 알린다.
 * 넣은 직후 편집기가 내보낸 글을 기준으로 삼아, 사람이 실제로 고쳤을 때만 보낸다(열기만 해도 저장되는 일이 없게).
 * 다른 본문을 넣으려면 부르는 쪽이 key 를 바꿔 편집기를 새로 만든다.
 */
function MarkdownSyncPlugin({ initial, onMarkdown }: { initial: string; onMarkdown?: (markdown: string) => Promise<void> }) {
  const [editor] = useLexicalComposerContext();
  const latest = useRef(onMarkdown);
  useEffect(() => {
    latest.current = onMarkdown;
  }, [onMarkdown]);
  useEffect(() => {
    let baseline = "";
    editor.update(() => $fromMarkdown(initial), { tag: LOAD_TAG, discrete: true });
    baseline = editor.read(() => $toMarkdown());
    // 처음 내용은 되돌리기(Cmd+Z) 대상이 아니다
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      const md = editor.read(() => $toMarkdown());
      if (md === baseline) return;
      baseline = md;
      void latest.current?.(md);
    };
    const unregister = mergeRegister(
      editor.registerUpdateListener(({ dirtyElements, dirtyLeaves, tags }) => {
        if ((dirtyElements.size === 0 && dirtyLeaves.size === 0) || tags.has(LOAD_TAG)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
      }),
      editor.registerCommand(
        BLUR_COMMAND,
        () => {
          if (timer) flush();
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
    return () => {
      // 닫히거나 다른 페이지로 갈 때 — 기다리던 저장을 놓치지 않는다
      if (timer) flush();
      unregister();
    };
    // 처음 한 번만 — 다른 본문은 key 로 새 편집기를
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);
  return null;
}

/** "# " · "- " · "[] " · "**굵게**" 같은 마크다운 단축 입력 + "```" · "---" 바로 바꾸기 + 여러 줄 마크다운 붙여넣기 */
function MarkdownPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () => mergeRegister(registerMarkdownShortcuts(editor, MARKDOWN_TRANSFORMERS), registerInstantBlocks(editor), registerMarkdownPaste(editor), registerListStyles(editor)),
    [editor],
  );
  return null;
}

/** Cmd+Opt+숫자(Windows Ctrl+Shift+숫자) 블록 바꾸기 · Cmd+Enter 체크 · Cmd+D 복제 · Cmd+Shift+↑↓ 옮기기 */
function BlockShortcutsPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => mergeRegister(registerBlockShortcuts(editor), registerImeEnter(editor)), [editor]);
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
  initialMarkdown,
  onMarkdown,
}: {
  palette: Palette;
  /** 다크 모드 — 글자 · 배경 색 팔레트를 어두운 값으로(.lex-dark) */
  dark: boolean;
  placeholder: string;
  onChange?: (change: EditorChange) => Promise<void>;
  /** 처음 내용(마크다운) — 있으면 넣고 마크다운 동기화를 켠다 */
  initialMarkdown?: string;
  /** 사람이 고친 마크다운(1.5초 멈춤 · 초점 잃음) — 바뀌었을 때만 */
  onMarkdown?: (markdown: string) => Promise<void>;
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
    <div className={"lex-root lex-blockdrag" + (IS_DOM ? " lex-dom" : "") + (dark ? " lex-dark" : "")} style={vars}>
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
        <DraggableBlockPlugin />
        <BlockSelectionPlugin />
        <LinkHoverPlugin />
        {onChange ? <ChangePlugin onChange={onChange} /> : null}
        {initialMarkdown != null ? <MarkdownSyncPlugin initial={initialMarkdown} onMarkdown={onMarkdown} /> : null}
      </LexicalExtensionComposer>
    </div>
  );
}
