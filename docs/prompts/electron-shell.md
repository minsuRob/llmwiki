# 구현 프롬프트 — Electron 데스크톱 셸(얇은 셸 + 원격 PWA)

> 2026-10-20 작성. 기준: `main` · 커밋 `26d6bf4`. 이 문서를 그대로 개발 에이전트에게 넘긴다.
> 표기: 저장소에서 확인한 사실은 파일 경로를 붙였다. 추정은 **[추정]**, 모르는 것은 **[확인 필요]**.

## 0. 결론(한 줄씩)

- **만드는 것**: `desktop/` 에 Electron 셸. 창에는 배포된 웹(`https://llmwiki-minsu.web.app`)을 띄우고, 셸은 **로컬 실행(Claude CLI · Codex CLI · 오라클 Gemma 큐) · 좁은 브리지 · 보안**만 맡는다.
- **화면은 번들하지 않는다.** 웹을 배포하면(`npm run deploy:web`) 데스크톱 화면도 다음 로드부터 바뀐다. 셸은 거의 업데이트하지 않는다.
- **실행 로직은 새로 쓰지 않는다.** `tools/handoff/run.mjs` 의 본문을 라이브러리 함수로 꺼내(`tools/handoff/lib.mjs`) CLI 와 Electron 메인이 같이 쓴다.
- **결과 규칙도 새로 쓰지 않는다.** 실행 결과는 앱의 `importText`(→ core `importResult`)로 들어가 지금과 같은 검사를 거쳐 **제안**으로만 쌓인다. 확정 · 완료 · 상태 전환은 사람만 한다.
- **가장 큰 위험**: Google 이 Electron 창 안의 Google 로그인 · GIS 동의 팝업을 막을 수 있다 **[확인 필요]**. 그래서 0단계에서 이것부터 시험하고, 막히면 시스템 브라우저 + loopback 방식으로 간다(7절).
- 웹에 `window.llmwikiDesktop` 이 없으면 지금처럼 복사 · 내보내기 + 명령 안내를 보인다(점진적 기능). 웹만 쓰는 사람에게 바뀌는 것은 없다.

---

## 1. 목표 · 범위 · 하지 않을 것

### 목표
| # | 목표 | 확인 방법 |
|---|---|---|
| G1 | 업무 상세의 "AI 로 이어하기"에서 **바로 실행** → 결과가 자동으로 "작업 결과 가져오기"와 같은 흐름에 들어간다 | 9절 T3 · T4 |
| G2 | UI 변경은 웹 배포만으로 데스크톱에 반영된다 | 9절 T7 |
| G3 | 셸이 열어 주는 권한은 "정해진 실행자 3개에 묶음 하나 넘기기"뿐이다 | 9절 T5 · T6 |

### 범위(이번에 한다)
- Electron 셸(메인 · preload · 오프라인 안내 페이지), macOS 우선 **[추정: 개발 맥만 대상 — 확인 필요]**.
- 공유 실행 모듈 `tools/handoff/lib.mjs`(+ `run.mjs` 를 얇은 CLI 로).
- 웹 쪽: `desktop.ts`(브리지 감지 · 타입), `HandoffPanel` 의 "바로 실행", `WorkContext` 의 자동 가져오기 · `prepare` 가 runId 반환.
- 문서: `docs/architecture.md` 에 데스크톱 셸 절을 **먼저** 추가(architecture.md 머리말: "바꿀 때는 이 문서부터 고치고 코드를 맞춘다"), README 실행자 절 갱신.

### 하지 않을 것
| 하지 않음 | 이유 · 근거 |
|---|---|
| 화면(aria-rn 빌드)을 Electron 에 묶어 배포 | 업데이트를 웹 배포 하나로 — 사용자 요구 |
| 임의 셸 명령 · 임의 실행 파일 · 임의 인자 받기 | 원칙 3(권한은 좁게). 브리지는 `executor` 이름(화이트리스트)과 묶음 글만 받는다. Gemma 서버도 "정해진 작업만"(`docs/architecture.md` 원칙 5, `jobd.py` `KINDS`) |
| 결과를 확정 · 완료 · 상태 전환 | 원칙 1. `run.mjs` 머리 주석: "답을 업무에 반영하지 않는다" |
| 셸이 업무 데이터를 따로 저장 · 동기화 · 색인 | 원칙 2. 데이터 원본은 사용자 Drive. 셸은 결과가 앱에 넘어갈 때까지의 임시 보관만(3.5) |
| 셸이 Firebase · Drive 토큰을 보관 · 대신 호출 | 토큰은 지금처럼 렌더러(웹)가 다룬다. 브리지에 토큰을 넘기는 API 를 만들지 않는다 |
| 사용자 에이전트(UA) 위장으로 Google 로그인 차단 우회 | Google 정책 위반 소지 **[확인 필요]**. 막히면 7절 대안 |
| Grok · Muse 연결 | `tools/handoff/executors.mjs` 에서 `status: 'planned'` — 이번 범위 밖 |
| iOS · Android | 무관 |

---

## 2. 지금 저장소에서 확인한 사실(근거)

