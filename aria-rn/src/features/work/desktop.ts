/**
 * 데스크톱 셸(desktop/ — Electron) 브리지. 셸 안에서 열렸을 때만 window.llmwikiDesktop 이 있다.
 * 없으면(그냥 브라우저 · 앱) null — 지금처럼 복사 · 내보내기 + 명령 안내. 원칙: docs/architecture.md "데스크톱 셸".
 * 아래 <bridge> 블록은 desktop/src/bridge-types.ts 의 복사본이다(desktop/test/bridge.test.mjs 가 일치를 확인).
 */
import { Platform } from "react-native";

// <bridge>
export type DesktopExecutor = "claude" | "codex" | "gemma";

export interface DesktopCapabilities {
  apiVersion: 1;
  shellVersion: string;
  platform: "darwin" | "win32" | "linux";
  executors: Record<DesktopExecutor, { available: boolean; reason?: "not_installed" | "ssh_failed" | "disabled"; version?: string; where: "local_cli" | "oracle_queue" }>;
  limits: { maxBundleBytes: number; maxConcurrent: number; timeoutMs: Record<DesktopExecutor, number> };
}

export interface RunRequest {
  runId: string;
  itemId: string;
  executor: DesktopExecutor;
  bundleMarkdown: string;
  model?: string;
}

export interface RunResult {
  runId: string;
  itemId: string;
  executor: DesktopExecutor;
  /** 맨 앞에 <!-- llmwiki-run {...} --> 가 붙은 원문 */
  text: string;
  latencyMs: number;
  model?: string;
  jobId?: string;
}

export type RunErrorCode = "declined" | "invalid_input" | "too_large" | "busy" | "unavailable" | "timeout" | "exec_failed" | "too_long_for_gemma" | "no_result";

export type RunEvent =
  | { runId: string; type: "confirming" }
  | { runId: string; type: "queued"; jobId?: string; ahead?: number }
  | { runId: string; type: "running"; elapsedMs: number }
  | { runId: string; type: "done"; result: RunResult }
  | { runId: string; type: "failed"; code: RunErrorCode; message: string }
  | { runId: string; type: "cancelled" };

export interface LlmwikiDesktop {
  capabilities(): Promise<DesktopCapabilities>;
  runHandoff(req: RunRequest): Promise<{ accepted: true } | { accepted: false; code: RunErrorCode }>;
  onRunEvent(cb: (e: RunEvent) => void): () => void;
  cancel(runId: string): Promise<boolean>;
  pendingResults(): Promise<RunResult[]>;
  ack(runId: string): Promise<void>;
  running(): Promise<{ runId: string; itemId: string; executor: DesktopExecutor }[]>;
  gemmaStatus(): Promise<{ reachable: boolean; queue?: number; running?: string | null; gemma?: "on" | "off" }>;
}
// </bridge>

const SUPPORTED_API = 1;

/** 셸 브리지 — 셸이 아니거나 모르는 계약이면 null */
export function desktop(): LlmwikiDesktop | null {
  if (Platform.OS !== "web") return null;
  const d = (globalThis as { llmwikiDesktop?: LlmwikiDesktop }).llmwikiDesktop;
  return d && typeof d.capabilities === "function" && typeof d.runHandoff === "function" ? d : null;
}

/** apiVersion 이 더 커도 1 기능이 있으면 쓴다(더하기만 하는 변경은 버전을 올리지 않는다) */
export function supported(caps: DesktopCapabilities | null): boolean {
  return !!caps && typeof caps.apiVersion === "number" && caps.apiVersion >= SUPPORTED_API;
}
