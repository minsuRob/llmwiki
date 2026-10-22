/**
 * 실행자 — 페이지 · 정리 묶음을 받아 일하고 llmwiki-page · llmwiki-triage 블록으로 돌려주는 쪽(Claude · Codex · Gemma). 순수 데이터.
 *
 * 앱은 실행자를 직접 돌리지 않는다(웹은 로컬 CLI · SSH 를 못 띄운다). 묶음을 만들 때 실행자에 맞춰
 * 자료 예산을 정하고, 사람이 돌릴 명령을 보여 준다. 결과는 같은 '결과 가져오기'로 들어와 같은 규칙(제안 · 검증)을 탄다.
 * 실제 실행은 tools/handoff/run.mjs(로컬 Node) 가 같은 id 로 한다.
 *
 * 예산 근거(docs/local-models): Gemma 는 문맥 8,192 토큰 · 답 최대 1,200 토큰, 한국어 실측 약 1.36자/토큰.
 * 묶음 머리(목표 · 결정 · 형식 안내)에 약 1,500 토큰을 남기면 자료는 약 5,000자.
 */

export type ExecutorId = "claude" | "codex" | "gemma";

export interface ExecutorProfile {
  id: ExecutorId;
  /** 자료 발췌 전체 글자 예산 */
  excerptBudget: number;
  /** 자료 하나의 최대 글자 */
  excerptMax: number;
  /** 웹을 볼 수 있나 — 묶음 안내에 쓴다 */
  web: boolean;
  /** 어디서 도나 — 화면 안내 */
  where: "local_cli" | "oracle_queue";
  /** 사람이 돌릴 명령(묶음 파일 이름 자리 {file}) */
  command: string;
  /** 이 실행자에 맡기기 좋은 일(번역 키 접미사) — 화면 추천 */
  goodFor: string[];
}

export const EXECUTORS: Record<ExecutorId, ExecutorProfile> = {
  claude: {
    id: "claude",
    excerptBudget: 20000,
    excerptMax: 4000,
    web: true,
    where: "local_cli",
    command: "node tools/handoff/run.mjs claude {file}",
    goodFor: ["research", "writing", "analysis"],
  },
  codex: {
    id: "codex",
    excerptBudget: 20000,
    excerptMax: 4000,
    web: false,
    where: "local_cli",
    command: "node tools/handoff/run.mjs codex {file}",
    goodFor: ["code", "analysis"],
  },
  gemma: {
    id: "gemma",
    excerptBudget: 5000,
    excerptMax: 5000,
    web: false,
    where: "oracle_queue",
    command: "node tools/handoff/run.mjs gemma {file}",
    goodFor: ["summary", "injectionCheck"],
  },
};

export const EXECUTOR_IDS = Object.keys(EXECUTORS) as ExecutorId[];

export function executorOf(tool: string): ExecutorProfile | null {
  return (EXECUTORS as Record<string, ExecutorProfile>)[tool] ?? null;
}