| 사실 | 근거 |
|---|---|
| 세 역할: 앱(업무 관리) · AI(작업) · Drive(보관). 흐름: 묶음 → AI → 결과 가져오기(검사 · 제안) → 사람 확정 → Drive | `docs/architecture.md` "세 역할" |
| AI 결과는 언제나 제안. `status` · `confirmed` 필드는 무시하고 표시. 검사에 걸려도 원문 먼저 저장 | `docs/architecture.md` 원칙 1 |
| 서버(Functions · Firestore)는 운영 정보만, Drive 내용을 저장 · 색인 · 로그하지 않음 | 원칙 2 |
| Drive 범위 `drive.file`(+ `openid` · `email`), 앱은 Firestore 읽기만 | 원칙 3 |
| refresh token 은 서버가 AES-256-GCM 으로 보관, 앱은 1시간 access token 만. 웹 토큰은 탭의 sessionStorage | 원칙 4, `functions/src/features/drive.ts`, `aria-rn/src/features/work/drive/googleDrive.web.ts` 머리 주석 |
| 실행자 예산: Claude · Codex 2만 자, Gemma 5천 자 | 원칙 5, `packages/core/src/executors.ts` |
| 웹은 실행자를 직접 못 돌린다 → 사람이 `node tools/handoff/run.mjs <claude\|codex\|gemma> <묶음.md>` | `README.md` "AI 실행자", `HandoffPanel.tsx` 머리 주석, `executors.ts` 머리 주석 |
| Claude: `claude -p --output-format json --allowedTools WebSearch,WebFetch,Read,Grep,Glob --disallowedTools Bash,Edit,Write,NotebookEdit`, 묶음은 표준입력 | `tools/handoff/executors.mjs` |
| Codex: `codex exec --json --sandbox read-only --skip-git-repo-check [-C dir] -` | `tools/handoff/executors.mjs`. 개발 맥에 미설치, 실제 실행 미검증(`docs/local-models/status.md`) |
| Gemma: `scp` 로 `oci-a1:lwe/jobs/in/<이름>` 에 올리고 `ssh oci-a1 python3 ~/lwe/jobd/jobd.py submit handoff_gemma --input …` → 10초마다 status → `output`. 기본 시간 제한 45분 | `tools/handoff/oracle.mjs` (`HOST = OCI_JOBS_HOST ?? 'oci-a1'`, id 형식 `^[0-9]{4}-[0-9]{6}-[0-9a-f]{4}$`) |
| Gemma 실서버 1건: 묶음 6,384자 → 461초, 파싱 성공 | `docs/local-models/status.md` |
| 서버 쪽 Gemma: 문맥 8,192, 입력+답이 넘치면 돌리지 않고 이유를 남김(종료 코드 3) | `tools/local-model-eval/jobd/gemma_handoff.py` |
| `jobd.py` 는 정해진 `KINDS` 만, 한 번에 하나. `cancel <id>` 있음 | `tools/local-model-eval/jobd/jobd.py` |
| MCP 쪽 묶음 제한: `.md` · 200KB 이하 | `tools/local-model-eval/jobd/oci-jobs-mcp.mjs` `oci_handoff_submit` |
| 결과 맨 앞 머리줄 `<!-- llmwiki-run {"executor","model","latencyMs"} -->` 를 `run.mjs` 가 붙이고(이미 있으면 안 붙임), core `runMeta` 가 읽는다 | `tools/handoff/run.mjs`, `packages/core/src/workHandoff.ts` `runMeta` |
| `run.mjs` 는 최상위에서 `parseArgs` · `process.exit` 를 하는 CLI 라 **그대로 import 할 수 없다**. `executors.mjs` · `oracle.mjs` 는 import 가능 | `tools/handoff/run.mjs` |
| `prepareRun` 이 runId 를 만들어 묶음 머리와 `llmwiki-result` 틀(`run`)에 넣는다. 그런데 `WorkContext.prepare` 는 `{ markdown, excluded, dropped }` 만 돌려주고 **runId 를 돌려주지 않는다** | `packages/core/src/workHandoff.ts` L96 · L154 · L179, `aria-rn/src/features/work/WorkContext.tsx` `prepare` |
| `importText(itemId, text, { runId, tool })` → 원문 저장(`saveRaw`) 먼저, 실패하면 반영 안 함. 같은 원문은 `duplicate` | `WorkContext.tsx` `importText`, `workHandoff.ts` `importResult` |
| runId 형식: `Date.now().toString(36)` + `-` + 무작위 base36(최대 8자) | `packages/core/src/types.ts` `newId` |
| 판단 기록(채택률)은 업무 상태에서 파생(`deriveJudgments`) — 가져오기만 같으면 그대로 쌓인다 | `packages/core/src/judgments.ts` |
| Firebase Google 로그인은 `linkWithPopup` / `signInWithPopup`(웹 전용) | `aria-rn/src/firebase/google.ts` |
| Drive: GIS `initTokenClient`(익명 등) · `initCodeClient({ ux_mode: "popup" })`(Google 로그인 사용자 → 서버 `driveLink`), Picker 는 `apis.google.com/js/api.js` | `googleDrive.web.ts` |
| 서버의 코드 교환은 `redirect_uri: "postmessage"`(GIS popup 약속값) + 웹 OAuth 클라이언트 | `functions/src/driveTokens.ts` L88–92, `functions/src/features/drive.ts` `CLIENT_ID` |
| 승인된 JavaScript 원본: `http://localhost:8081`, `https://llmwiki-minsu.web.app` | `README.md` "Google Drive 연결" 2 |
| Hosting: `index.html` 등 전부 `Cache-Control: no-cache`, `/_expo/**` · `/assets/**` 는 1년 immutable, 모든 경로 → `/index.html` | `firebase.json` |
| Hosting 에 **CSP 헤더가 없다** | `firebase.json` |
| Expo 57 · RN 0.86 · RN web 0.21 · Firebase JS 13, 웹 출력 `single` | `aria-rn/package.json`, `aria-rn/app.json` |
| 저장소에서 웹 앱 manifest · service worker 를 찾지 못했다 → 지금 웹은 오프라인 동작이 없는 SPA로 본다 | `aria-rn/app.json`(manifest 설정 없음) **[확인 필요: 배포본에 SW 가 정말 없는지]** |
| 루트는 npm workspaces 가 아니라 `--prefix` 로 패키지마다 설치 | `package.json`, `README.md` "로컬에서 실행" |
| 예전 계획: Renderer 는 RN web 재사용, Main 에 executors · runner · validateResult · MCP 서버 | `docs/local-models/runtime.md` — 이번 계획은 **Renderer 를 번들하지 않고 원격**으로 바꾼다. `validateResult` 는 메인이 아니라 지금처럼 웹(core)이 한다 |

---

## 3. 구조

```
┌──────────────── Electron 앱 (desktop/) ────────────────┐
│ Main (Node)                                            │
│  - 창 · 허용 origin · 새 창/탐색 차단 · 권한 요청 거절  │
│  - IPC 핸들러(보낸 쪽 origin · 프레임 확인)             │
│  - runner: tools/handoff/lib.mjs 를 import             │
│      claude/codex → spawn(고정 인자, 빈 임시 폴더)       │
│      gemma        → oracle.mjs(scp · ssh oci-a1 · jobd) │
│  - 외부 전송 확인 창(네이티브 dialog)                   │
│  - 대기 결과 임시 보관(userData/runs/)                  │
│ Preload (sandbox, CJS)                                 │
│  - contextBridge: window.llmwikiDesktop 하나            │
│ Renderer = https://llmwiki-minsu.web.app (원격, 그대로) │
│  - 없으면 오프라인 안내(로컬 offline.html)              │
└────────────────────────────────────────────────────────┘
   결과 텍스트 → 웹 WorkContext.importText → core importResult → 제안
```

| 층 | 하는 일 | 하지 않는 일 |
|---|---|---|
| Main | 실행자 실행 · 상태 · 취소, 확인 창, 보안 정책, 대기 결과 보관 | 결과 해석 · 검사(웹 core 가 한다), 토큰 보관, Drive 접근 |
| Preload | 브리지 함수 5~6개를 `ipcRenderer.invoke` 로 감싸 노출, 입력 1차 검증 | Node API 노출, `ipcRenderer` 자체 노출 |
| Renderer(웹) | 묶음 만들기(`prepare`) · 결과 가져오기(`importText`) · 제안 표시 · 사람 확정 | 셸 없이도 전부 동작해야 한다 |

