import { HistoryExtension } from "@lexical/history";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useExtensionSignalValue } from "@lexical/react/useExtensionSignalValue";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  INDENT_CONTENT_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  REDO_COMMAND,
  TEXT_TYPE_TO_FORMAT,
  UNDO_COMMAND,
  type ElementFormatType,
  type TextFormatType,
} from "lexical";
import { useEffect, useState } from "react";

/** 아이콘 — Bootstrap Icons(16×16) 경로 */
const ICON = {
  undo: ["M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2v1z", "M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466z"],
  redo: ["M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z", "M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"],
  bold: ["M8.21 13c2.106 0 3.412-1.087 3.412-2.823 0-1.306-.984-2.283-2.324-2.386v-.055a2.176 2.176 0 0 0 1.852-2.14c0-1.51-1.162-2.46-3.014-2.46H3.843V13H8.21zM5.908 4.674h1.696c.963 0 1.517.451 1.517 1.244 0 .834-.629 1.32-1.73 1.32H5.908V4.673zm0 6.788V8.598h1.73c1.217 0 1.88.492 1.88 1.415 0 .943-.643 1.449-1.832 1.449H5.907z"],
  italic: ["M7.991 11.674 9.53 4.455c.123-.595.246-.71 1.347-.807l.11-.52H7.211l-.11.52c1.06.096 1.128.212 1.005.807L6.57 11.674c-.123.595-.246.71-1.346.806l-.11.52h3.774l.11-.52c-1.06-.095-1.129-.211-1.006-.806z"],
  underline: ["M5.313 3.136h-1.23V9.54c0 2.105 1.47 3.623 3.917 3.623s3.917-1.518 3.917-3.623V3.136h-1.23v6.323c0 1.49-.978 2.57-2.687 2.57-1.709 0-2.687-1.08-2.687-2.57V3.136zM12.5 15h-9v-1h9v1z"],
  strikethrough: ["M6.333 5.686c0 .31.083.581.27.814H5.166a2.776 2.776 0 0 1-.099-.76c0-1.627 1.436-2.768 3.48-2.768 1.969 0 3.39 1.175 3.445 2.85h-1.23c-.11-1.08-.964-1.743-2.25-1.743-1.23 0-2.18.602-2.18 1.607zm2.194 7.478c-2.153 0-3.589-1.107-3.705-2.81h1.23c.144 1.06 1.129 1.703 2.544 1.703 1.34 0 2.31-.705 2.31-1.675 0-.827-.547-1.374-1.914-1.675L8.046 8.5H1v-1h14v1h-3.504c.468.437.675.994.675 1.697 0 1.826-1.436 2.967-3.644 2.967z"],
  left: ["M2 12.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"],
  center: ["M4 12.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-2-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm2-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-2-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"],
  right: ["M6 12.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-4-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm4-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-4-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"],
  outdent: ["M2 3.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm5 3a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 3a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm-5 3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zM4.854 6.146a.5.5 0 0 1 0 .708L3.707 8l1.147 1.146a.5.5 0 0 1-.708.708l-1.5-1.5a.5.5 0 0 1 0-.708l1.5-1.5a.5.5 0 0 1 .708 0z"],
  indent: ["M2 3.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm5 3a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 3a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm-5 3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zM2.146 6.146a.5.5 0 0 1 .708 0l1.5 1.5a.5.5 0 0 1 0 .708l-1.5 1.5a.5.5 0 0 1-.708-.708L3.293 8 2.146 6.854a.5.5 0 0 1 0-.708z"],
  justify: ["M2 12.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"],
} as const;

function Icon({ name }: { name: keyof typeof ICON }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
      {ICON[name].map((d) => (
        <path key={d} fillRule="evenodd" d={d} />
      ))}
    </svg>
  );
}

const TEXT_FORMATS: { format: TextFormatType & keyof typeof ICON; label: string }[] = [
  { format: "bold", label: "Format Bold" },
  { format: "italic", label: "Format Italics" },
  { format: "underline", label: "Format Underline" },
  { format: "strikethrough", label: "Format Strikethrough" },
];
const ALIGNS: { format: ElementFormatType & keyof typeof ICON; label: string }[] = [
  { format: "left", label: "Left Align" },
  { format: "center", label: "Center Align" },
  { format: "right", label: "Right Align" },
  { format: "justify", label: "Justify Align" },
];

/** 되돌리기 · 다시 하기 · 굵게 · 기울임 · 밑줄 · 취소선 · 내어쓰기 · 들여쓰기 · 정렬 — 터치 기기엔 Tab 이 없어 들여쓰기도 버튼으로 */
export default function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const canUndo = useExtensionSignalValue(HistoryExtension, "canUndo");
  const canRedo = useExtensionSignalValue(HistoryExtension, "canRedo");
  /** 선택 영역의 글자 서식(비트) — 숫자라 같으면 다시 그리지 않는다 */
  const [format, setFormat] = useState(0);

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) =>
        editorState.read(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) setFormat(selection.format);
        }),
      ),
    [editor],
  );

  return (
    <div className="lex-toolbar">
      <button type="button" disabled={!canUndo} onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)} className="lex-toolbar-item" aria-label="Undo">
        <Icon name="undo" />
      </button>
      <button type="button" disabled={!canRedo} onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)} className="lex-toolbar-item" aria-label="Redo">
        <Icon name="redo" />
      </button>
      <div className="lex-divider" />
      {TEXT_FORMATS.map(({ format: f, label }) => {
        const on = (format & TEXT_TYPE_TO_FORMAT[f]) !== 0;
        return (
          <button
            key={f}
            type="button"
            onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, f)}
            className={"lex-toolbar-item" + (on ? " active" : "")}
            aria-label={label}
            aria-pressed={on}
          >
            <Icon name={f} />
          </button>
        );
      })}
      <div className="lex-divider" />
      <button type="button" onClick={() => editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined)} className="lex-toolbar-item" aria-label="Outdent">
        <Icon name="outdent" />
      </button>
      <button type="button" onClick={() => editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined)} className="lex-toolbar-item" aria-label="Indent">
        <Icon name="indent" />
      </button>
      <div className="lex-divider" />
      {ALIGNS.map(({ format: f, label }) => (
        <button key={f} type="button" onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, f)} className="lex-toolbar-item" aria-label={label}>
          <Icon name={f} />
        </button>
      ))}
    </div>
  );
}
