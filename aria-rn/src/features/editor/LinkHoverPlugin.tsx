import "./link-hover.css";

import { $createLinkNode, $isAutoLinkNode, $isLinkNode, type LinkNode } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $findMatchingParent } from "@lexical/utils";
import { $createTextNode, $getNearestNodeFromDOMNode, $getNodeByKey, $isTextNode, type NodeKey } from "lexical";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { normalizeLinkUrl } from "./FloatingToolbarPlugin";

/*
 * 링크 창(Notion 실측) — 글 속 링크에 마우스를 올리면 링크 바로 아래에 "🌐 주소 · 복사 · 편집" 창이 뜬다.
 * 주소를 누르면 새 탭으로 열고, 복사는 주소를 클립보드에, 편집은 "페이지 또는 URL" · "링크 제목" · "링크 제거" 창으로 바꾼다.
 * 편집 창은 열리면 제목 칸에 초점, Enter · Esc · 바깥 누르기로 닫으며 고친 값을 넣는다(쓸 수 없는 주소면 닫지 않고 알린다).
 * 링크 글자를 그냥 누르면(끌어 고르기가 아니면) 링크를 새 탭으로 연다(Notion) — 글을 고치려면 편집 창으로.
 * 마우스가 있는 화면만(손잡이와 같이)
 */

/** 링크 위에 이만큼 머물면 창을 띄운다 · 벗어나고 이만큼 지나면 닫는다(창으로 옮겨 갈 틈) */
const SHOW_DELAY = 350;
const HIDE_DELAY = 250;
/** 링크와 창 사이 */
const GAP = 6;

interface Hover {
  key: NodeKey;
  url: string;
  title: string;
  /** 스크롤 영역(.lex-inner) 안 좌표 */
  x: number;
  y: number;
}

/** DOM 링크 요소 → 링크 노드 */
function $linkOf(el: HTMLElement): LinkNode | null {
  const node = $getNearestNodeFromDOMNode(el);
  const link = node ? $findMatchingParent(node, $isLinkNode) : null;
  return $isLinkNode(link) ? link : null;
}

/** 링크를 새 탭으로 — 쓸 수 있는 주소만 */
function openUrl(url: string) {
  const safe = normalizeLinkUrl(url);
  if (safe) window.open(safe, "_blank", "noopener,noreferrer");
}

const GlobeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.2">
    <circle cx="8" cy="8" r="6.2" />
    <path d="M1.8 8h12.4M8 1.8c1.8 1.9 2.6 3.9 2.6 6.2S9.8 12.3 8 14.2M8 1.8C6.2 3.7 5.4 5.7 5.4 8s.8 4.3 2.6 6.2" />
  </svg>
);

const CopyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
    <rect x="5.5" y="5" width="7.5" height="9" rx="1.5" />
    <path d="M10.5 5V3.5A1.5 1.5 0 0 0 9 2H4.5A1.5 1.5 0 0 0 3 3.5v6A1.5 1.5 0 0 0 4.5 11h1" />
  </svg>
);

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
  </svg>
);

const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 4.5h11M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6M6.7 7v4.5M9.3 7v4.5" />
  </svg>
);