### 3.1 웹 쪽 변경(구체적으로)

| 파일 | 변경 |
|---|---|
| `aria-rn/src/features/work/desktop.ts` (새 파일) | `export function desktop(): LlmwikiDesktop \| null` — `globalThis.llmwikiDesktop` 를 읽고 `apiVersion` 이 지원 범위면 돌려준다. 브리지 타입(3.2) 선언. `Platform.OS !== "web"` 이면 늘 null |
| `aria-rn/src/features/work/WorkContext.tsx` | ① `prepare` 반환에 `runId: r.run.id` 추가(`WorkApi["prepare"]` 타입도). ② `runDesktop(itemId, runId, tool, markdown)` 추가: 브리지 `runHandoff` 호출 → 진행 상태를 메모리 상태 `desktopRuns: Record<runId, {status, ahead?, error?}>` 에 둔다(업무 파일에 쓰지 않음 — AiRun 모델은 그대로). ③ 결과가 오면 `importText(itemId, text, { runId, tool })` 를 **자동** 호출 → 성공(`imported` · `duplicate`)이면 `ack(runId)`. ④ 앱을 열 때 `pendingResults()` 를 읽어 같은 방식으로 가져온다(새로고침 · 웹 배포 중 끊김 대비). ⑤ `save_failed` 면 ack 하지 않고 "저장 안 됨" 표시(다음 시작 때 다시) |
| `aria-rn/src/features/work/HandoffPanel.tsx` | 묶음이 만들어진 뒤(`pack` 화면) `desktop()?.capabilities` 에서 이 실행자가 `available` 이면 **"바로 실행"** 주 단추를 보이고, 복사 · 내보내기는 보조로 남긴다. 실행 중이면 상태(대기 · 실행 · 앞 작업 n개 · 경과 시간)와 "취소". 실행자가 없거나 셸이 없으면 지금의 `RunHint`(명령 한 줄) 그대로. `tool === "other"` 는 바로 실행 없음 |
| `aria-rn/src/features/work/ImportPanel.tsx` | 바꿀 것은 적다: 자동 가져오기 결과 알림(`import.done` 등 같은 문구)을 이 패널 또는 업무 상세에서 보인다. 붙여넣기 · 파일 경로는 그대로(데스크톱에서도 수동 가져오기 가능) |
| `aria-rn/src/i18n/app.{ko,en}.ts` | `handoff.runNow` · `handoff.running` · `handoff.queued`(앞 작업 수) · `handoff.cancel` · `handoff.desktopFailed` · `handoff.autoImported` 등. 지금 `handoff.runWith` 는 "터미널에서" 안내라 셸에서는 숨긴다 |
| `aria-rn/src/features/work/WorkDetailScreen.tsx` **[확인 필요: 진행 표시 위치]** | 패널을 닫아도 실행이 이어지므로 업무 상세 위에 "실행 중" 줄 |

원칙: 웹 쪽 실행 버튼 · 문구 · 흐름은 **웹 배포로** 바뀐다. 셸이 바뀌어야 하는 것은 브리지 계약(3.2)이 바뀔 때뿐이다.

### 3.2 브리지 API(`window.llmwikiDesktop`)

```ts
// desktop/src/bridge-types.ts 와 aria-rn/src/features/work/desktop.ts 에 같은 정의(한쪽을 원본으로, 다른 쪽은 복사 + 테스트로 일치 확인)
export type DesktopExecutor = "claude" | "codex" | "gemma";

export interface DesktopCapabilities {
  apiVersion: 1;                 // 브리지 계약 버전. 깨는 변경 때만 올린다
  shellVersion: string;          // 셸 앱 버전(package.json version)
  platform: "darwin" | "win32" | "linux";
  executors: Record<DesktopExecutor, {
    available: boolean;
    reason?: "not_installed" | "ssh_failed" | "disabled";
    version?: string;            // claude --version 등. 비밀 아님
    where: "local_cli" | "oracle_queue";
  }>;
  limits: { maxBundleBytes: number; maxConcurrent: number; timeoutMs: Record<DesktopExecutor, number> };
}

export interface RunRequest {
  runId: string;                 // prepare 가 만든 AiRun id
  itemId: string;                // 결과를 넣을 업무(셸은 해석하지 않고 돌려주기만)
  executor: DesktopExecutor;
  bundleMarkdown: string;
  model?: string;                // 선택. 허용 목록 안의 값만(아래)
}

export type RunEvent =
  | { runId: string; type: "confirming" }                        // 확인 창 떠 있음
  | { runId: string; type: "queued"; jobId?: string; ahead?: number }
  | { runId: string; type: "running"; elapsedMs: number }
  | { runId: string; type: "done"; result: RunResult }
  | { runId: string; type: "failed"; code: RunErrorCode; message: string }
  | { runId: string; type: "cancelled" };

export interface RunResult {
  runId: string; itemId: string; executor: DesktopExecutor;
  text: string;                  // 맨 앞에 <!-- llmwiki-run {...} --> 가 붙은 원문
  latencyMs: number; model?: string; jobId?: string;
}

export type RunErrorCode =
  | "declined"        // 사용자가 확인 창에서 거절
  | "invalid_input" | "too_large" | "busy" | "unavailable"
  | "timeout" | "exec_failed" | "too_long_for_gemma" | "no_result";

export interface LlmwikiDesktop {
  capabilities(): Promise<DesktopCapabilities>;
  runHandoff(req: RunRequest): Promise<{ accepted: true } | { accepted: false; code: RunErrorCode }>;
  onRunEvent(cb: (e: RunEvent) => void): () => void;   // 해제 함수
  cancel(runId: string): Promise<boolean>;
  pendingResults(): Promise<RunResult[]>;               // 앱이 아직 받지 않은 결과
  ack(runId: string): Promise<void>;                    // 앱이 importText 를 끝냄 → 셸 보관본 삭제
  gemmaStatus(): Promise<{ reachable: boolean; queue?: number; running?: string | null; gemma?: "on" | "off" }>;
}
```

