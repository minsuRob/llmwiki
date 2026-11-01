# 오라클 무료 서버 — Oracle A1

> 2026-11-01 정리. 색인: [INFRA.md](../../INFRA.md) · 검증 기록: [docs/local-models](../local-models/README.md)

Oracle Cloud Always Free 의 Arm 인스턴스. llmwiki 의 **Gemma 실행자**와 로컬 모델 검증이 여기서 돈다. 이 컴퓨터에서 AI 를 돌리지 않고, 묶음을 올려 작업 큐로 처리한다.

## 사양

| 항목 | 값 |
|---|---|
| 모양 | Ampere A1(Arm) 2코어 · RAM 12GB · GPU 없음 |
| SSH 별칭 | `oci-a1` (코드 기본값. `OCI_JOBS_HOST` 로 바꾼다) |
| 접속 값(IP · 계정 · 키 · 리전) | 시크릿 `infra-oci-a1` — [secrets.md](secrets.md) |
| 작업 폴더 | `~/lwe` |

## 서버에서 도는 것

| 무엇 | 설정 |
|---|---|
| Gemma | `gemma-4-E4B q4_0` · llama.cpp `098ce526b` · `llama-server -t 2 -c 8192 -np 1 --jinja` · temperature 0 · thinking 끔 · 모델 `~/models/gemma4/*.gguf` |
| Laya | `laya==0.4.12` · 리비전 `7b928d828b7b` · CPU float32 · 스레드 2 · `HF_HUB_OFFLINE=1` |
| 작업 큐 | `~/lwe/jobd/jobd.py` — 정해진 작업 종류만, 한 번에 하나, 종류에 맞춰 Gemma 를 켜고 끈다 |

`~/lwe` 안: `src/` · `data/` · `jobd/`(저장소 `tools/local-model-eval/` 를 올린 것) · `jobs/in/`(올린 묶음) · `results/raw/`.

작업 종류는 `jobd.py` 의 `KINDS` 에 있다. 제품이 쓰는 것은 `handoff_gemma`(묶음 → 답, 약 6분, 문맥 8K · 묶음 5천 자). 나머지(`gemma_doc` · `laya_*` · `perf_*` · `env_probe`)는 검증용.

## 이어지는 코드

| 무엇 | 파일 |
|---|---|
| 묶음 올리기 · 작업 넣기 · 결과 받기(ssh · scp) | `tools/handoff/oracle.mjs` |
| 터미널 실행 | `node tools/handoff/run.mjs gemma <묶음.md>` · 끊기면 `--fetch <작업 id>` |
| 서버 쪽 | `tools/local-model-eval/jobd/jobd.py` · `gemma_handoff.py` |
| MCP(`oci-jobs`) | `tools/local-model-eval/jobd/oci-jobs-mcp.mjs` — `oci_job_kinds · submit · status · result · cancel · oci_fetch_results` |

## 접속 복구 — `ssh oci-a1` 이 안 될 때

1. 접속 값 확인 — Host 블록이 찍힌다:

```bash
npm run infra -- oci-a1 --ssh
```

2. 찍힌 블록을 `~/.ssh/config` 에 붙인다(자동으로 고치지 않는다).
3. 확인 — `handoff_gemma` 가 목록에 보이면 된다:

```bash
ssh oci-a1 'python3 ~/lwe/jobd/jobd.py kinds'
```

4. 시크릿 값이 비어 있으면 Oracle Cloud 콘솔 → 컴퓨트 → 인스턴스에서 공인 IP 를 보고 [secrets.md](secrets.md) "새 버전 넣기"로 채운다.

## 알려진 상태 (2026-11-01)

- 이 맥의 `~/.ssh/config` 에 `oci-a1` 블록이 **없다**(2026-10-14 백업에도 없음). 2026-10-20 실서버 연결은 다른 기기였거나 그 뒤에 지워졌다.
- 공인 IP · 계정을 이 맥 어디에서도 찾지 못했다 → 시크릿 `infra-oci-a1` 의 `host` · `user` 를 채워야 한다.
- `oci-jobs` MCP 는 이 폴더에 등록돼 있지 않다. 등록 명령은 [dev-setup.md](dev-setup.md).
- OCI CLI(`oci`)는 설치돼 있지 않다.
- 검증 원시 결과 폴더(`oci-llm-bench/llmwiki-eval/`)는 이 맥에 없다(다른 개발 기기에 있을 수 있다).
- 할 일 · 알려진 문제: [docs/local-models/next.md](../local-models/next.md)
