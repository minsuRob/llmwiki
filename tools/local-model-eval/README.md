# local-model-eval

로컬 모델(Gemma · Laya)과 위임 흐름을 실제 자료로 검증하는 도구. 결과·결정은 [docs/local-models](../../docs/local-models/README.md).

**`data/` · `results/` · `review/` 는 개인 자료라 저장소에 올리지 않는다(.gitignore).** 로컬에서 `build_cases.py` 로 만든다.

| 경로 | 내용 |
|---|---|
| `src/build_cases.py` | 자료 → 평가 사례(`data/`). 원본은 읽기만 |
| `src/common.py` | Laya 질문(한·영·재표현) · 키워드 기준선 · BM25 |
| `src/handoff.py` · `test_handoff.py` | 묶음·검증 Python 판(제품 코드는 `packages/core/src/handoff.ts`) |
| `src/laya_eval.py` · `gemma_eval.py` · `perf.py` | 실험 파트(작업 큐에서 호출) |
| `src/score.py` · `apply_review.py` | 채점 · 사람 검토 반영 |
| `src/env_probe.sh` | 서버 환경·모델 목록 |
| `jobd/` | 서버 작업 큐 · MCP 서버 |
| `prototype/` | 실행자 어댑터 · runner · JS 검증기 |

## 실행

```bash
python3 -I src/build_cases.py "<구직 자료 폴더>" data
```

```bash
node --test prototype/prototype.test.mjs
```

서버(`~/lwe`)에 `src/ data/ jobd/` 를 올리고 작업 큐로 하나씩:

```bash
ssh oci-a1 'python3 ~/lwe/jobd/jobd.py submit gemma_doc'
```

```bash
rsync -a --exclude '*.log' oci-a1:lwe/results/raw/ results/raw/ && python3 -I src/score.py data results
```
