/**
 * 화면 고정 문구 — 번역 파일(ko · en)에서만 읽는다. 컴포넌트에는 키만 쓴다.
 * 사용자가 쓴 글 · AI 가 만든 본문은 번역하지 않는다(그대로 그린다).
 * 언어: 설정에서 고른 값 → 기기 언어(ko 면 한국어, 아니면 영어).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import en from "./app.en";
import ko from "./app.ko";
import legacyEn from "./legacy.en";
import legacyKo from "./legacy.ko";

export type Lang = "ko" | "en";
type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

const DICTS: Record<Lang, Record<string, string>> = {
  ko: { ...flatten(legacyKo as Tree), ...flatten(ko as Tree) },
  en: { ...flatten(legacyEn as Tree), ...flatten(en as Tree) },
};

export type Params = Record<string, string | number | null | undefined>;
export type T = (key: string, params?: Params) => string;

/** 키가 없으면 키를 그대로 보여 준다(빠진 번역이 눈에 띄게) */
export function translate(lang: Lang, key: string, params?: Params): string {
  const s = DICTS[lang][key] ?? DICTS.ko[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? "")) : s;
}

/** 번역 파일 안의 묶음(템플릿 같은 목록)을 그대로 */
export function dictOf(lang: Lang): Tree {
  return (lang === "ko" ? ko : en) as unknown as Tree;
}

function deviceLang(): Lang {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith("ko") ? "ko" : "en";
  } catch {
    return "ko";
  }
}

const KEY = "llmwiki:lang";
interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: T;
}
const Ctx = createContext<I18n>({ lang: "ko", setLang: () => undefined, t: (k, p) => translate("ko", k, p) });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(deviceLang());
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => (v === "ko" || v === "en" ? setLangState(v) : undefined))
      .catch(() => undefined);
  }, []);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    AsyncStorage.setItem(KEY, l).catch(() => undefined);
  }, []);
  const t = useCallback<T>((k, p) => translate(lang, k, p), [lang]);
  const v = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  return useContext(Ctx);
}

export function useT(): T {
  return useContext(Ctx).t;
}
