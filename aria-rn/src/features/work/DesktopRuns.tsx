/**
 * 데스크톱 바로 실행 — 셸이 실행자를 돌리고, 끝난 결과를 '작업 결과 가져오기'와 같은 길(importText)로 자동으로 넣는다.
 * 진행 상태는 메모리에만 둔다(업무 파일에 쓰지 않는다 — AiRun 은 prepare 가 만든 그대로).
 * 앱을 열 때 셸이 보관한 결과(pendingResults)를 먼저 가져온다 — 새로고침 · 웹 배포 중에 끝난 결과를 잃지 않게.
 * 가져오기를 마친 결과만 ack(셸 보관본 삭제). 저장에 실패하면 ack 하지 않고 다음에 다시.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import type { AiTool } from "../../../../packages/core/src/work.ts";
import { desktop, supported, type DesktopCapabilities, type DesktopExecutor, type RunErrorCode, type RunEvent, type RunResult } from "./desktop";
import { useWork } from "./WorkContext";

export type DesktopRunStatus = "confirming" | "queued" | "running" | "importing" | "imported" | "duplicate" | "save_failed" | "failed" | "cancelled";

export interface DesktopRun {
  runId: string;
  itemId: string;
  executor: DesktopExecutor;
  status: DesktopRunStatus;
  startedAt: number;
  ahead?: number;
  code?: RunErrorCode;
  message?: string;
  counts?: { outputs: number; decisions: number; tasks: number };
  rawOnly?: boolean;
  /** 받은 것 정리 실행 — 들인 정리 제안 수 */
  triageAdded?: number;
}

interface DesktopApi {
  /** 셸 안인가(브리지 계약을 아는가) */
  available: boolean;
  caps: DesktopCapabilities | null;
  runs: Record<string, DesktopRun>;
  start: (input: { itemId: string; runId: string; executor: DesktopExecutor; markdown: string }) => Promise<{ ok: true } | { ok: false; code: RunErrorCode }>;
  cancel: (runId: string) => Promise<void>;
  refreshCaps: () => Promise<void>;
}

const Ctx = createContext<DesktopApi | null>(null);
const NONE: DesktopApi = { available: false, caps: null, runs: {}, start: async () => ({ ok: false, code: "unavailable" }), cancel: async () => {}, refreshCaps: async () => {} };

