import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  createCommand,
  KEY_DOWN_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalCommand,
  type LexicalNode,
  type NodeKey,
} from "lexical";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { $collectRows, bottomOf, descendants, type Row } from "./blockRows";
import { isCombo, isModifiers } from "./keys";
import { $outlineBlockOf, $outlineDuplicate, $outlineDuplicateRange, $outlineMove, $outlineRemove, $outlineShift } from "./outline";
import { $isToggleContainerNode } from "./ToggleNodes";

/*
 * 블록 선택(Notion 실측) — 블록을 글이 아니라 통째로 고른 상태. 둥근 배경으로 칠하고 커서는 감춘다.
 * 들어오기: 글 속에서 Esc · Cmd+D(복제본이 골라진다) · 손잡이(⠿) 누르기
 * 고른 동안: ↑↓ 옆 블록으로 · Shift+↑↓ 넓히기 · Enter 그 블록 끝으로 편집 · Esc 풀기 · Backspace/Delete 지우기(자식 함께)
 * · Cmd+D 복제(복제본을 고른다) · Tab/Shift+Tab 들이고 내어 쓰기 · Cmd+Shift+↑↓ 옮기기 — 그 밖의 키 · 누르기는 선택을 푼다.
 * 커서는 늘 고른 끝 블록 끝에 두어(감춘 채) 편집기 초점 · 블록 바꾸기 단축키(커서 블록에 건다)가 그대로 돈다
 */

/** 블록들을 고른다(키는 문서 순서) — Cmd+D · 손잡이 누르기 */
export const SELECT_BLOCKS_COMMAND: LexicalCommand<NodeKey[]> = createCommand("SELECT_BLOCKS_COMMAND");

interface Picked {
  anchor: NodeKey;
  focus: NodeKey;
}

/** 칠할 상자 — 스크롤 영역(.lex-inner) 안 좌표 */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 고른 범위의 맨 위 블록들(앞 블록의 자손은 빼고) */
function topsOf(rows: Row[], picked: Picked): Row[] {
  const a = rows.findIndex((r) => r.key === picked.anchor);
  const f = rows.findIndex((r) => r.key === picked.focus);
  if (a < 0 || f < 0) return [];
  const [from, to] = a <= f ? [a, f] : [f, a];
  const tops: Row[] = [];
  const covered = new Set<NodeKey>();
  for (let i = from; i <= to; i += 1) {
    if (covered.has(rows[i].key)) continue;
    tops.push(rows[i]);
    for (const d of descendants(rows, i)) covered.add(d.key);
  }
  return tops;
}

/** 블록 끝에 커서(감춘 채) — 토글은 제목 끝 */
function $caretTo(node: LexicalNode | null) {
  if ($isToggleContainerNode(node)) node.getTitle()?.selectEnd();
  else if ($isElementNode(node)) node.selectEnd();
}

