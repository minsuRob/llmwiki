# 정답 검토 현황

| 묶음 | 수 | 정답 출처 | 검토 |
|---|---|---|---|
| 질의응답 | 20 | Claude 작성(잠정) | 2 확정(qa01·qa02 맞음) |
| 추가 확인 필요 줄 | 31 | Claude 작성(잠정) | 0 |
| 검토 우선순위 | 16 | Claude 작성(잠정) | 0 |
| 공고 판단 4과제 | 156 공고 | 사이트 메타데이터(잠정) | 라벨 정의 먼저 필요(개발 직군·경력) |

- 재채점 결과(2건 반영): 정답 변화 0, 확정 2문항은 Gemma 두 방식 모두 정답.
- 검토 화면은 판단을 artifact db `decisions` 컬렉션에 저장(`<set>--<id>`, `verdict: ok|fix|unsure`, `value`, `note`).

## 다시 채점하기

1. 검토 화면 db 를 읽어 `review/decisions.json` 으로 저장(ArtifactData list).
2. `python3 -I tools/local-model-eval/src/apply_review.py <data> <results> review/decisions.json`
   - ok → 확정 · fix → 라벨 교체(질의응답은 사람 답 저장 + 채점 키 재설정 필요 표시) · unsure → 채점 제외
3. 출력: `data/doc_cases_reviewed.json`, `results/metrics_reviewed.json`
