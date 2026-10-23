import { IS_APPLE } from "lexical";

/*
 * 단축키 — Mac 과 Windows · Linux 를 한 곳에서. Notion 과 같은 조합:
 * - mod: Mac ⌘ · 그 밖 Ctrl
 * - 블록 바꾸기(TURN_INTO): Mac ⌘⌥ · 그 밖 Ctrl+Shift (Windows 에서 Ctrl+Alt 는 AltGr 이라 Notion 도 Shift 를 쓴다)
 * 글쇠는 글자(key)가 아니라 자리(code: KeyD · Digit1 …)로 본다 — 한글 입력 중에는 key 가 "ㅇ" 으로 와서 글자로 보면 안 걸린다
 */

/** Mac 인지(⌘ · ⌥ 표시와 Mac 만의 조합) */
export const IS_MAC = IS_APPLE;

export interface Combo {
  /** ⌘(Mac) · Ctrl(그 밖) */
  mod?: boolean;
  shift?: boolean;
  /** ⌥(Mac) · Alt(그 밖) */
  alt?: boolean;
}

/** 블록 바꾸기 보조키 — Mac ⌘⌥ · 그 밖 Ctrl+Shift */
export const TURN_INTO: Combo = IS_APPLE ? { mod: true, alt: true } : { mod: true, shift: true };

/** code(KeyD · Digit1 · Enter · ArrowUp …) → 글자 — code 가 비어 있는 이벤트(합성 이벤트 등)를 key 로 맞춰 본다 */
function codeKey(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return code;
}

/** 보조키가 정확히 combo 와 같은지(더 누른 보조키가 있으면 아니다) */
export function isModifiers(e: KeyboardEvent, { mod = false, shift = false, alt = false }: Combo): boolean {
  const modDown = IS_APPLE ? e.metaKey : e.ctrlKey;
  const other = IS_APPLE ? e.ctrlKey : e.metaKey;
  return modDown === mod && !other && e.shiftKey === shift && e.altKey === alt;
}

/** 키 조합이 맞는지 — code 는 KeyboardEvent.code(KeyD · Digit0 · Enter · ArrowUp · Backspace …) */
export function isCombo(e: KeyboardEvent, code: string, combo: Combo = {}): boolean {
  if (!isModifiers(e, combo)) return false;
  if (e.code) return e.code === code;
  return e.key.toLowerCase() === codeKey(code).toLowerCase();
}

/** 단축키 표시 — Mac "⌘⇧K" · 그 밖 "Ctrl+Shift+K" */
export function comboLabel(combo: Combo, key: string): string {
  if (IS_APPLE) return `${combo.mod ? "⌘" : ""}${combo.alt ? "⌥" : ""}${combo.shift ? "⇧" : ""}${key}`;
  return [combo.mod && "Ctrl", combo.alt && "Alt", combo.shift && "Shift", key].filter(Boolean).join("+");
}

/** 보조키 하나 이름 — "Option" · "Alt" 등 안내 문구용 */
export const ALT_NAME = IS_APPLE ? "Option" : "Alt";
