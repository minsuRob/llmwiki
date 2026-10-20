# 현재 상태 (2026-10-20, 저녁 갱신)

## 됨

- **풀테스트 1회 완료**: 작업 14개(챕터 1~10) 모두 성공, 실패 0. 서버 Oracle A1(Arm 2코어 · 12GB · GPU 없음).
- **제품 코드**: `packages/core/src/handoff.ts` — `buildBundle`(맥락 묶음) · `validateResult`(위임 결과 검증). 시험 6개, core 전체 26개 통과.
- **검증 도구**: `tools/local-model-eval/` — 사례 생성 · Laya/Gemma 실험 · 성능 · 채점 · 검토 반영.
- **실행자 어댑터 시제품**: `tools/local-model-eval/prototype/` — Claude · Codex(+ Grok · Muse 자리). dry-run · 가짜 실행자 시험만.
- **작업 큐 + MCP**: 서버 `jobd.py`(정해진 작업만, 순차) + 로컬 MCP `oci-jobs`(Claude Code 에 등록).
- **정답 검토 화면**: 잠정 정답 67건을 원문 줄과 함께 확인(사용자 private artifact). 현재 2/67 검토.

- **실행자 연결(1단계, 안 A)**: 앱이 실행자별 묶음(Claude · Codex 2만 자, Gemma 5천 자)을 만들고, `tools/handoff/run.mjs` 가 돌린다. Gemma 는 서버 `jobd` 의 `handoff_gemma`. 결과는 앱 '작업 결과 가져오기'로 → 같은 검사(확정 필드 · 없는 근거 · 근거 없는 마감 · 다른 요청 · 주입 의심) → 제안.
- **Gemma 실서버 1건**: 그룹바이 진행현황(122줄, 묶음 6,384자) → 461초, `llmwiki-result` 파싱 성공, 할 일 3 · 결정 1 · 결과물 1, 근거 줄 모두 유효, 확정 시도 0. 결과물 링크에 "N/A" 를 넣음(링크로 보지 않게 고침).
- `handoff.ts`(validateResult · buildBundle)는 `workHandoff.ts` 로 합쳤다.
- **데스크톱 셸(Electron, `desktop/`)**: 배포된 웹을 띄우고 '바로 실행' → 확인 창 → `tools/handoff/lib.mjs` → 결과 자동 가져오기. 가짜 실행자로 Claude · Codex · Gemma 셋 모두 끝까지(제안으로만 들어옴, 확정 0), 허용 밖 탐색 차단 · 브리지 격리 · 오프라인 안내 확인. 시험 19개. 서명 없는 .dmg/.zip 빌드.

## 안 됨 / 미검증

- 실제 Claude · Codex 위임 실행(외부 전송 허가 전). Codex 는 개발 맥에 미설치.
- 데스크톱 셸 안 Google 로그인 · Drive 동의(계정 주인이 직접 시험), 셸로 실제 Gemma 1건 · 실제 Claude 1건(외부 전송 허가 전).
- 정답 대부분이 잠정 → 수치는 경향으로만 읽는다([review.md](review.md)).

## 위치

| 무엇 | 어디 |
|---|---|
| 서버 실험 폴더 | 서버 `~/lwe` (SSH 별칭 `oci-a1`) |
| 개인 자료 · 원시 결과 · 전체 보고서 | 개발 맥 로컬 `oci-llm-bench/llmwiki-eval/` (저장소에 올리지 않음) |
| 서버 모델 | Gemma `~/models/gemma4/*.gguf`, Laya HF 캐시(리비전 `7b928d8`) |