| 검증(메인에서 다시 — preload 검증은 믿지 않는다) | 값 |
|---|---|
| `executor` | `"claude" \| "codex" \| "gemma"` 정확히 일치. 그 외 `invalid_input` |
| `runId` · `itemId` | `/^[0-9a-z]{4,14}-[0-9a-z]{1,10}$/` (`types.ts` `newId` 형식 — 업무 id 도 `createWorkItem` 이 `newId()` 로 만든다, `packages/core/src/work.ts`). 기존 기록 이행(`workMigrate.ts`)으로 생긴 업무의 id 형식은 **[확인 필요]** |
| `bundleMarkdown` | 문자열, UTF-8 **200,000 바이트 이하**(`oci-jobs-mcp.mjs` 와 같은 상한), Gemma 는 추가로 [추정] 20,000자 이하(예산 5천 자 + 머리). 빈 글 · NUL 문자 거절 |
| `model` | 실행자별 허용 목록(셸 설정 파일 고정, 예: Claude `opus`/`sonnet`) 안의 값만, 아니면 무시하고 기본값 **[확인 필요: 허용 목록]** |
| 동시 실행 | 실행자당 1건, 전체 2건. 넘으면 `busy`. 같은 `runId` 재요청은 진행 중인 것에 붙는다(중복 실행 없음) |
| 시간 제한 | Claude · Codex 30분(`run.mjs` `exec` 기본값), Gemma 45분(`oracle.mjs` `runGemma` 기본값). 넘으면 프로세스 종료(SIGTERM → 5초 뒤 SIGKILL) · Gemma 는 서버 작업을 `cancel` 하지 않고 `timeout` + jobId 를 남겨 다음 시작 때 이어 받기 |
| 출력 상한 | 표준출력 16MB(`oracle.mjs` `maxBuffer` 와 같게). 넘으면 `exec_failed` |

### 3.3 공유 모듈(복붙 금지)

| 파일 | 내용 |
|---|---|
| `tools/handoff/lib.mjs` (새) | `export async function runHandoff({ executor, bundlePath, model, mode, workdir, signal, onProgress, timeoutMs }) → { text, model, latencyMs, jobId? }`. `run.mjs` 의 `exec` · 머리줄 붙이기(`<!-- llmwiki-run {executor, model, latencyMs} -->`, 이미 있으면 안 붙임) · `GEMMA_MODEL` 기본값을 옮긴다. `signal`(AbortSignal)로 취소: CLI 는 kill, Gemma 는 `cancelGemma(id)` |
| `tools/handoff/oracle.mjs` | `cancelGemma(id)`(`jobd.py cancel`) · `queueStatus()`(`jobd.py status`) 추가. `runGemma` 에 `signal` · `onSubmitted(id)`(jobId 를 바로 알려 보관하게) 추가. 기존 함수 모양은 유지(MCP `oci-jobs-mcp.mjs` 가 import) |
| `tools/handoff/executors.mjs` | 변경 최소. 아래 "데스크톱 조사 모드"는 4절 결정에 따라 `mode` 하나 추가 |
| `tools/handoff/run.mjs` | 인자 파싱 · 파일 쓰기 · 출력만 남기고 `lib.mjs` 를 부르는 얇은 CLI. **사용법 · 출력 · 결과 파일 이름은 지금과 같아야 한다**(README 의 명령이 그대로 돌아야 함) |
| `tools/handoff/lib.test.mjs` (새) | `node --test`. 가짜 CLI(`tools/handoff/fixtures/fake-cli.mjs`: 표준입력을 읽고 `llmwiki-result` 블록이 든 JSON 을 출력)로 claude 경로, 머리줄, 시간 제한, 취소, 출력 상한 시험. Gemma 는 `ssh`/`scp` 대신 주입한 가짜 `run` 함수로 |

- Electron 메인은 `import { runHandoff } from '../../tools/handoff/lib.mjs'` 로 쓰고, 패키징 때 esbuild 로 메인 + `tools/handoff/*` 를 한 파일로 묶는다(electron-builder 는 앱 폴더 밖 파일을 담지 않는다) **[추정]**.
- `lib.mjs` 는 지금처럼 **의존성 없음** · Node 내장만. Electron 메인 Node 버전에서 도는지 확인 **[확인 필요: 고를 Electron 버전의 Node]**.
- 묶음은 메인이 `app.getPath('temp')/llmwiki-<runId>/bundle.md`(권한 0600, 폴더 0700)에 쓰고, 끝나면(성공 · 실패 · 취소) 지운다.

### 3.4 실행 순서(바로 실행 1건)

1. 웹: `prepare(...)` → `{ markdown, runId }`(업무에 `prepared` 실행 기록이 저장된다 — 지금과 같다).
2. 웹: `runHandoff({ runId, itemId, executor, bundleMarkdown })`.
3. 메인: 보낸 쪽 확인(4절) → 입력 검증 → **네이티브 확인 창**(4절) → 거절이면 `failed: declined`.
4. 메인: 임시 파일 → `lib.runHandoff` → 진행 이벤트(`queued` · `running`) → 결과 텍스트(머리줄 포함).
5. 메인: 결과를 `userData/runs/<runId>.json` 에 보관 → `done` 이벤트.
6. 웹: `importText(itemId, text, { runId, tool: executor })` → 같은 검사 → 제안 · 경고 표시 → `ack(runId)` → 메인이 보관본 삭제.
7. 사람이 검토 카드에서 확정(지금과 같다).

### 3.5 셸의 로컬 보관(대기 결과 · Gemma 이어 받기)

| 무엇 | 어디 | 언제 지우나 |
|---|---|---|
| 앱이 아직 받지 않은 결과 원문 | `userData/runs/<runId>.json` (0600) | `ack` 직후. 30일 지나면 [추정] |
| 진행 중 Gemma 작업 `{runId, itemId, jobId, submittedAt}` | `userData/runs/active.json` | 결과를 받거나 실패 · 취소 때. 셸을 다시 켜면 `statusOf(jobId)` 로 이어 받는다 |
| 묶음 임시 파일 | OS 임시 폴더 | 실행 끝나면 바로 |

이 보관은 원칙 2(서버는 운영 정보만)와는 무관한 **기기 안** 임시 보관이지만, 업무 내용(결과 원문)이 Drive 밖에 잠시 놓인다 → 10절 결정 질문 Q4.

---

## 4. 보안

