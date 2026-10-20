# 현재 상태 (2026-10-20)

## 됨

- **풀테스트 1회 완료**: 작업 14개(챕터 1~10) 모두 성공, 실패 0. 서버 Oracle A1(Arm 2코어 · 12GB · GPU 없음).
- **제품 코드**: `packages/core/src/handoff.ts` — `buildBundle`(맥락 묶음) · `validateResult`(위임 결과 검증). 시험 6개, core 전체 26개 통과.
- **검증 도구**: `tools/local-model-eval/` — 사례 생성 · Laya/Gemma 실험 · 성능 · 채점 · 검토 반영.
- **실행자 어댑터 시제품**: `tools/local-model-eval/prototype/` — Claude · Codex(+ Grok · Muse 자리). dry-run · 가짜 실행자 시험만.
- **작업 큐 + MCP**: 서버 `jobd.py`(정해진 작업만, 순차) + 로컬 MCP `oci-jobs`(Claude Code 에 등록).
- **정답 검토 화면**: 잠정 정답 67건을 원문 줄과 함께 확인(사용자 private artifact). 현재 2/67 검토.

## 안 됨 / 미검증

- 실제 Claude · Codex 위임 실행(외부 전송 허가 전). Codex 는 개발 맥에 미설치.
- `handoff.ts` 를 앱 화면(위임 · 가져오기 · 검토 카드)에 연결.
- Electron 셸. 웹은 로컬 CLI · stdio MCP 를 못 띄워서 필요.
- 정답 대부분이 잠정 → 수치는 경향으로만 읽는다([review.md](review.md)).

## 위치

| 무엇 | 어디 |
|---|---|
| 서버 실험 폴더 | 서버 `~/lwe` (SSH 별칭 `oci-a1`) |
| 개인 자료 · 원시 결과 · 전체 보고서 | 개발 맥 로컬 `oci-llm-bench/llmwiki-eval/` (저장소에 올리지 않음) |
| 서버 모델 | Gemma `~/models/gemma4/*.gguf`, Laya HF 캐시(리비전 `7b928d8`) |
