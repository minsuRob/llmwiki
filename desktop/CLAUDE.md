# desktop — Electron 셸(동결)

배포된 웹을 띄우고 Claude · Codex · Gemma 실행만 더하는 얇은 껍데기. MCP 가 생겨 우선순위가 낮다 — **새 기능을 넣지 않는다.** 원칙: `docs/architecture.md` 원칙 6.

- 실행 본문은 `tools/handoff/lib.mjs` 와 같다. 브리지 계약은 `src/bridge-types.ts` ↔ `aria-rn/src/features/work/desktop.ts`(복사본, `test/bridge.test.mjs` 가 일치 확인).
- 받은 것 정리 실행은 기존 브리지에 itemId `triage-<범주>` 로 실린다(셸 변경 없음).
- 셸은 웹을 띄우므로 화면 변경은 웹 배포만으로 반영된다. 셸을 다시 빌드할 일은 `src/` 를 바꿀 때뿐.
- 시험: 루트 `npm run test:desktop`. 로컬 빌드: `LLMWIKI_SIGNING=none npm run build`(서명 · 공증은 회사 인증서 + AWS 권한이 필요 — 사용자 확인 뒤).
