import "./blocks-extra.css";

import {
  $applyNodeReplacement,
  $createParagraphNode,
  $getDocument,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  addClassNamesToElement,
  ElementNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type LexicalParseJSON,
  type NodeKey,
  type ParagraphNode,
  type RangeSelection,
  type SerializedElementNode,
  type Spread,
} from "lexical";

/*
 * 토글 블록 — Notion 처럼 제목 한 줄 + 접고 펴는 내용.
 * 구조는 늘 container > [title, content]. 어긋나면 ToggleExtension 의 변환이 바로잡는다
 */

export type SerializedToggleContainerNode = Spread<{ open: boolean }, SerializedElementNode>;

/** 토글 묶음 — 열림 상태만 가진다(data-open 으로 CSS 가 내용을 숨긴다) */
export class ToggleContainerNode extends ElementNode {
  __open: boolean;

  static getType(): string {
    return "toggle-container";
  }

  static clone(node: ToggleContainerNode): ToggleContainerNode {
    return new ToggleContainerNode(node.__open, node.__key);
  }

  static importJSON(serializedNode: LexicalParseJSON<SerializedToggleContainerNode>): ToggleContainerNode {
    return $createToggleContainerNode().updateFromJSON(serializedNode);
  }

  static importDOM(): DOMConversionMap | null {
    return { details: () => ({ conversion: $convertDetailsElement, priority: 1 }) };
  }

  constructor(open = true, key?: NodeKey) {
    super(key);
    this.__open = open;
  }

  updateFromJSON(serializedNode: LexicalParseJSON<SerializedToggleContainerNode>): this {
    return super.updateFromJSON(serializedNode).setOpen(serializedNode.open !== false);
  }

  exportJSON(): SerializedToggleContainerNode {
    return { ...super.exportJSON(), type: "toggle-container", open: this.getOpen() };
  }

  exportDOM(): DOMExportOutput {
    const details = $getDocument().createElement("details");
    if (this.getOpen()) details.setAttribute("open", "");
    return { element: details };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const div = $getDocument().createElement("div");
    addClassNamesToElement(div, "lex-toggle", config.theme.toggle);
    div.setAttribute("data-open", String(this.__open));
    return div;
  }

  updateDOM(prevNode: this, dom: HTMLElement): boolean {
    if (prevNode.__open !== this.__open) dom.setAttribute("data-open", String(this.__open));
    return false;
  }

  getOpen(): boolean {
    return this.getLatest().__open;
  }

  setOpen(open: boolean): this {
    const self = this.getWritable();
    self.__open = open;
    return self;
  }

  /** 열고 닫기 — 닫을 때 커서가 내용 안에 있으면 제목 끝으로 옮긴다 */
  toggleOpen(): this {
    const open = !this.getOpen();
    const self = this.setOpen(open);
    if (!open) {
      const selection = $getSelection();
      const content = this.getContent();
      if (content && $isRangeSelection(selection) && (content.isParentOf(selection.anchor.getNode()) || content.isParentOf(selection.focus.getNode()))) {
        this.getTitle()?.selectEnd();
      }
    }
    return self;
  }

  getTitle(): ToggleTitleNode | null {
    const first = this.getFirstChild();
    return $isToggleTitleNode(first) ? first : null;
  }

  getContent(): ToggleContentNode | null {
    return this.getChildren().find($isToggleContentNode) ?? null;
  }

  isShadowRoot(): false {
    return false;
  }

  canIndent(): false {
    return false;
  }
}

/** 제목 줄 — 글(인라인)만 담는다. 왼쪽 ▸ 는 CSS 가 그린다(눌러 열고 닫기는 ToggleExtension) */
export class ToggleTitleNode extends ElementNode {
  static getType(): string {
    return "toggle-title";
  }

  static clone(node: ToggleTitleNode): ToggleTitleNode {
    return new ToggleTitleNode(node.__key);
  }

  static importJSON(serializedNode: LexicalParseJSON<SerializedElementNode>): ToggleTitleNode {
    return $createToggleTitleNode().updateFromJSON(serializedNode);
  }

  static importDOM(): DOMConversionMap | null {
    return { summary: () => ({ conversion: () => ({ node: $createToggleTitleNode() }), priority: 1 }) };
  }

  exportJSON(): SerializedElementNode {
    return { ...super.exportJSON(), type: "toggle-title" };
  }

  exportDOM(): DOMExportOutput {
    return { element: $getDocument().createElement("summary") };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const div = $getDocument().createElement("div");
    addClassNamesToElement(div, "lex-toggle-title", config.theme.toggleTitle);
    return div;
  }

  updateDOM(): false {
    return false;
  }

  canIndent(): false {
    return false;
  }

