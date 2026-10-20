// 브리지 계약 — 원본. aria-rn/src/features/work/desktop.ts 에 같은 블록을 복사해 두고 test/bridge.test.mjs 가 일치를 확인한다.
// 더하기만 하는 변경(새 함수 · 새 선택 필드)은 apiVersion 을 올리지 않는다. 깨는 변경은 새 이름으로 더하고 apiVersion 을 올린다.
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
