# 판단 기록 축적

판단 1건 = 1행. 학습 · 검색 · few-shot · 평가에 섞이지 않게 한 행은 한 용도만.

```ts
interface DecisionRecord {
  id: string; createdAt: string;
  sourceRefs: { doc: string; line?: number; itemId?: string; contentHash: string }[]; // 원문은 참조+해시
  inputText?: string;          // consent.storeInput 일 때만
  inputTokens: number;
  task: string;                // is_it_dev | career | relevance | uncertain | priority | injection …
  questionVersion: string;     // 질문·선택지 문구 버전(번역본 포함)
  options?: string[];          // 선택지 순서 그대로
  model: { name: string; revision: string; runtime: string; params?: Record<string, unknown> };
  output: { choice?: string; prob?: number; score?: number; confidence?: number; text?: string };
  latencyMs: number;
  review?: { action: "approved" | "rejected" | "edited" | "ignored"; reason?: string; editedOutput?: unknown; at: string };
  goldLabel?: { value: unknown; by: "user" | "source_meta"; status: "provisional" | "confirmed"; evidenceRef?: string };
  reverted?: { at: string; byEventId: string }; // 되돌림은 이벤트, 현재 상태는 이벤트로 계산
  consent: { storeInput: boolean; train: boolean; fewShot: boolean };
  usage: "eval" | "train" | "retrieval" | "fewshot" | "none";
  group: string;               // 같은 문서·파생 발췌·번역본은 같은 묶음(분리 단위)
}
```

- **승인 ≠ 정답, 반려 ≠ 오답.** 학습에는 `goldLabel.status=confirmed` 만.
- 남이 쓴 글(단톡방 등)은 기본 `train=false`.

## 학습 계획 (단정하지 않음)

| 단계 | 확정 라벨/과제 | 할 일 | 넘어갈 조건 |
|---|---|---|---|
| 0 | 0 | 현재 수치를 기준선으로 고정 | — |
| 1 | 100 | 같은 시험 묶음 재측정, 확률 보정만 다시 | Brier 개선 |
| 2 | 300 | 100·200·300건 미세조정 3회로 곡선 | +0.05 macro-F1, 곡선 상승 |
| 3 | 1,000 | 오르면 확대, 평평하면 규칙·검색 개선으로 | — |

부족한 라벨: 주니어 경력만 · AI 직무명 · 마감일 명시 양성, 영어 중심 · 혼합 문서.
