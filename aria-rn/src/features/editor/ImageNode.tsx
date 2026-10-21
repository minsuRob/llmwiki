import "./image.css";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import {
  $applyNodeReplacement,
  $createNodeSelection,
  $createParagraphNode,
  $getDocument,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $setSelection,
  addClassNamesToElement,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  DecoratorNode,
  isDOMNode,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  mergeRegister,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type LexicalParseJSON,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from "react";

/** 손잡이로 줄일 수 있는 가장 작은 너비(px) */
export const IMAGE_MIN_WIDTH = 80;

export interface ImagePayload {
  /** 본 이미지(데이터 URL) */
  src: string;
  /** 작은 미리보기(데이터 URL) — 본 이미지를 읽는 동안 흐리게 보인다 */
  thumb?: string;
  /** 보이는 너비(px) — 없으면 원본 크기를 칸에 맞춘다 */
  width?: number | null;
  alt?: string;
  naturalWidth?: number;
  naturalHeight?: number;
}

export type SerializedImageNode = Spread<
  {
    src: string;
    thumb: string;
    width: number | null;
    alt: string;
    naturalWidth: number;
    naturalHeight: number;
  },
  SerializedLexicalNode
>;

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** 이미지 블록 — 데이터 URL 만 담아 편집기 상태(JSON)만으로 저장 · 복원된다 */
export class ImageNode extends DecoratorNode<JSX.Element> {
  __src: string;
  __thumb: string;
  __width: number | null;
  __alt: string;
  __naturalWidth: number;
  __naturalHeight: number;

  static getType(): string {
    return "image";
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(
      {
        src: node.__src,
        thumb: node.__thumb,
        width: node.__width,
        alt: node.__alt,
        naturalWidth: node.__naturalWidth,
        naturalHeight: node.__naturalHeight,
      },
      node.__key,
    );
  }

  static importJSON(serializedNode: LexicalParseJSON<SerializedImageNode>): ImageNode {
    return $createImageNode({ src: "" }).updateFromJSON(serializedNode);
  }

  static importDOM(): DOMConversionMap | null {
    return { img: () => ({ conversion: $convertImageElement, priority: 0 }) };
  }

  constructor(payload: ImagePayload = { src: "" }, key?: NodeKey) {
    super(key);
    this.__src = payload.src;
    this.__thumb = payload.thumb ?? "";
    this.__width = payload.width ? Math.round(payload.width) : null;
    this.__alt = payload.alt ?? "";
    this.__naturalWidth = payload.naturalWidth ?? 0;
    this.__naturalHeight = payload.naturalHeight ?? 0;
  }

  updateFromJSON(serializedNode: LexicalParseJSON<SerializedImageNode>): this {
    const self = super.updateFromJSON(serializedNode).getWritable();
    self.__src = str(serializedNode.src);
    self.__thumb = str(serializedNode.thumb);
    self.__width = num(serializedNode.width) || null;
    self.__alt = str(serializedNode.alt);
    self.__naturalWidth = num(serializedNode.naturalWidth);
    self.__naturalHeight = num(serializedNode.naturalHeight);
    return self;
  }

  exportJSON(): SerializedImageNode {
    return {
      ...super.exportJSON(),
      type: "image",
      src: this.__src,
      thumb: this.__thumb,
      width: this.__width,
      alt: this.__alt,
      naturalWidth: this.__naturalWidth,
      naturalHeight: this.__naturalHeight,
    };
  }

  exportDOM(): DOMExportOutput {
    const img = $getDocument().createElement("img");
    img.src = this.__src;
    img.alt = this.__alt;
    const w = this.__width ?? this.__naturalWidth;
    if (w) img.width = w;
    if (w && this.__naturalWidth && this.__naturalHeight) img.height = Math.round((w * this.__naturalHeight) / this.__naturalWidth);
    return { element: img };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const div = $getDocument().createElement("div");
    addClassNamesToElement(div, "lex-image", config.theme.image);
    return div;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): false {
    return false;
  }

  getTextContent(): string {
    return "";
  }

  getSrc(): string {
    return this.getLatest().__src;
  }

  getThumb(): string {
    return this.getLatest().__thumb;
  }

  getAlt(): string {
    return this.getLatest().__alt;
  }

  getWidth(): number | null {
    return this.getLatest().__width;
  }

  setWidth(width: number | null): this {
    const self = this.getWritable();
    self.__width = width ? Math.round(width) : null;
    return self;
  }

  setAlt(alt: string): this {
    const self = this.getWritable();
    self.__alt = alt;
    return self;
  }

  decorate(): JSX.Element {
    return (
      <ImageBlock
        nodeKey={this.__key}
        src={this.__src}
        thumb={this.__thumb}
        width={this.__width}
        alt={this.__alt}
        naturalWidth={this.__naturalWidth}
        naturalHeight={this.__naturalHeight}
      />
    );
  }
}

/** 붙여 넣은 HTML 의 <img> — 기기 안에만 두려고 데이터 URL 만 받는다 */
function $convertImageElement(domNode: HTMLElement): DOMConversionOutput {
  const img = domNode as HTMLImageElement;
  const src = img.getAttribute("src") ?? "";
  if (!src.startsWith("data:image/")) return { node: null };
  return {
    node: $createImageNode({
      src,
      alt: img.alt,
      naturalWidth: img.naturalWidth || num(Number(img.getAttribute("width"))),
      naturalHeight: img.naturalHeight || num(Number(img.getAttribute("height"))),
    }),
  };
}

export function $createImageNode(payload: ImagePayload): ImageNode {
  return $applyNodeReplacement(new ImageNode(payload));
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode;
}

interface ImageBlockProps {
  nodeKey: NodeKey;
  src: string;
  thumb: string;
  width: number | null;
  alt: string;
  naturalWidth: number;
  naturalHeight: number;
}

/** 보이는 이미지 — 미리보기를 흐리게 먼저, 본 이미지가 읽히면 바꾼다. 선택 · 지우기 · 오른쪽 손잡이로 너비 조절 */
function ImageBlock({ nodeKey, src, thumb, width, alt, naturalWidth, naturalHeight }: ImageBlockProps) {
  const [editor] = useLexicalComposerContext();
  const editable = useLexicalEditable();
  const [isSelected] = useLexicalNodeSelection(nodeKey);
  const frameRef = useRef<HTMLDivElement>(null);
  /** 다 읽힌 본 이미지 src — src 가 바뀌면 다시 미리보기부터 */
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  /** 원본 크기를 모르는 이미지(HTML 에서 온 것)는 읽힌 뒤 크기로 자리를 잡는다 */
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  /** 끄는 동안의 너비 — 놓으면 노드에 적는다 */
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  const loaded = loadedSrc === src;
  const nw = naturalWidth || measured?.w || 0;
  const nh = naturalHeight || measured?.h || 0;
  const sized = nw > 0 && nh > 0;
  const shownWidth = dragWidth ?? width ?? (sized ? nw : null);

  useEffect(
    () =>
      mergeRegister(
        editor.registerCommand(
          CLICK_COMMAND,
          (event) => {
            const frame = frameRef.current;
            if (!frame || !isDOMNode(event.target) || !frame.contains(event.target)) return false;
            const selection = $getSelection();
            const next = event.shiftKey && $isNodeSelection(selection) ? selection : $createNodeSelection();
            next.add(nodeKey);
            $setSelection(next);
            return true;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(KEY_BACKSPACE_COMMAND, (event) => $removeIfSelected(nodeKey, event, true), COMMAND_PRIORITY_LOW),
        editor.registerCommand(KEY_DELETE_COMMAND, (event) => $removeIfSelected(nodeKey, event, false), COMMAND_PRIORITY_LOW),
        editor.registerCommand(
          KEY_ENTER_COMMAND,
          (event) => {
            const selection = $getSelection();
            if (!$isNodeSelection(selection) || !selection.has(nodeKey)) return false;
            const node = $getNodeByKey(nodeKey);
            if (!$isImageNode(node)) return false;
            event?.preventDefault();
            // 선택된 이미지에서 Enter — 바로 아래에 새 줄
            const paragraph = $createParagraphNode();
            node.insertAfter(paragraph);
            paragraph.select();
            return true;
          },
          COMMAND_PRIORITY_LOW,
        ),
      ),
    [editor, nodeKey],
  );

  const onResizeStart = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const frame = frameRef.current;
    const host = frame?.parentElement;
    if (!editable || !frame || !host || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startWidth = frame.getBoundingClientRect().width;
    const maxWidth = Math.max(IMAGE_MIN_WIDTH, host.clientWidth);
    let next = startWidth;
    handle.setPointerCapture(pointerId);
    const onMove = (ev: PointerEvent) => {
      next = Math.min(maxWidth, Math.max(IMAGE_MIN_WIDTH, startWidth + ev.clientX - startX));
      setDragWidth(next);
    };
    const onEnd = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      if (Math.round(next) === Math.round(startWidth)) {
        setDragWidth(null);
        return;
      }
      editor.update(
        () => {
          const node = $getNodeByKey(nodeKey);
          if ($isImageNode(node)) node.setWidth(next);
        },
        // 노드 너비가 그려진 뒤에 끄는 너비를 놓아야 깜빡이지 않는다
        { onUpdate: () => setDragWidth(null) },
      );
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  };

  const className =
    "lex-image-frame" + (sized ? "" : " unsized") + (isSelected ? " selected" : "") + (dragWidth !== null ? " resizing" : "") + (loaded ? " loaded" : "");

  return (
    <div
      ref={frameRef}
      className={className}
      style={{ width: shownWidth ?? undefined, aspectRatio: sized ? `${nw} / ${nh}` : undefined }}
    >
      {thumb && !loaded ? <img className="lex-image-thumb" src={thumb} alt="" aria-hidden draggable={false} /> : null}
      <img
        className="lex-image-full"
        src={src}
        alt={alt}
        draggable={false}
        decoding="async"
        ref={(el) => {
          // 이미 읽힌(캐시) 이미지는 load 가 오지 않을 수 있다
          if (el?.complete && el.naturalWidth > 0 && loadedSrc !== src) setLoadedSrc(src);
        }}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (!naturalWidth || !naturalHeight) setMeasured({ w: img.naturalWidth, h: img.naturalHeight });
          setLoadedSrc(src);
        }}
      />
      {editable ? (
        <span className="lex-image-handle" onPointerDown={onResizeStart} aria-hidden>
          <span className="lex-image-handle-bar" />
        </span>
      ) : null}
    </div>
  );
}

/** 이 이미지가 노드 선택돼 있으면 지우고, 커서를 앞(Backspace) · 뒤(Delete) 블록으로 */
function $removeIfSelected(nodeKey: NodeKey, event: KeyboardEvent, backward: boolean): boolean {
  const selection = $getSelection();
  if (!$isNodeSelection(selection) || !selection.has(nodeKey)) return false;
  const node = $getNodeByKey(nodeKey);
  if (!$isImageNode(node)) return false;
  event.preventDefault();
  const prev = node.getPreviousSibling();
  const next = node.getNextSibling();
  const target = backward ? (prev ?? next) : (next ?? prev);
  node.remove();
  if (target) {
    if (target === prev) target.selectEnd();
    else target.selectStart();
  } else {
    const paragraph = $createParagraphNode();
    $getRoot().append(paragraph);
    paragraph.select();
  }
  return true;
}