| 항목 | 규칙 |
|---|---|
| `webPreferences` | `contextIsolation: true` · `sandbox: true` · `nodeIntegration: false` · `nodeIntegrationInSubFrames: false` · `webSecurity: true` · `allowRunningInsecureContent: false` · `webviewTag: false` · 패키징 빌드는 `devTools: false` |
| 허용 origin(창 본문) | 패키징: `https://llmwiki-minsu.web.app` 하나. 개발(`!app.isPackaged`): 추가로 `http://localhost:8081` · `http://127.0.0.1:8081`. `https://llmwiki-minsu.firebaseapp.com` 을 본문으로 쓸지 **[확인 필요]** — 기본은 아님 |
| 탐색 | `will-navigate` · `will-redirect`: 허용 origin 밖이면 `preventDefault()`. http(s) 링크는 사용자가 누른 것만 `shell.openExternal`(https 만, 확인 없이 열지 말지 Q6) |
| 새 창 | `setWindowOpenHandler`: 아래 허용 목록만 `allow`(자식 창은 preload 없음 · sandbox · 같은 정책), 나머지 https 는 `deny` + 시스템 브라우저, 그 외 스킴 `deny` |
| 로그인 · 동의 허용 목록(새 창) | `https://llmwiki-minsu.firebaseapp.com/__/auth/` (Firebase 팝업 핸들러), `https://accounts.google.com/` (Google 로그인 · GIS 동의) — 정확한 경로는 0단계에서 실측해 고정 **[확인 필요]** |
| iframe | Firebase Auth 숨은 iframe(`llmwiki-minsu.firebaseapp.com/__/auth/iframe`) · Picker(`docs.google.com`) · GIS 가 쓰는 iframe 은 허용해야 한다 **[확인 필요: 실측]**. iframe 에는 preload 가 실리지 않으므로 브리지가 없다 |
| 권한 요청 | `session.setPermissionRequestHandler` · `setPermissionCheckHandler`: 클립보드 쓰기(`clipboard-sanitized-write` — 지금 `copyText` 가 씀 **[확인 필요]**)만 허용, 카메라 · 마이크 · 위치 · 알림 등 거절 |
| 다운로드 | `will-download`: 사용자가 "내보내기"를 누른 경우만 저장 대화상자. 자동 저장 없음 |
| IPC 보낸 쪽 확인 | 모든 `ipcMain.handle` 에서 `event.senderFrame` 이 **메인 창의 최상위 프레임**이고 `new URL(senderFrame.url).origin` 이 허용 origin 인지 확인. 아니면 거절하고 사실만 기록 |
| preload 이중 확인 | `location.origin` 이 허용 origin 일 때만 `contextBridge.exposeInMainWorld` (탐색이 뚫려도 다른 사이트에 브리지가 안 생기게) |
| CSP | 원격 페이지 CSP 는 **웹 쪽(`firebase.json` hosting 헤더)** 에서 정한다 — 셸이 `onHeadersReceived` 로 덮으면 웹 배포가 셸에 묶인다. 지금 CSP 가 없으므로 `Content-Security-Policy-Report-Only` 부터(허용: self, `accounts.google.com`, `apis.google.com`, `*.googleapis.com`, `asia-northeast3-llmwiki-minsu.cloudfunctions.net`, `llmwiki-minsu.firebaseapp.com`, `docs.google.com` …) **[확인 필요: 실제 요청 목록]**. 로컬 `offline.html` 은 `default-src 'none'; style-src 'self'; img-src 'self'` |
| 외부 전송 확인 | 실행 전 **메인이 띄우는 네이티브 `dialog.showMessageBox`**(웹 페이지가 건너뛸 수 없다): 실행자 · 받는 곳(Claude → Anthropic, Codex → OpenAI, Gemma → 내 오라클 서버 `oci-a1`) · 묶음 크기(자) · 자료 수 · 다른 작업실 자료 포함 여부(묶음 머리에서 읽을 수 있으면) · [보내기]/[취소]. 기본 단추는 취소 |
| Claude CLI | 조사 모드 고정(`--allowedTools` 조사 도구, `--disallowedTools Bash,Edit,Write,NotebookEdit`). **작업 폴더는 빈 임시 폴더**(`cwd`). `Read · Grep · Glob` 를 데스크톱에서 뺄지(묶음에 발췌가 다 들어 있으므로 웹만 남기기) — Q2. 사용자 `~/.claude` 의 MCP 서버가 섞이지 않게 `--strict-mcp-config` 등 **[확인 필요: 지금 CLI 의 플래그 이름]** |
| Codex CLI | `--sandbox read-only` 고정, `-C <빈 임시 폴더>`, `--skip-git-repo-check`. 승인 묻기 모드가 비대화형에서 멈추지 않는지 **[확인 필요]** |
| Gemma | `ssh -o BatchMode=yes -o ConnectTimeout=10 oci-a1 …` (비밀번호 프롬프트로 멈추지 않게). 서버 작업 종류는 `handoff_gemma` 하나만 — 셸에 다른 kind 를 넣는 길이 없다 |
| 실행 파일 찾기 | macOS 앱은 셸 PATH 를 받지 못한다. 시작 때 한 번 `/bin/zsh -lc 'command -v claude; command -v codex'`(고정 문자열)로 절대 경로를 찾고, 설정 파일로 덮어쓸 수 있게. 사용자 입력이 명령줄에 들어가는 곳은 없다. `spawn(..., { shell: false })` |
| 환경 변수 | 자식 프로세스에 최소 환경(`PATH`, `HOME`, `LANG`, `SSH_AUTH_SOCK`, 실행자에 필요한 것). `ELECTRON_*` · `NODE_OPTIONS` 는 지운다 |
| 비밀값 · 내용 로그 금지 | 로그(`userData/logs/`)에는 runId · 실행자 · 상태 · 걸린 시간 · 바이트 수 · 종료 코드만. 묶음 · 결과 원문 · 토큰(`ya29.` 등) · 쿠키 · stderr 원문은 남기지 않는다(stderr 는 끝 500자를 화면 오류로만, 로그 아님). 원칙 4 "남기는 기록" 과 같은 결 |
| 단일 인스턴스 | `app.requestSingleInstanceLock()` |
| 자동 업데이트 채널 | 쓰면 https · 서명 확인 필수(6절) |

---

## 5. 결과 흐름(데스크톱이라고 다른 규칙을 쓰지 않는다)

| 단계 | 지금(웹 + 터미널) | 데스크톱 |
|---|---|---|
| 묶음 | `prepare` → 복사 · 내보내기 | 같은 `prepare` → 브리지로 넘김 |
| 실행 | 사람이 `run.mjs` | 메인이 `lib.runHandoff`(같은 코드) |
| 머리줄 | `run.mjs` 가 붙임 | `lib.mjs` 가 붙임(같은 코드) |
| 가져오기 | 붙여넣기 · 파일 → `importText` | 자동으로 `importText(itemId, text, { runId, tool })` |
| 검사 · 원문 저장 · 중복 | core `importResult` · `saveRaw` | 같음 |
| 판단 기록 | `deriveJudgments` | 같음 |
| 확정 | 사람 | 사람 |

