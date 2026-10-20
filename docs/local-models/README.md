# 로컬 모델 · 업무 위임 — 문서 안내

LLM Wiki 에 로컬 모델(Gemma 4 E4B · Laya)과 위임 실행(Claude · Codex)을 붙이기 위한 검증 결과와 현재 상태. 필요한 문서만 읽는다.

| 알고 싶은 것 | 문서 | 분량 |
|---|---|---|
| 지금 어디까지 됐나 | [status.md](status.md) | 짧음 |
| 무엇을 어떤 모델·코드가 맡나(확정) | [decisions.md](decisions.md) | 짧음 |
| 근거 수치 | [results.md](results.md) | 표 |
| 실행 구조(Electron · 실행자 · 작업 큐 · MCP) | [runtime.md](runtime.md) | 중간 |
| 판단 기록 축적 스키마 · 학습 계획 | [data.md](data.md) | 중간 |
| 정답 검토 현황 · 재채점 방법 | [review.md](review.md) | 짧음 |
| 다음 할 일 · 못 한 시험 · 알려진 문제 | [next.md](next.md) | 짧음 |

코드: `packages/core/src/handoff.ts`(제품 코드) · `tools/local-model-eval/`(검증 도구, 개인 자료 없음)

원칙: AI 결과는 전부 **제안**이다. 완료·결정·할 일·최신본 확정은 사람이 한다.