export function DesktopRunsProvider({ children }: { children: React.ReactNode }) {
  const bridge = useMemo(() => desktop(), []);
  const { ready, importText, importTriageText } = useWork();
  const [caps, setCaps] = useState<DesktopCapabilities | null>(null);
  const [runs, setRuns] = useState<Record<string, DesktopRun>>({});
  const importRef = useRef(importText);
  const triageRef = useRef(importTriageText);
  useEffect(() => {
    importRef.current = importText;
    triageRef.current = importTriageText;
  }, [importText, importTriageText]);
  /** 같은 결과를 두 번 가져오지 않게(이벤트와 pending 이 겹칠 때) */
  const taking = useRef(new Set<string>());

  const patch = useCallback((runId: string, p: Partial<DesktopRun> & Partial<Pick<DesktopRun, "itemId" | "executor">>) => {
    setRuns((m) => {
      const prev = m[runId];
      if (!prev && !(p.itemId && p.executor)) return m;
      return { ...m, [runId]: { ...(prev ?? { runId, itemId: p.itemId!, executor: p.executor!, status: "running", startedAt: Date.now() }), ...p } };
    });
  }, []);

  const take = useCallback(
    async (r: RunResult) => {
      if (!bridge || taking.current.has(r.runId)) return;
      taking.current.add(r.runId);
      patch(r.runId, { itemId: r.itemId, executor: r.executor, status: "importing" });
      try {
        // 받은 것 정리 실행은 업무가 아니라 범주에 묶인다 — 같은 셸 경로, 다른 가져오기
        if (isTriageTarget(r.itemId)) {
          const t = await triageRef.current(r.text, { runId: r.runId, tool: r.executor as AiTool });
          if (t.kind === "save_failed") {
            patch(r.runId, { status: "save_failed" });
            return;
          }
          if (t.kind === "imported") patch(r.runId, { status: "imported", triageAdded: t.added.length, rawOnly: t.warnings.includes("no_block") });
          else patch(r.runId, { status: t.kind === "duplicate" ? "duplicate" : "failed", ...(t.kind === "no_run" ? { code: "no_result" as RunErrorCode } : {}) });
          await bridge.ack(r.runId);
          return;
        }
        const res = await importRef.current(r.itemId, r.text, { runId: r.runId, tool: r.executor as AiTool });
        if (res.kind === "save_failed") {
          patch(r.runId, { status: "save_failed" });
          return; // ack 하지 않는다 — 다음에 다시
        }
        if (res.kind === "duplicate") patch(r.runId, { status: "duplicate" });
        else patch(r.runId, { status: "imported", counts: res.counts, rawOnly: res.parsed.structured === "none" });
        await bridge.ack(r.runId);
      } finally {
        taking.current.delete(r.runId);
      }
    },
    [bridge, patch],
  );

  const refreshCaps = useCallback(async () => {
    if (!bridge) return;
    const c = await bridge.capabilities().catch(() => null);
    setCaps(supported(c) ? c : null);
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    let stop = false;
    bridge
      .capabilities()
      .then((c) => {
        if (!stop) setCaps(supported(c) ? c : null);
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [bridge]);

  // 진행 이벤트
  useEffect(() => {
    if (!bridge) return;
    return bridge.onRunEvent((e: RunEvent) => {
      if (e.type === "confirming") patch(e.runId, { status: "confirming" });
      else if (e.type === "queued") patch(e.runId, { status: "queued", ahead: e.ahead });
      else if (e.type === "running") patch(e.runId, { status: "running" });
      else if (e.type === "failed") patch(e.runId, { status: "failed", code: e.code, message: e.message });
      else if (e.type === "cancelled") patch(e.runId, { status: "cancelled" });
      else if (e.type === "done") void take(e.result);
    });
  }, [bridge, patch, take]);

  // 업무를 다 읽은 뒤 — 진행 중인 것을 다시 그리고, 받지 않은 결과를 가져온다
  useEffect(() => {
    if (!bridge || !ready) return;
    let stop = false;
    void (async () => {
      for (const r of await bridge.running().catch(() => [])) if (!stop) patch(r.runId, { itemId: r.itemId, executor: r.executor, status: "running" });
      for (const r of await bridge.pendingResults().catch(() => [])) if (!stop) await take(r);
    })();
    return () => {
      stop = true;
    };
  }, [bridge, ready, patch, take]);

  const start = useCallback<DesktopApi["start"]>(
    async ({ itemId, runId, executor, markdown }) => {
      if (!bridge) return { ok: false, code: "unavailable" };
      patch(runId, { itemId, executor, status: "confirming", startedAt: Date.now(), code: undefined, message: undefined });
      const r = await bridge.runHandoff({ runId, itemId, executor, bundleMarkdown: markdown }).catch(() => ({ accepted: false as const, code: "unavailable" as RunErrorCode }));
      if (!r.accepted) {
        patch(runId, { status: r.code === "declined" ? "cancelled" : "failed", code: r.code });
        return { ok: false, code: r.code };
      }
      return { ok: true };
    },
    [bridge, patch],
  );

  const cancel = useCallback(
    async (runId: string) => {
      if (bridge) await bridge.cancel(runId).catch(() => false);
    },
    [bridge],
  );

  const value = useMemo<DesktopApi>(() => (bridge ? { available: !!caps, caps, runs, start, cancel, refreshCaps } : NONE), [bridge, caps, runs, start, cancel, refreshCaps]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDesktopRuns(): DesktopApi {
  return useContext(Ctx) ?? NONE;
}

/** 이 업무의 실행들(최근 것이 뒤) */
export function runsOf(runs: Record<string, DesktopRun>, itemId: string): DesktopRun[] {
  return Object.values(runs)
    .filter((r) => r.itemId === itemId)
    .sort((a, b) => a.startedAt - b.startedAt);
}

/** 받은 것 정리 실행의 셸 대상 이름 — 셸은 해석하지 않고 돌려주기만 한다(ITEM_ID 모양 안) */
export const triageTarget = (workspaceId: string) => `triage-${workspaceId}`.slice(0, 64);
export const isTriageTarget = (itemId: string) => itemId.startsWith("triage-");

export const isActive = (s: DesktopRunStatus) => s === "confirming" || s === "queued" || s === "running" || s === "importing";