- 셸은 `llmwiki-result` 를 해석하지 않는다(로그용 "블록 있음/없음" 표시도 하지 않는다 — 웹이 한다).
- 결과에 블록이 없어도 원문은 가져온다(`import.rawOnly` — 지금과 같음).
- Gemma 가 "묶음이 너무 길다"(`gemma_handoff.py` 종료 3)로 실패하면 `too_long_for_gemma` 로 알리고, 웹이 "Gemma 로 다시 묶기"를 안내한다.

---

## 6. 업데이트 전략

| 무엇 | 어떻게 |
|---|---|
| 화면(UI) | `npm run deploy:web`. `index.html` 은 `no-cache`, 번들은 해시 경로 immutable(`firebase.json`) → 셸은 다음 로드(창 다시 열기 · 새로고침 · 아래 자동 확인)부터 새 화면 |
| 셸 쪽 "새 화면 있음" | [추정] 창에 포커스가 돌아올 때 1시간에 한 번 `index.html` 의 ETag/Last-Modified 를 확인해 바뀌었으면 웹에 알리지 않고 다음 새로고침 때 반영. 실행 중에는 새로고침하지 않는다(대기 결과는 3.5 로 보호되지만 굳이 끊지 않는다). 이 기능은 선택 — Q7 |
| 호환성 계약 | 웹은 `capabilities().apiVersion` 을 보고 기능을 켠다(`1` 만 알면 `1` 기능만). 셸은 **더하기만** 하는 변경(새 함수 · 새 선택 필드)은 `apiVersion` 을 올리지 않는다. 깨는 변경이 필요하면 새 이름 함수를 더하고 `apiVersion: 2` 로, 옛 함수는 한동안 남긴다. 웹은 모르는 `apiVersion`(더 큰 값)도 `1` 기능이 있으면 쓴다(`supports: number[]` 로 줄지 결정 — Q8) |
| 셸 버전 표시 | 설정 화면 맨 아래(웹이 `shellVersion` 표시) + 셸 메뉴 "정보" |
| 셸 자동 업데이트 | 선택. electron-updater 를 쓰면 macOS 는 **Developer ID 서명 + 공증(notarization)** 이 사실상 필수(서명 없는 앱은 Squirrel.Mac 업데이트가 안 됨 · Gatekeeper 경고) **[확인 필요: Apple Developer 계정 유무]**. 처음에는 자동 업데이트 없이 수동 설치(.dmg/.zip)로 시작 |
| 오프라인 · 접속 실패 | `did-fail-load`(메인 프레임) 또는 10초 안에 로드 안 됨 → 앱에 들어 있는 `desktop/static/offline.html`: "llmwiki 웹에 접속하지 못했어요"(+ 원인 코드), [다시 시도], 셸 버전. 이 페이지에는 브리지를 노출하지 않는다(실행 기능 없음). 대기 결과는 지워지지 않는다고 알린다 |

---

## 7. 로그인 · Drive (가장 불확실 — 0단계에서 먼저 시험)

| 흐름 | 지금 코드 | Electron 안에서 | 위험 |
|---|---|---|---|
| Firebase Google 로그인 | `linkWithPopup` / `signInWithPopup` (`aria-rn/src/firebase/google.ts`) | `window.open` → `llmwiki-minsu.firebaseapp.com/__/auth/handler` → `accounts.google.com` → 돌아와 opener 로 결과 전달. `setWindowOpenHandler` 에서 허용하고 opener 를 유지해야 한다 | Google 이 "내장 브라우저"로 보고 "이 브라우저 또는 앱은 안전하지 않을 수 있습니다"로 막을 수 있음 **[확인 필요]** |
| GIS 토큰(익명 등) | `initTokenClient` + `requestAccessToken` | 팝업 창 → `postMessage` 로 opener 에 토큰 | 위와 같음 + 팝업 COOP 처리 **[확인 필요]** |
| GIS 코드(Google 로그인 사용자 → 서버 보관) | `initCodeClient({ ux_mode: "popup" })` → `driveLink({ code })`, 서버는 `redirect_uri: "postmessage"` | 위와 같음 | 위와 같음 |
| Picker | `apis.google.com/js/api.js` → iframe(`docs.google.com`) | iframe 허용 필요 | 제3자 쿠키 · 세션 필요 여부 **[확인 필요]** |
| 승인된 JavaScript 원본 | `http://localhost:8081`, `https://llmwiki-minsu.web.app` (`README.md`) | 원격 origin 을 그대로 쓰므로 **새 원본 등록이 필요 없다**(이 방식의 큰 장점) | — |

### 막히면 — 대안(0단계 결과로 고른다)

| 안 | 방법 | 바꿔야 할 것 | 위험 · 비용 |
|---|---|---|---|
| A. 창 안 팝업 그대로 | 위 허용 목록만 | 셸만 | Google 차단 시 불가 |
| B. 로그인만 시스템 브라우저 | 셸 메인이 "데스크톱" 유형 OAuth 클라이언트 + PKCE + loopback(`http://127.0.0.1:<임의 포트>`)으로 Google ID 토큰(openid email)을 받아 → 브리지 `signInCredential()` 로 웹에 넘기고 웹이 `signInWithCredential(GoogleAuthProvider.credential(idToken))` | 새 OAuth 클라이언트(데스크톱 유형), Firebase Auth 의 Google 제공자에 그 클라이언트 ID 를 허용 목록으로 추가 **[확인 필요]**, 브리지 함수 1개 추가(토큰이 브리지를 지나감 — 원칙 4와 충돌 여부 Q3), 익명 → Google 연결(`linkWithCredential`) 처리 | ID 토큰이 셸 메모리를 지나감(저장 · 로그 금지). 범위가 늘지 않는다 |
| C. Drive 코드도 시스템 브라우저 | 같은 loopback 으로 `drive.file` 코드를 받아 서버 `driveLink` 로 | 서버 `driveLink` 가 `redirect_uri`(loopback) · `code_verifier` · 데스크톱 클라이언트 ID 를 받게 바꿔야 함(`functions/src/driveTokens.ts` 는 지금 `postmessage` 고정) | 서버 변경 · 클라이언트 둘 → 원칙 3 · 4 표 갱신 필요(Q3) |
| D. 데스크톱에서는 Drive 연결을 웹 브라우저에서 먼저 하게 안내 | 웹(크롬)에서 Drive 를 서버에 이어 두면, 셸 안에서는 `driveToken`(팝업 없음)만 쓴다. Firebase 로그인만 B 로 | 서버 변경 없음 | 처음 한 번 브라우저를 오가야 함 |

권장 순서: A 시험 → 막히면 **B + D**(서버 변경 없음) → 그래도 부족하면 C. UA 위장은 하지 않는다.

---

## 8. 저장소 배치 · 빌드 · 개발 모드

