import { $insertNodeToNearestRoot, eventFiles } from "@lexical/utils";
import {
  $createNodeSelection,
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $setSelection,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW,
  createCommand,
  defineExtension,
  DRAGOVER_COMMAND,
  DROP_COMMAND,
  mergeRegister,
  PASTE_COMMAND,
  safeCast,
  type LexicalCommand,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";

import { altFromFileName, isImageFile, processImageFile } from "./imageFile";
import { $createImageNode, ImageNode } from "./ImageNode";

export interface InsertImagePayload {
  src: string;
  thumb: string;
  width?: number | null;
  naturalWidth: number;
  naturalHeight: number;
  alt: string;
}

export interface ImageExtensionConfig {
  /** 처리 실패(이미지 아님 · 너무 큼 · 못 여는 형식) — 메시지는 한국어 */
  onError: (error: Error) => void;
}

/** 이미 처리된 이미지를 커서가 있는 블록 뒤에 넣는다 */
export const INSERT_IMAGE_COMMAND: LexicalCommand<InsertImagePayload> = createCommand("INSERT_IMAGE_COMMAND");
/** 파일 고르기 창을 연다 — 누르기(사용자 동작) 처리 안에서 보내야 iOS · 브라우저가 막지 않는다 */
export const OPEN_IMAGE_PICKER_COMMAND: LexicalCommand<void> = createCommand("OPEN_IMAGE_PICKER_COMMAND");

/**
 * 이미지 노드를 블록으로 넣는다(편집기 update 안에서).
 * 빈 문단에 있으면 그 문단을 바꾸고, 아니면 지금 블록 뒤에. 마지막 블록이면 아래에 빈 문단을 붙여 커서를 둔다
 */
export function $insertImage(payload: InsertImagePayload): void {
  const node = $createImageNode(payload);
  const selection = $getSelection();
  const block = $isRangeSelection(selection) && selection.isCollapsed() ? selection.anchor.getNode().getTopLevelElement() : null;
  if ($isParagraphNode(block) && block.isEmpty()) {
    block.replace(node);
  } else {
    $insertNodeToNearestRoot(node);
  }
  let next = node.getNextSibling();
  if (!next) {
    next = $createParagraphNode();
    node.insertAfter(next);
  }
  next.selectStart();
}

/** 파일들을 차례로 처리해 넣는다 — 이미지가 아닌 파일은 건너뛰고, 실패는 onError 로 */
export async function insertImageFiles(editor: LexicalEditor, files: File[], onError: (error: Error) => void): Promise<void> {
  for (const file of files) {
    try {
      const image = await processImageFile(file);
      editor.dispatchCommand(INSERT_IMAGE_COMMAND, { ...image, alt: altFromFileName(file.name) });
    } catch (e) {
      onError(e instanceof Error ? e : new Error("이미지를 넣지 못했어요"));
    }
  }
}

/** 숨은 <input type=file> 로 이미지를 고른다 — 쓸 때 만들고 끝나면 치운다 */
export function pickImageFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    document.querySelectorAll("input.lex-image-picker").forEach((el) => el.remove());
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.className = "lex-image-picker";
    input.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;";
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => done(Array.from(input.files ?? [])), { once: true });
    input.addEventListener("cancel", () => done([]), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

function imageFilesOf(files: File[]): File[] {
  return files.filter(isImageFile);
}

/** 놓은 자리의 DOM 위치 */
function domPointFromXY(x: number, y: number): Node | null {
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null };
  if (typeof doc.caretPositionFromPoint === "function") return doc.caretPositionFromPoint(x, y)?.offsetNode ?? null;
  if (typeof document.caretRangeFromPoint === "function") return document.caretRangeFromPoint(x, y)?.startContainer ?? null;
  return document.elementFromPoint(x, y);
}

/** 놓은 자리의 블록 뒤로 선택을 옮긴다 — 이미지는 그 뒤에 들어간다 */
function $selectDropBlock(event: DragEvent, root: HTMLElement | null) {
  const target = domPointFromXY(event.clientX, event.clientY);
  if (!target || !root?.contains(target)) return;
  const node: LexicalNode | null = $getNearestNodeFromDOMNode(target);
  if (!node) return;
  const top = $isDecoratorNode(node) && !node.isInline() && $isRootOrShadowRoot(node.getParent()) ? node : node.getTopLevelElement();
  if ($isElementNode(top)) {
    top.selectEnd();
  } else if (top) {
    const selection = $createNodeSelection();
    selection.add(top.getKey());
    $setSelection(selection);
  }
}

/** 이미지 블록 — 붙여넣기 · 끌어 놓기 · 파일 고르기. 모두 기기 안에서 데이터 URL 로 처리한다 */
export const ImageExtension = defineExtension({
  name: "llmwiki/image",
  nodes: () => [ImageNode],
  config: safeCast<ImageExtensionConfig>({
    onError: (error) => console.warn("[image]", error.message),
  }),
  register(editor, config) {
    const onError = (error: Error) => config.onError(error);
    return mergeRegister(
      editor.registerCommand(
        INSERT_IMAGE_COMMAND,
        (payload) => {
          $insertImage(payload);
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        OPEN_IMAGE_PICKER_COMMAND,
        () => {
          void pickImageFiles().then((files) => insertImageFiles(editor, imageFilesOf(files), onError));
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          const [hasFiles, files, hasText] = eventFiles(event);
          const images = hasFiles ? imageFilesOf(files) : [];
          if (images.length === 0) return false;
          // 표 · 문서를 복사하면 글과 함께 그림이 오기도 한다 — 글이 있으면 글 붙여넣기에 맡긴다
          if (hasText && "clipboardData" in event && event.clipboardData?.getData("text/plain").trim()) return false;
          event.preventDefault();
          void insertImageFiles(editor, images, onError);
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        DRAGOVER_COMMAND,
        (event) => {
          const items = Array.from(event.dataTransfer?.items ?? []);
          if (!items.some((item) => item.kind === "file" && (item.type.startsWith("image/") || item.type === ""))) return false;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        DROP_COMMAND,
        (event) => {
          const [, files] = eventFiles(event);
          const images = imageFilesOf(files);
          if (images.length === 0) return false;
          event.preventDefault();
          $selectDropBlock(event, editor.getRootElement());
          void insertImageFiles(editor, images, onError);
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  },
});
