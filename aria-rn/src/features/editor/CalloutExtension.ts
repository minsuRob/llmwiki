import "./blocks-extra.css";

import {
  $applyNodeReplacement,
  $createParagraphNode,
  $findMatchingParent,
  $getDocument,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  addClassNamesToElement,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW,
  createCommand,
  defineExtension,
  ElementNode,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  mergeRegister,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalCommand,
  type LexicalNode,
  type LexicalParseJSON,
  type NodeKey,
  type SerializedElementNode,
  type Spread,
} from "lexical";

import { $isPointAtEnd, $isPointAtStart, $wrapInlineChildren, registerTapZone } from "./nestedBlocks";

/** 이모지를 누르면 이 순서로 돈다 */
export const CALLOUT_EMOJIS = ["💡", "📌", "⚠️", "✅", "❗", "ℹ️"] as const;
const DEFAULT_EMOJI = CALLOUT_EMOJIS[0];

/** 이모지를 누를 수 있는 자리(px) — blocks-extra.css 의 왼쪽 여백 · 위 여백과 맞춘다 */
const EMOJI_ZONE = { x: 44, y: 44 };

export type SerializedCalloutNode = Spread<{ emoji: string }, SerializedElementNode>;

/** 콜아웃 — 회색 둥근 상자 + 왼쪽 이모지(CSS ::before 가 data-emoji 로 그린다). 블록을 담는 그림자 루트 */
export class CalloutNode extends ElementNode {
  __emoji: string;

  static getType(): string {
    return "callout";
  }

  static clone(node: CalloutNode): CalloutNode {
    return new CalloutNode(node.__emoji, node.__key);
  }

  static importJSON(serializedNode: LexicalParseJSON<SerializedCalloutNode>): CalloutNode {
    return $createCalloutNode().updateFromJSON(serializedNode);
  }

  static importDOM(): DOMConversionMap | null {
    return {
      aside: (el: HTMLElement) => (el.hasAttribute("data-lex-callout") ? { conversion: $convertCalloutElement, priority: 2 } : null),
    };
  }

  constructor(emoji: string = DEFAULT_EMOJI, key?: NodeKey) {
    super(key);
    this.__emoji = emoji;
  }

  updateFromJSON(serializedNode: LexicalParseJSON<SerializedCalloutNode>): this {
    const emoji = typeof serializedNode.emoji === "string" && serializedNode.emoji ? serializedNode.emoji : DEFAULT_EMOJI;
    return super.updateFromJSON(serializedNode).setEmoji(emoji);
  }

  exportJSON(): SerializedCalloutNode {
    return { ...super.exportJSON(), type: "callout", emoji: this.getEmoji() };
  }

  exportDOM(): DOMExportOutput {
    const aside = $getDocument().createElement("aside");
    aside.setAttribute("data-lex-callout", "");
    aside.setAttribute("data-emoji", this.getEmoji());
    return { element: aside };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const div = $getDocument().createElement("div");
    addClassNamesToElement(div, "lex-callout", config.theme.callout);
    div.setAttribute("data-emoji", this.__emoji);
    return div;
  }

  updateDOM(prevNode: this, dom: HTMLElement): boolean {
    if (prevNode.__emoji !== this.__emoji) dom.setAttribute("data-emoji", this.__emoji);
    return false;
  }

  getEmoji(): string {
    return this.getLatest().__emoji;
  }

  setEmoji(emoji: string): this {
    const self = this.getWritable();
    self.__emoji = emoji;
    return self;
  }

  /** 다음 이모지로 */
  cycleEmoji(): this {
    const list: readonly string[] = CALLOUT_EMOJIS;
    const i = list.indexOf(this.getEmoji());
    return this.setEmoji(list[(i + 1) % list.length] ?? DEFAULT_EMOJI);
  }

  isShadowRoot(): true {
    return true;
  }

  canIndent(): false {
    return false;
  }

  /** 첫 블록 맨 앞에서 Backspace — 상자를 풀고 블록들은 제자리에 */
  collapseAtStart(): boolean {
    $unwrapCallout(this);
    return true;
  }
}

function $convertCalloutElement(el: HTMLElement): DOMConversionOutput {
  return { node: $createCalloutNode(el.getAttribute("data-emoji") || DEFAULT_EMOJI) };
}

export function $createCalloutNode(emoji: string = DEFAULT_EMOJI): CalloutNode {
  return $applyNodeReplacement(new CalloutNode(emoji));
}