```
desktop/
  package.json            # electron, electron-builder, esbuild (devDependencies). "type": "module"
  electron-builder.yml
  src/
    main.mjs              # 창 · 정책 · IPC
    policy.mjs            # 허용 origin · 새 창/탐색 판정(순수 함수 → 단위 시험)
    validate.mjs          # 브리지 입력 검증(순수 함수 → 단위 시험)
    runner.mjs            # tools/handoff/lib.mjs 를 감싼 큐(동시 실행 · 취소 · 보관)
    confirm.mjs           # 외부 전송 확인 창
    executables.mjs       # claude · codex 경로 찾기 · 버전
    preload.cjs           # sandbox preload 는 CommonJS
    bridge-types.ts       # 3.2 타입(원본)
  static/offline.html
  test/*.test.mjs         # node --test
  e2e/*.spec.mjs          # Playwright _electron [추정]
```

- 위치를 `desktop/` 로 한 이유: 루트에 `aria-rn/` · `functions/` · `packages/` · `tools/` 가 나란히 있고 workspaces 를 쓰지 않는다(`package.json`). `apps/desktop/` 은 `apps/` 가 없어 새 층이 생긴다 → Q1.
- Electron 버전: 작업 시점의 최신 안정판으로 **정확한 버전 고정**(`^` 금지) **[확인 필요]**. 패키징: electron-builder(mac `dmg` + `zip`, arm64 **[확인 필요: 개발 맥 칩]**).

| 루트 `package.json` 스크립트(추가) | 하는 일 |
|---|---|
| `desktop:install` | `npm --prefix desktop install` |
| `desktop:dev` | `LLMWIKI_DESKTOP_URL=http://localhost:8081 npm --prefix desktop run dev` — 로컬 Expo 웹에 붙는다 |
| `desktop:start` | 배포된 웹에 붙어 셸만 개발 실행 |
| `desktop:build` | esbuild 로 메인 묶기 → electron-builder |
| `test:desktop` | `npm --prefix desktop test` + `node --test tools/handoff/*.test.mjs` |
| `test` | 기존 `test:core && test:functions && test:api` 에 `test:desktop` 을 더할지 Q9(Electron 설치가 무거움) |

개발 모드 조합(터미널 셋, `README.md` 의 기존 명령 그대로):

```bash
npm run emulators
```
```bash
npm --prefix aria-rn run web:emulator
```
```bash
npm run desktop:dev
```

- `LLMWIKI_DESKTOP_URL` 은 개발 빌드에서만 읽는다(패키징 빌드는 무시하고 `https://llmwiki-minsu.web.app` 고정).
- 개발용 가짜 실행자: `LLMWIKI_DESKTOP_FAKE_EXECUTORS=1`(개발 빌드에서만) → claude · codex 를 `tools/handoff/fixtures/fake-cli.mjs` 로, gemma 를 가짜 `run` 으로 바꾼다. 패키징 빌드에는 이 분기가 들어가지 않게(빌드 상수).
- 로컬 Drive(`npm run local-drive`, `EXPO_PUBLIC_LOCAL_DRIVE_URL`)를 쓰면 OAuth 없이 실행 흐름 전체를 시험할 수 있다(`README.md` "로컬 Drive 로 검증하기"). 이때 셸 허용 origin 에 `http://127.0.0.1:8790` 은 **넣지 않는다** — 웹 페이지가 fetch 로 부르는 것이라 탐색 허용과 무관 **[확인 필요: CORS 만으로 되는지]**.

---

## 9. 테스트 · 완료 기준

| # | 시험 | 완료 기준(숫자) |
|---|---|---|
| T1 | `tools/handoff/lib.test.mjs` | 가짜 CLI 로 claude · codex 경로 각 1, 머리줄(없을 때 붙음 · 있을 때 그대로) 2, 시간 제한 1, 취소 1, 출력 상한 1, Gemma(가짜 ssh) 성공 · 실패 · 너무 김(종료 3) 3 → **10개 이상 통과** |
| T2 | `run.mjs` 회귀 | `node tools/handoff/run.mjs claude x.md --dry-run` 출력이 바뀌기 전과 **글자 단위로 같다**. `--fetch` 경로 유지 |
| T3 | IPC 끝까지(가짜 실행자, 로컬 Expo 웹 + 에뮬레이터) | 업무 1개에서 묶음 → 바로 실행 → 확인 창 [보내기] → 결과 자동 가져오기 → 검토 카드에 제안 표시. 3개 실행자 모두. 확정 · 완료로 바뀐 것 **0**. 같은 결과 두 번 → `duplicate`, 늘어난 것 **0** |
| T4 | 실제 Gemma 1건(실서버 `oci-a1`) | 묶음 ≤ 5천 자 자료로 1건 → **45분 안에** 결과 → 자동 가져오기 → 제안 ≥ 1, 실행 기록에 모델 · 걸린 시간(머리줄) 표시, 판단 기록(`JudgmentsCard`)에 실행자 gemma 로 쌓임. 서버에 다른 작업 종류가 들어가지 않음(`jobd.py status` 로 확인) |
| T5 | 허용 밖 origin 차단 | ① `https://example.com` 로 탐색 ② `window.open('https://example.com')` ③ `http://llmwiki-minsu.web.app`(http) ④ `file:///etc/hosts` ⑤ 허용 origin 페이지 안 다른 origin iframe 에서 `window.llmwikiDesktop` 접근 ⑥ 가짜 페이지에서 IPC 채널 직접 호출 → **6/6 차단**, 브리지 노출 0 |
| T6 | 입력 검증 | 실행자 이름 이상(`bash`, `claude;rm`, 빈 값) · runId 형식 이상 · 200,001 바이트 묶음 · 동시 3건 · 확인 창 거절 → **각각 정해진 오류 코드**, 프로세스 생성 0 |
| T7 | 웹만 배포 | 화면 문구 하나를 바꿔 `npm run deploy:web` → 셸 **재설치 없이** 창 새로고침(또는 재시작) 한 번에 바뀐 문구가 보이고 `shellVersion` 은 그대로 |
| T8 | 셸 없는 웹 | 크롬에서 배포 웹을 열면 HandoffPanel 이 지금과 같다(바로 실행 단추 0, 명령 안내 있음). `npm test` 전부 통과 |
| T9 | 오프라인 | 네트워크를 끊고 셸 시작 → **10초 안에** 오프라인 안내, [다시 시도]로 복구 |
| T10 | 끊긴 뒤 이어 받기 | Gemma 실행 중 셸 종료 → 다시 켜면 같은 jobId 를 이어 받아 결과 자동 가져오기(가짜 Gemma 로 시험 가능) |
| T11 | 비밀 · 내용 로그 | 위 시험 뒤 `userData/logs/` 에서 `ya29.` · `refresh_token` · 묶음 첫 줄(`# `) · 결과 블록(`llmwiki-result`) 검색 → **0건** |
| T12 | 로그인(0단계) | Firebase Google 로그인 · GIS 코드 · Picker 각각 성공/차단 결과와 화면 기록을 표로 남김 |