export default function LinkHoverPlugin() {
  const [editor] = useLexicalComposerContext();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [urlError, setUrlError] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 지금 창이 붙은 링크 요소 */
  const linkEl = useRef<HTMLElement | null>(null);
  /** 창을 띄우려고 기다리는 링크 요소 */
  const pending = useRef<HTMLElement | null>(null);
  const editingRef = useRef(false);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  useEffect(() => editor.registerRootListener((root) => setAnchor(root?.parentElement ?? null)), [editor]);

  const clearTimers = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    showTimer.current = null;
    hideTimer.current = null;
    pending.current = null;
  };

  const close = useCallback(() => {
    clearTimers();
    linkEl.current?.classList.remove("lex-link-editing");
    linkEl.current = null;
    setHover(null);
    setEditing(false);
    setCopied(false);
    setUrlError(false);
  }, []);

  /** 링크 요소 아래에 창 — 스크롤 영역 안 좌표로(글과 같이 스크롤된다) */
  const open = useCallback(
    (el: HTMLElement) => {
      if (!anchor) return;
      const found = editor.read(() => {
        const link = $linkOf(el);
        return link ? { key: link.getKey(), url: link.getURL(), title: link.getTextContent() } : null;
      });
      if (!found) return;
      // 여러 줄로 꺾인 링크는 첫 줄 아래에
      const r = el.getClientRects()[0] ?? el.getBoundingClientRect();
      const box = anchor.getBoundingClientRect();
      linkEl.current = el;
      setCopied(false);
      setEditing(false);
      setHover({ ...found, x: r.left - box.left + anchor.scrollLeft, y: r.bottom - box.top + anchor.scrollTop + GAP });
    },
    [anchor, editor],
  );

  // ── 링크 위에 머물면 띄우고, 링크 · 창 밖으로 나가면 닫는다(편집 중이면 그대로)
  useEffect(() => {
    if (!anchor) return;
    const input = editor.getRootElement();
    if (!input) return;
    const linkAt = (target: EventTarget | null) => {
      const a = target instanceof HTMLElement ? target.closest<HTMLElement>("a") : null;
      return a && input.contains(a) ? a : null;
    };
    const mouse = () => matchMedia("(hover: hover) and (pointer: fine)").matches;
    const onMove = (event: MouseEvent) => {
      if (editingRef.current || !mouse()) return;
      if (boxRef.current?.contains(event.target as Node)) {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = null;
        return;
      }
      const a = linkAt(event.target);
      if (a) {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = null;
        if (a === linkEl.current || (showTimer.current && a === pending.current)) return;
        if (showTimer.current) clearTimeout(showTimer.current);
        pending.current = a;
        showTimer.current = setTimeout(() => {
          showTimer.current = null;
          pending.current = null;
          open(a);
        }, SHOW_DELAY);
        return;
      }
      if (showTimer.current) {
        clearTimeout(showTimer.current);
        showTimer.current = null;
        pending.current = null;
      }
      if (linkEl.current && !hideTimer.current) hideTimer.current = setTimeout(close, HIDE_DELAY);
    };
    // 링크를 그냥 누르면 새 탭으로(Notion) — 끌어 고른 뒤 떼거나 보조키를 누른 채면 Lexical 에 맡긴다
    let down: { x: number; y: number } | null = null;
    const onDown = (event: MouseEvent) => {
      down = event.button === 0 && mouse() && linkAt(event.target) ? { x: event.clientX, y: event.clientY } : null;
    };
    const onClick = (event: MouseEvent) => {
      const a = linkAt(event.target);
      const start = down;
      down = null;
      if (!a || !start || event.shiftKey || event.altKey) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 3) return;
      if (!(window.getSelection()?.isCollapsed ?? true)) return;
      const href = editor.read(() => $linkOf(a)?.getURL() ?? null);
      if (!href) return;
      event.preventDefault();
      openUrl(href);
    };
    const onKey = () => {
      if (!editingRef.current) close();
    };
    anchor.addEventListener("mousemove", onMove);
    anchor.addEventListener("mouseleave", onMove);
    input.addEventListener("mousedown", onDown);
    input.addEventListener("click", onClick);
    input.addEventListener("keydown", onKey);
    return () => {
      anchor.removeEventListener("mousemove", onMove);
      anchor.removeEventListener("mouseleave", onMove);
      input.removeEventListener("mousedown", onDown);
      input.removeEventListener("click", onClick);
      input.removeEventListener("keydown", onKey);
      clearTimers();
    };
  }, [anchor, editor, open, close]);

  // 링크가 지워지거나 글이 바뀌면 창을 닫는다(편집 중 제외)
  useEffect(
    () =>
      editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
        if (editingRef.current || (dirtyElements.size === 0 && dirtyLeaves.size === 0)) return;
        if (linkEl.current && !linkEl.current.isConnected) close();
      }),
    [editor, close],
  );

  /** 편집 창 값 넣기 — 주소가 쓸 수 없으면 false(창을 닫지 않는다) */
  const apply = useCallback((): boolean => {
    if (!hover) return true;
    const next = normalizeLinkUrl(url);
    if (next === false) {
      setUrlError(true);
      return false;
    }
    const text = title.trim();
    editor.update(() => {
      const found = $getNodeByKey(hover.key);
      if (!$isLinkNode(found)) return;
      let link: LinkNode = found;
      // 주소를 비우면 링크를 푼다(Notion)
      if (next === null) {
        for (const child of link.getChildren()) link.insertBefore(child);
        link.remove();
        return;
      }
      const retitle = text !== "" && text !== link.getTextContent();
      // 자동 링크는 글이 주소 꼴이 아니면 풀리고 주소도 글을 따라가니, 고치면 보통 링크로 바꾼다
      if ($isAutoLinkNode(link) && (retitle || next !== link.getURL())) {
        const plain = $createLinkNode(next, { rel: link.getRel(), target: link.getTarget(), title: link.getTitle() });
        plain.append(...link.getChildren());
        link.replace(plain);
        link = plain;
      }
      if (next !== link.getURL()) link.setURL(next);
      if (retitle) {
        // 첫 글자 조각의 서식은 살리고 글만 바꾼다
        const first = link.getChildren().find($isTextNode);
        for (const child of link.getChildren()) if (child !== first) child.remove();
        if (first) first.setTextContent(text);
        else link.append($createTextNode(text));
      }
    });
    return true;
  }, [editor, hover, title, url]);

  const finishEdit = useCallback(() => {
    if (apply()) {
      close();
      editor.focus();
    }
  }, [apply, close, editor]);

  // 편집 중 바깥을 누르면 넣고 닫는다
  useEffect(() => {
    if (!editing) return;
    const onDown = (event: MouseEvent) => {
      if (boxRef.current?.contains(event.target as Node)) return;
      if (apply()) close();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [editing, apply, close]);

  const startEdit = () => {
    if (!hover) return;
    clearTimers();
    setUrl(hover.url);
    setTitle(hover.title);
    setUrlError(false);
    setEditing(true);
    linkEl.current?.classList.add("lex-link-editing");
    requestAnimationFrame(() => titleRef.current?.select());
  };

  const copy = () => {
    if (!hover) return;
    void navigator.clipboard?.writeText(hover.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const removeLink = () => {
    if (!hover) return;
    editor.update(() => {
      const link = $getNodeByKey(hover.key);
      if (!$isLinkNode(link)) return;
      for (const child of link.getChildren()) link.insertBefore(child);
      link.remove();
    });
    close();
    editor.focus();
  };

  const onFieldKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      finishEdit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      finishEdit();
    }
  };

  if (!anchor || !hover) return null;
  // 창이 편집기 오른쪽 밖으로 나가지 않게
  const maxLeft = Math.max(0, anchor.clientWidth - (editing ? 340 : 360) - 8);
  const style = { transform: `translate(${Math.min(hover.x, maxLeft)}px, ${hover.y}px)` };
  return createPortal(
    <div
      ref={boxRef}
      className={"lex-linkpop" + (editing ? " editing" : "")}
      style={style}
      onMouseDown={(e) => {
        // 보기 창의 단추는 편집기 초점을 뺏지 않는다
        if (!editing) e.preventDefault();
      }}
    >
      {editing ? (
        <div className="lex-linkpop-form" role="dialog" aria-label="링크 편집">
          <label className="lex-linkpop-label" htmlFor="lex-linkpop-url">
            페이지 또는 URL
          </label>
          <input
            id="lex-linkpop-url"
            className={"lex-linkpop-input" + (urlError ? " error" : "")}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setUrlError(false);
            }}
            onKeyDown={onFieldKey}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={urlError}
          />
          {urlError ? <div className="lex-linkpop-error">쓸 수 없는 주소예요</div> : null}
          <label className="lex-linkpop-label" htmlFor="lex-linkpop-title">
            링크 제목
          </label>
          <input id="lex-linkpop-title" ref={titleRef} className="lex-linkpop-input" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={onFieldKey} autoComplete="off" />
          <div className="lex-linkpop-sep" />
          <button type="button" className="lex-linkpop-row" onClick={removeLink}>
            <TrashIcon />
            <span>링크 제거</span>
          </button>
        </div>
      ) : (
        <div className="lex-linkpop-bar">
          <button type="button" className="lex-linkpop-url" onClick={() => openUrl(hover.url)} title={hover.url}>
            <GlobeIcon />
            <span>{hover.url}</span>
          </button>
          <button type="button" className="lex-linkpop-icon" onClick={copy} aria-label={copied ? "링크 복사됨" : "링크 복사"} title={copied ? "복사됨" : "링크 복사"}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
          <button type="button" className="lex-linkpop-text" onClick={startEdit}>
            편집
          </button>
        </div>
      )}
    </div>,
    anchor,
  );
}
