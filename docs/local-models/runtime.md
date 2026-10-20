# 실행 구조

```
Electron 앱
  Renderer — 업무 · 검토 카드 · 오늘 탭 (RN web 재사용)
  Main(Node) — executors(claude · codex · grok/muse 자리) · runner · validateResult · MCP 서버(앱 맥락 조회)
        │ HTTPS/SSH
Oracle A1 서버 — llama-server(Gemma) + Laya, 작업 큐 jobd.py(순차)
        │
결과는 '제안'으로만 저장 → 사람이 검토 카드에서 확정
```

## 실행자 어댑터 (`tools/local-model-eval/prototype/executors.mjs`)

모양: `command({bundlePath, workdir, mode, mcpConfig, model}) → {cmd, args, stdinFile}` · `readOutput(stdout) → {text, meta}`.

| 실행자 | 명령 | 상태 |
|---|---|---|
| Claude | `claude -p --output-format json` · 조사 모드 허용 `WebSearch,WebFetch,Read,Grep,Glob` · 차단 `Bash,Edit,Write,NotebookEdit` · 묶음은 표준입력 · `--mcp-config` | 명령·가짜 실행자 시험만 |
| Codex | `codex exec --json --sandbox read-only --skip-git-repo-check -` | 공식 문서 기준, 미실행 |
| Grok · Muse | 같은 모양 자리(`status: planned`) | 미연결 |

runner: run 1건 = 위임 1건. `queued → running → review_pending | needs_attention`. **업무 상태는 runner 가 바꾸지 않는다.**

## 작업 큐 · MCP (`tools/local-model-eval/jobd/`)

- `jobd.py`: 정해진 작업 종류만(임의 명령 없음), 한 번에 하나, 작업 종류에 맞춰 Gemma 켜고 끔, 시간·최대 RSS·최저 여유 메모리·스왑 기록.
- 작업 하나는 10~15분 이내로 쪼갠다.
- `oci-jobs-mcp.mjs`(stdio, 의존성 없음): `oci_job_kinds · submit · status · result · cancel · oci_fetch_results`.
- 등록: `claude mcp add oci-jobs -s local -- node <경로>/oci-jobs-mcp.mjs` (호스트 별칭은 `OCI_JOBS_HOST`, 기본 `oci-a1`).

## 서버 고정 설정

- Gemma: llama.cpp `098ce526b`, `llama-server -t 2 -c 8192 -np 1 --jinja`, temperature 0, thinking 끔.
- Laya: `laya==0.4.12`, 리비전 `7b928d828b7b`, CPU float32, 스레드 2, `HF_HUB_OFFLINE=1`.
- Laya 를 Gemma 와 같이 띄울 때 냉간 로드 21초(단독 6초).