완료 = T1–T11 통과 + T12 결과에 따른 안(A/B/D) 구현 + `docs/architecture.md` · `README.md` 갱신 + 기능 브랜치에서 `npm test` 통과(원칙 6).

---

## 10. 작업 순서 · 산출물

| 단계 | 할 일 | 산출물 | 넘어가는 조건 |
|---|---|---|---|
| 0 | **로그인 시험(spike)**: 최소 Electron 창에 배포 웹을 띄워 Firebase Google 로그인 · GIS 코드(Drive 연결) · Picker 를 실제로 눌러 본다. 새 창 · iframe URL 을 모두 기록 | 결과 표(T12), 허용 목록 실측값, 안 A/B/D 선택 제안 | 사람이 안을 고름(Q3) |
| 1 | 문서 먼저: `docs/architecture.md` 에 "데스크톱 셸" 절(셸이 가지는 것 · 안 가지는 것 · 로컬 보관 · 외부 전송 확인) | 문서 변경 | 사람 확인 |
| 2 | 공유 모듈: `tools/handoff/lib.mjs`, `oracle.mjs` 추가 함수, `run.mjs` 얇게, 시험 | T1 · T2 통과 | — |
| 3 | 셸 골격: 창 · 정책(`policy.mjs`) · 오프라인 페이지 · 권한 거절 · 단일 인스턴스. 브리지 없음 | T5(①–④) · T9 통과 | — |
| 4 | 브리지 · 실행: preload, IPC 확인, 검증, 확인 창, runner(동시 · 시간 · 취소), 로컬 보관 · 이어 받기 | T5(⑤⑥) · T6 · T10 · T11 통과 | — |
| 5 | 웹 쪽: `desktop.ts`, `WorkContext`(runId · 자동 가져오기 · pending), `HandoffPanel` 단추 · 진행, i18n | T3 · T8 통과 | — |
| 6 | 로그인 대안(0단계 결과가 B/D 이면) | T12 재시험 성공 | — |
| 7 | 실서버: Gemma 1건(T4). Claude · Codex 실제 실행은 사람 허가 뒤(외부 전송 — `status.md` "외부 전송 허가 전") | T4 기록 | 사람 허가 |
| 8 | 패키징: electron-builder(서명 없이 먼저), 버전 표시, README "데스크톱" 절 | `.dmg`/`.zip`, T7 통과 | — |
| 9 | (선택) 서명 · 공증 · 자동 업데이트 | — | Q5 |

작업 규칙: 기능 브랜치(예: `feat/desktop-shell`)에서, 단계마다 커밋. 배포 · 실서버 작업 · 사용자 Drive 쓰기는 사람 확인 뒤(원칙 6).

---

## 11. 사람이 결정할 질문

| # | 질문 | 기본안(정하지 않으면) | 왜 묻나 |
|---|---|---|---|
| Q1 | 폴더 이름 `desktop/` vs `apps/desktop/` | `desktop/` | 루트 구조와 맞추기 |
| Q2 | 데스크톱의 Claude 조사 모드에서 `Read · Grep · Glob` 를 뺄까(웹 조사만)? | 뺀다(빈 임시 폴더에서 돌려도 절대 경로 읽기 가능성 **[확인 필요]**) | 원칙 3. 묶음에 발췌가 다 있어 로컬 파일을 읽을 이유가 적다. `run.mjs`(터미널)와 모드가 달라진다 |
| Q3 | 로그인이 창 안에서 막히면: 안 B(셸이 ID 토큰을 받아 웹에 넘김) · C(서버 `driveLink` 를 loopback 코드도 받게) · D(Drive 연결은 브라우저에서 먼저) 중 무엇을 허락하나? | B + D | B 는 토큰이 브리지를 지나간다(원칙 4 "앱은 열쇠를 볼 수 없다"는 refresh token 이야기라 직접 충돌은 아니지만 표에 적어야 함). C 는 서버 · OAuth 클라이언트가 늘어난다(원칙 3 · 4 표 갱신) |
| Q4 | 앱이 받기 전 결과 원문을 셸이 기기(`userData/runs/`)에 잠시 둬도 되나? 보관 기한은? | 된다, `ack` 즉시 삭제 · 최대 30일 | 원칙 2(데이터는 Drive)와의 경계. 안 두면 새로고침 · 웹 배포 중 결과를 잃는다 |
| Q5 | Apple Developer 계정으로 서명 · 공증 · 자동 업데이트를 할까? | 처음엔 안 함(수동 설치) | 비용 · 계정 필요. 셸은 드물게 바뀌므로 늦출 수 있다 |
| Q6 | 외부 전송 확인 창을 매번 띄울까, "이 업무 · 이 실행자는 이번 실행 동안 묻지 않기"를 둘까? Gemma(내 서버)도 묻나? | 매번, Gemma 포함 | 원칙 1 · 3. 편의와 맞바꿈 |
| Q7 | 셸이 "새 웹 배포"를 감지해 다음 새로고침 때 반영할까, 사람이 새로고침할 때만? | 사람이 새로고침 · 재시작할 때만 | 실행 중 끊김 방지 vs 즉시 반영 |
| Q8 | 호환성 계약을 `apiVersion` 하나로 할까 `supports: number[]` 로 할까? | `apiVersion` + 더하기만 하는 변경 규칙 | 웹 · 셸 버전이 따로 움직인다 |
| Q9 | `npm test` 에 `test:desktop` 을 넣을까? | 넣지 않고 따로(`test:desktop`) | Electron 설치가 무겁다 |
| Q10 | Gemma 서버 `~/lwe/jobs/in` · `out` 에 남는 묶음 · 결과(업무 내용)를 결과 받은 뒤 지울까? | 지운다(서버 쪽 `jobd.py` 에 정리 명령 추가는 별도 작업) | 원칙 2 — 지금 `oracle.mjs` 는 올린 묶음을 지우지 않는다 |
| Q11 | 바로 실행 결과를 "자동으로 가져오기"까지 할까, "가져올까요?" 한 번 더 물을까? | 자동(가져오기는 제안일 뿐이고 확정은 사람) | 원칙 1 은 지켜지지만 사용자 기대 확인 |
| Q12 | Windows · Linux 도 지원하나? | macOS 만 | `ssh`/`scp` · CLI 경로 · 서명이 플랫폼마다 다르다 |