export function $isCalloutNode(node: LexicalNode | null | undefined): node is CalloutNode {
  return node instanceof CalloutNode;
}

/** 콜아웃을 풀어 담긴 블록을 그 자리에 둔다. 커서는 첫 블록 맨 앞 */
export function $unwrapCallout(callout: CalloutNode): void {
  const children = callout.getChildren();
  for (const child of children) callout.insertBefore(child);
  callout.remove();
  children[0]?.selectStart();
}

/** 커서가 든 블록 — 루트(또는 그림자 루트) 바로 아래 */
function $topBlockOf(node: LexicalNode): LexicalNode | null {
  return $findMatchingParent(node, (n) => !$isRootOrShadowRoot(n) && $isRootOrShadowRoot(n.getParent()));
}

/** 커서가 있는 블록을 콜아웃으로 감싼다(편집기 update 안에서). 이미 콜아웃 바로 안이면 하지 않는다 */
export function $insertCallout(emoji: string = DEFAULT_EMOJI): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  const block = $topBlockOf(selection.anchor.getNode());
  const callout = $createCalloutNode(emoji);
  if (!block) {
    const paragraph = $createParagraphNode();
    callout.append(paragraph);
    selection.insertNodes([callout]);
    paragraph.select();
    return true;
  }
  if ($isCalloutNode(block.getParent())) return false;
  block.insertBefore(callout);
  callout.append(block);
  return true;
}

/** Enter — 콜아웃의 마지막 빈 문단이면(블록이 둘 이상일 때) 상자 밖으로 */
function $onInsertParagraph(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const anchor = selection.anchor.getNode();
  const callout = anchor.getParent();
  if (!$isParagraphNode(anchor) || !anchor.isEmpty() || anchor.getNextSibling() || !$isCalloutNode(callout)) return false;
  if (callout.getChildrenSize() < 2) return false;
  callout.insertAfter(anchor);
  anchor.select();
  return true;
}

/** ↑ · ↓ — 문서 맨 앞 · 맨 끝 콜아웃이면 바깥에 빈 문단을 만든다(나갈 자리) */
function $onArrow(event: KeyboardEvent, down: boolean): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed() || event.shiftKey) return false;
  const found = $findMatchingParent(selection.anchor.getNode(), $isCalloutNode);
  if (!$isCalloutNode(found)) return false;
  const callout: CalloutNode = found;
  if (down ? callout.getNextSibling() || !$isPointAtEnd(selection.anchor, callout) : callout.getPreviousSibling() || !$isPointAtStart(selection.anchor, callout)) {
    return false;
  }
  event.preventDefault();
  const paragraph = $createParagraphNode();
  if (down) callout.insertAfter(paragraph);
  else callout.insertBefore(paragraph);
  paragraph.select();
  return true;
}

/** 콜아웃은 블록만 · 비지 않게 */
function $normalizeCallout(callout: CalloutNode): void {
  $wrapInlineChildren(callout);
  if (callout.isEmpty()) callout.append($createParagraphNode());
}

/** 커서가 있는 블록을 콜아웃으로 감싼다. 값을 주면 그 이모지로 */
export const INSERT_CALLOUT_COMMAND: LexicalCommand<string | void> = createCommand("INSERT_CALLOUT_COMMAND");

/** 콜아웃 블록 — 이모지를 누르면 다음 이모지로 바뀐다 */
export const CalloutExtension = defineExtension({
  name: "llmwiki/callout",
  nodes: () => [CalloutNode],
  register(editor) {
    return mergeRegister(
      editor.registerNodeTransform(CalloutNode, $normalizeCallout),
      editor.registerCommand(INSERT_CALLOUT_COMMAND, (emoji) => $insertCallout(emoji || DEFAULT_EMOJI), COMMAND_PRIORITY_EDITOR),
      editor.registerCommand(INSERT_PARAGRAPH_COMMAND, $onInsertParagraph, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_ARROW_DOWN_COMMAND, (e) => $onArrow(e, true), COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_ARROW_UP_COMMAND, (e) => $onArrow(e, false), COMMAND_PRIORITY_LOW),
      registerTapZone(editor, {
        selector: ".lex-callout",
        hit: (x, y) => x >= 0 && x < EMOJI_ZONE.x && y < EMOJI_ZONE.y,
        $onTap: (node) => {
          const callout = $findMatchingParent(node, $isCalloutNode);
          if ($isCalloutNode(callout)) callout.cycleEmoji();
        },
      }),
    );
  },
});