export default function BlockSelectionPlugin() {
  const [editor] = useLexicalComposerContext();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const pickedRef = useRef<Picked | null>(null);

  useEffect(() => editor.registerRootListener((root) => setAnchorEl(root?.parentElement ?? null)), [editor]);

  const pick = useCallback((next: Picked | null) => {
    pickedRef.current = next;
    setPicked(next);
  }, []);

  // 칠하기 — 고른 블록마다(자식 포함) 둥근 상자 하나
  const measure = useCallback(() => {
    const cur = pickedRef.current;
    const root = editor.getRootElement();
    if (!cur || !anchorEl || !root) {
      setBoxes([]);
      return;
    }
    const rows = editor.read(() => $collectRows(editor));
    const tops = topsOf(rows, cur);
    if (tops.length === 0) {
      pick(null);
      setBoxes([]);
      return;
    }
    const view = anchorEl.getBoundingClientRect();
    const right = root.getBoundingClientRect().right - parseFloat(getComputedStyle(root).paddingRight);
    setBoxes(
      tops.map((top) => {
        const block = descendants(rows, rows.indexOf(top));
        const y0 = Math.min(...block.map((r) => r.top));
        const y1 = Math.max(...block.map(bottomOf));
        const left = top.left - 4;
        return { x: left - view.left + anchorEl.scrollLeft, y: y0 - view.top + anchorEl.scrollTop, w: right - left + 4, h: y1 - y0 };
      }),
    );
  }, [anchorEl, editor, pick]);

  useLayoutEffect(() => {
    measure();
    const root = anchorEl?.closest(".lex-root");
    root?.classList.toggle("lex-blocksel", picked !== null);
  }, [picked, measure, anchorEl]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  useEffect(() => {
    /** 고른 맨 위 블록 노드들(문서 순서) */
    const $tops = (): LexicalNode[] => {
      const cur = pickedRef.current;
      if (!cur) return [];
      return topsOf($collectRows(editor), cur)
        .map((r) => $getNodeByKey(r.key))
        .filter((n): n is LexicalNode => n !== null);
    };
    const $select = (keys: NodeKey[]) => {
      if (keys.length === 0) return pick(null);
      pick({ anchor: keys[0], focus: keys[keys.length - 1] });
      $caretTo($getNodeByKey(keys[keys.length - 1]));
    };

    return mergeRegister(
      editor.registerCommand(
        SELECT_BLOCKS_COMMAND,
        (keys) => {
          $select(keys);
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      // 글 속 Esc → 커서 블록을 고른다. 블록 메뉴(/) · 서식 막대 칸이 열려 있으면 그쪽이 먼저 닫는다
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          if (pickedRef.current) return false;
          const root = editor.getRootElement()?.closest(".lex-root");
          if (root?.querySelector(".lex-slash, .lex-ft-panel")) return false;
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          const block = $outlineBlockOf(selection.focus.getNode());
          if (!block) return false;
          event.preventDefault();
          $select([block.getKey()]);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (e) => {
          const cur = pickedRef.current;
          if (!cur || e.isComposing) return false;
          // 보조키만 누른 것은 그대로 둔다(Shift 를 누르고 ↑↓ 하려는 중)
          if (["Shift", "Meta", "Control", "Alt", "CapsLock"].includes(e.key)) return false;
          const done = () => {
            e.preventDefault();
            return true;
          };
          const rows = $collectRows(editor);
          const tops = topsOf(rows, cur);
          if (tops.length === 0) {
            pick(null);
            return false;
          }

          if (isCombo(e, "Escape")) {
            pick(null);
            return done();
          }
          // ↑↓ 옆 블록 · Shift+↑↓ 넓히기
          const up = isCombo(e, "ArrowUp") || isCombo(e, "ArrowUp", { shift: true });
          const down = isCombo(e, "ArrowDown") || isCombo(e, "ArrowDown", { shift: true });
          if (up || down) {
            const i = rows.findIndex((r) => r.key === cur.focus);
            const next = rows[Math.max(0, Math.min(rows.length - 1, i + (up ? -1 : 1)))];
            if (e.shiftKey) pick({ anchor: cur.anchor, focus: next.key });
            else pick({ anchor: next.key, focus: next.key });
            $caretTo($getNodeByKey(next.key));
            return done();
          }
          if (isCombo(e, "Enter")) {
            pick(null);
            $caretTo($getNodeByKey(cur.focus));
            return done();
          }
          if (isCombo(e, "Backspace") || isCombo(e, "Delete")) {
            const first = rows.indexOf(tops[0]);
            const last = descendants(rows, rows.indexOf(tops[tops.length - 1])).at(-1);
            const before = rows[first - 1]?.key;
            const after = last ? rows[rows.indexOf(last) + 1]?.key : undefined;
            for (const node of [...$tops()].reverse()) $outlineRemove(node);
            pick(null);
            const land = (before && $getNodeByKey(before)) || (after && $getNodeByKey(after)) || null;
            $caretTo(land);
            return done();
          }
          if (isCombo(e, "KeyD", { mod: true })) {
            // 고른 묶음 전체를 마지막 블록 뒤에 한 번에(Notion) — 범위가 다르면 블록마다 바로 뒤에
            const nodes = $tops();
            let copies = nodes.length > 1 ? $outlineDuplicateRange(nodes[0], nodes[nodes.length - 1]) : null;
            if (!copies) {
              copies = [];
              for (const node of [...nodes].reverse()) {
                const copy = $outlineDuplicate(node);
                if (copy) copies.unshift(copy);
              }
            }
            $select(copies.map((n) => n.getKey()));
            return done();
          }
          if (isCombo(e, "Tab") || isCombo(e, "Tab", { shift: true })) {
            const nodes = $tops();
            if (nodes.length > 0) $outlineShift(nodes[0], e.shiftKey, nodes[nodes.length - 1]);
            $caretTo($getNodeByKey(cur.focus));
            return done();
          }
          const moveUp = isCombo(e, "ArrowUp", { mod: true, shift: true });
          if (moveUp || isCombo(e, "ArrowDown", { mod: true, shift: true })) {
            const nodes = $tops();
            if (nodes.length === 1) $outlineMove(nodes[0], moveUp ? -1 : 1);
            $caretTo($getNodeByKey(cur.focus));
            return done();
          }
          // 다른 단축키(블록 바꾸기 · Cmd+Enter 등)는 커서 블록에 걸리게 넘긴다. 글자를 치면 선택을 풀고 넘긴다
          if (!isModifiers(e, {}) && !isModifiers(e, { shift: true })) return false;
          pick(null);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      // 고친 뒤 다시 칠한다 — 고른 블록이 사라졌으면 푼다
      editor.registerUpdateListener(() => {
        if (pickedRef.current) measure();
      }),
    );
  }, [editor, pick, measure]);

  // 누르면 선택을 푼다(손잡이 누르기는 떼고 나서 다시 고른다)
  useEffect(() => {
    if (!picked) return;
    const onDown = () => pick(null);
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [picked, pick]);

  if (!anchorEl || boxes.length === 0) return null;
  return createPortal(
    <>
      {boxes.map((b, i) => (
        <div key={i} className="lex-block-picked" style={{ transform: `translate(${b.x}px, ${b.y}px)`, width: b.w, height: b.h }} />
      ))}
    </>,
    anchorEl,
  );
}