  /** Enter — 열려 있으면 내용 맨 앞에 새 문단, 닫혀 있으면 토글 뒤에 */
  insertNewAfter(_selection: RangeSelection, restoreSelection = true): ParagraphNode {
    const paragraph = $createParagraphNode();
    const container = this.getParent();
    const content = $isToggleContainerNode(container) ? container.getContent() : null;
    if ($isToggleContainerNode(container) && container.getOpen() && content) {
      const first = content.getFirstChild();
      // 맨 앞이 빈 문단이면(새 토글의 자리) 그리로 들어간다
      if ($isParagraphNode(first) && first.isEmpty()) return first;
      if (first) first.insertBefore(paragraph, restoreSelection);
      else content.append(paragraph);
    } else if (container) {
      container.insertAfter(paragraph, restoreSelection);
    } else {
      this.insertAfter(paragraph, restoreSelection);
    }
    return paragraph;
  }

  /** 제목 맨 앞에서 Backspace — 토글을 풀어 문단들로 */
  collapseAtStart(): boolean {
    const container = this.getParent();
    if (!$isToggleContainerNode(container)) return false;
    $unwrapToggle(container);
    return true;
  }
}

/** 접히는 내용 — 블록들을 담는 그림자 루트(목록 · 이미지 넣기가 여기서 끝난다) */
export class ToggleContentNode extends ElementNode {
  static getType(): string {
    return "toggle-content";
  }

  static clone(node: ToggleContentNode): ToggleContentNode {
    return new ToggleContentNode(node.__key);
  }

  static importJSON(serializedNode: LexicalParseJSON<SerializedElementNode>): ToggleContentNode {
    return $createToggleContentNode().updateFromJSON(serializedNode);
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (el: HTMLElement) => (el.hasAttribute("data-lex-toggle-content") ? { conversion: () => ({ node: $createToggleContentNode() }), priority: 2 } : null),
    };
  }

  exportJSON(): SerializedElementNode {
    return { ...super.exportJSON(), type: "toggle-content" };
  }

  exportDOM(): DOMExportOutput {
    const div = $getDocument().createElement("div");
    div.setAttribute("data-lex-toggle-content", "");
    return { element: div };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const div = $getDocument().createElement("div");
    addClassNamesToElement(div, "lex-toggle-content", config.theme.toggleContent);
    return div;
  }

  updateDOM(): false {
    return false;
  }

  isShadowRoot(): true {
    return true;
  }

  canIndent(): false {
    return false;
  }

  /** 내용 첫 블록 맨 앞에서 Backspace — 빈 블록은 지우고, 글이 있으면 제목 끝에 붙인다 */
  collapseAtStart(): boolean {
    const container = this.getParent();
    const title = $isToggleContainerNode(container) ? container.getTitle() : null;
    const first = this.getFirstChild();
    if (!title || !$isElementNode(first) || first.isInline()) return false;
    const children = first.getChildren();
    if (children.some((c) => $isElementNode(c) && !c.isInline())) return false;
    title.selectEnd();
    title.append(...children);
    first.remove();
    if (this.isEmpty()) this.append($createParagraphNode());
    return true;
  }
}

function $convertDetailsElement(el: HTMLElement): DOMConversionOutput {
  return { node: $createToggleContainerNode(el.hasAttribute("open")) };
}

export function $createToggleContainerNode(open = true): ToggleContainerNode {
  return $applyNodeReplacement(new ToggleContainerNode(open));
}

export function $createToggleTitleNode(): ToggleTitleNode {
  return $applyNodeReplacement(new ToggleTitleNode());
}

export function $createToggleContentNode(): ToggleContentNode {
  return $applyNodeReplacement(new ToggleContentNode());
}

/** 제목 · 빈 문단 하나짜리 내용을 갖춘 토글 */
export function $createToggle(open = true): ToggleContainerNode {
  return $createToggleContainerNode(open).append($createToggleTitleNode(), $createToggleContentNode().append($createParagraphNode()));
}

export function $isToggleContainerNode(node: LexicalNode | null | undefined): node is ToggleContainerNode {
  return node instanceof ToggleContainerNode;
}

export function $isToggleTitleNode(node: LexicalNode | null | undefined): node is ToggleTitleNode {
  return node instanceof ToggleTitleNode;
}

export function $isToggleContentNode(node: LexicalNode | null | undefined): node is ToggleContentNode {
  return node instanceof ToggleContentNode;
}

/** 토글을 푼다 — 제목은 문단으로, 내용 블록은 그 아래로. 커서는 제목이던 문단 맨 앞 */
export function $unwrapToggle(container: ToggleContainerNode): ParagraphNode | null {
  let anchor: LexicalNode = container;
  let titleParagraph: ParagraphNode | null = null;
  for (const child of container.getChildren()) {
    if ($isToggleTitleNode(child)) {
      titleParagraph = $createParagraphNode();
      titleParagraph.append(...child.getChildren());
      anchor.insertAfter(titleParagraph);
      anchor = titleParagraph;
    } else if ($isToggleContentNode(child)) {
      // 빈 문단 하나뿐인 내용은 버린다 — 풀고 나서 빈 줄이 남지 않게
      const only = child.getChildrenSize() === 1 ? child.getFirstChild() : null;
      if ($isParagraphNode(only) && only.isEmpty()) continue;
      for (const block of child.getChildren()) {
        anchor.insertAfter(block);
        anchor = block;
      }
    } else {
      anchor.insertAfter(child);
      anchor = child;
    }
  }
  container.remove();
  titleParagraph?.selectStart();
  return titleParagraph;
}
