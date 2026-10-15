/**
 * 앱 상태 — 할일 · 일정 · 기록 · 대화를 기기 안(AsyncStorage)에 둔다. 웹에서는 localStorage 에 저장된다.
 * 화면은 useApp() 으로 읽고, 바꾸는 일은 여기 있는 함수로만 한다(engine.ts 의 순수 함수를 부른다).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { runClaudeTurn } from "./claude.ts";
import { closeCard, purgeTrash, resolveOverdue, resolveSuggest, undoChanges } from "./engine.ts";
import { runLocalTurn } from "./local.ts";
import { newId, type AppState, type ChatMessage, type Task } from "./types.ts";

const STATE_KEY = "aria-rn/state/v1";
const KEY_KEY = "aria-rn/anthropic-key";

const EMPTY: AppState = { tasks: [], events: [], scraps: [], messages: [] };

interface AppApi {
  ready: boolean;
  state: AppState;
  apiKey: string;
  setApiKey: (k: string) => void;
  thinking: boolean;
  send: (text: string) => Promise<void>;
  undo: (cardId: string) => void;
  overdueAction: (cardId: string, taskId: string, action: "complete" | "today" | "delete") => void;
  suggestAction: (cardId: string, index: number, action: "add" | "skip") => void;
  addAllSuggested: (cardId: string) => void;
  close: (cardId: string) => void;
  toggleTask: (taskId: string) => void;
  deleteTask: (taskId: string) => void;
  restoreTask: (taskId: string) => void;
  addTaskQuick: (title: string) => void;
  clearChat: () => void;
}

const Ctx = createContext<AppApi | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(EMPTY);
  const [apiKey, setApiKeyState] = useState("");
  const [ready, setReady] = useState(false);
  const [thinking, setThinking] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    (async () => {
      try {
        const [raw, key] = await Promise.all([AsyncStorage.getItem(STATE_KEY), AsyncStorage.getItem(KEY_KEY)]);
        if (raw) setState(purgeTrash({ ...EMPTY, ...JSON.parse(raw) }));
        if (key) setApiKeyState(key);
      } catch {
        // 저장소를 못 읽으면 빈 상태로 시작한다
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STATE_KEY, JSON.stringify(state)).catch(() => undefined);
  }, [state, ready]);

  const setApiKey = useCallback((k: string) => {
    const v = k.trim();
    setApiKeyState(v);
    (v ? AsyncStorage.setItem(KEY_KEY, v) : AsyncStorage.removeItem(KEY_KEY)).catch(() => undefined);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t || thinking) return;
      const now = new Date();
      const userMsg: ChatMessage = { id: newId(), role: "user", text: t, cards: [], createdAt: now.toISOString() };
      const before = stateRef.current;
      setState((s) => ({ ...s, messages: [...s.messages, userMsg] }));
      setThinking(true);
      try {
        if (apiKey) {
          const turn = await runClaudeTurn(apiKey, before, t, now);
          const reply: ChatMessage = { id: newId(), role: "assistant", text: turn.text, cards: turn.cards, createdAt: new Date().toISOString(), via: "claude" };
          setState((s) => ({ ...turn.state, messages: [...s.messages, reply] }));
        } else {
          const turn = runLocalTurn(before, t, now);
          let next = turn.state;
          if (turn.undoLast) {
            // 가장 최근의 되돌리지 않은 변경 카드
            const last = [...before.messages].reverse().flatMap((m) => [...m.cards].reverse()).find((c) => c.kind === "changes" && !c.undone);
            next = last ? undoChanges(before, last.id, now) : before;
          }
          const text2 = turn.undoLast && next === before ? "되돌릴 게 없어요." : turn.text;
          const reply: ChatMessage = { id: newId(), role: "assistant", text: text2, cards: turn.cards, createdAt: new Date().toISOString(), via: "local" };
          setState((s) => ({ ...next, messages: [...s.messages.map((m) => next.messages.find((x) => x.id === m.id) ?? m), reply] }));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const reply: ChatMessage = {
          id: newId(),
          role: "assistant",
          text: /401|authentication|api key/i.test(msg) ? "API 키가 맞지 않아요. 설정에서 다시 넣어 주세요." : `답하지 못했어요: ${msg.slice(0, 160)}`,
          cards: [],
          createdAt: new Date().toISOString(),
        };
        setState((s) => ({ ...s, messages: [...s.messages, reply] }));
      } finally {
        setThinking(false);
      }
    },
    [apiKey, thinking],
  );

  const api = useMemo<AppApi>(() => {
    const patchTask = (id: string, fn: (t: Task) => Task) => setState((s) => ({ ...s, tasks: s.tasks.map((t) => (t.id === id ? fn(t) : t)) }));
    return {
      ready,
      state,
      apiKey,
      setApiKey,
      thinking,
      send,
      undo: (cardId) => setState((s) => undoChanges(s, cardId)),
      overdueAction: (cardId, taskId, action) => setState((s) => resolveOverdue(s, cardId, taskId, action)),
      suggestAction: (cardId, index, action) => setState((s) => resolveSuggest(s, cardId, index, action)),
      addAllSuggested: (cardId) =>
        setState((s) => {
          let next = s;
          const card = s.messages.flatMap((m) => m.cards).find((c) => c.id === cardId);
          if (!card || card.kind !== "suggest") return s;
          card.rows.forEach((r, i) => {
            if (r.state === "open") next = resolveSuggest(next, cardId, i, "add");
          });
          return next;
        }),
      close: (cardId) => setState((s) => closeCard(s, cardId)),
      toggleTask: (id) => patchTask(id, (t) => ({ ...t, done: !t.done, completedAt: t.done ? null : new Date().toISOString() })),
      deleteTask: (id) => patchTask(id, (t) => ({ ...t, deletedAt: new Date().toISOString() })),
      restoreTask: (id) => patchTask(id, (t) => ({ ...t, deletedAt: null })),
      addTaskQuick: (title) => {
        const t = title.trim();
        if (!t) return;
        setState((s) => ({ ...s, tasks: [...s.tasks, { id: newId(), title: t, done: false, createdAt: new Date().toISOString() }] }));
      },
      clearChat: () => setState((s) => ({ ...s, messages: [] })),
    };
  }, [ready, state, apiKey, setApiKey, thinking, send]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useApp(): AppApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppProvider");
  return v;
}
