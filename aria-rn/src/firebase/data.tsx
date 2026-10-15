/**
 * 로그인 + 실시간 데이터. 처음 열면 익명으로 로그인하고, users/{uid} 아래 여섯 모음을 구독한다.
 * 서버(함수)가 쓰면 화면이 바로 따라온다 — 앱은 상태를 직접 바꾸지 않는다.
 */
import { onAuthStateChanged, signInAnonymously, signOut, type User } from "firebase/auth";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { emptyState, type AppState } from "../../../packages/core/src/types.ts";
import { errorText } from "./api";
import { auth, db } from "./client";
import { USE_EMULATORS } from "./config";

type Coll = "tasks" | "events" | "scraps" | "messages" | "nodes" | "edges";
const COLLS: Coll[] = ["tasks", "events", "scraps", "messages", "nodes", "edges"];

interface DataApi {
  user: User | null;
  /** 로그인 · 첫 구독이 끝났나 */
  ready: boolean;
  state: AppState;
  error: string | null;
  setError: (e: string | null) => void;
  /** 함수 호출을 감싼다 — 실패하면 화면 위 알림으로 */
  run: <T>(fn: () => Promise<T>) => Promise<T | null>;
  resetUser: () => Promise<void>;
  mode: "emulator" | "cloud";
}

const Ctx = createContext<DataApi | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [state, setState] = useState<AppState>(emptyState());
  const [loaded, setLoaded] = useState<Set<Coll>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        if (!u) signInAnonymously(auth).catch((e) => setError(`로그인하지 못했어요: ${errorText(e)}`));
      }),
    [],
  );

  useEffect(() => {
    if (!user) return;
    setState(emptyState());
    setLoaded(new Set());
    const unsubs = COLLS.map((coll) => {
      const base = collection(db, "users", user.uid, coll);
      const q = coll === "messages" ? query(base, orderBy("createdAt", "asc"), limit(200)) : base;
      return onSnapshot(
        q,
        (snap) => {
          const docs = snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }));
          setState((s) => ({ ...s, [coll]: docs }));
          setLoaded((prev) => (prev.has(coll) ? prev : new Set(prev).add(coll)));
        },
        (e) => setError(`데이터를 읽지 못했어요: ${errorText(e)}`),
      );
    });
    return () => unsubs.forEach((u) => u());
  }, [user]);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      setError(errorText(e));
      return null;
    }
  }, []);

  const resetUser = useCallback(async () => {
    await signOut(auth);
  }, []);

  const api = useMemo<DataApi>(
    () => ({ user, ready: !!user && loaded.size === COLLS.length, state, error, setError, run, resetUser, mode: USE_EMULATORS ? "emulator" : "cloud" }),
    [user, loaded, state, error, run, resetUser],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useData(): DataApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useData must be used inside DataProvider");
  return v;
}
