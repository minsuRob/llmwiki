# 오라클 무료 서버 — Oracle A1

> 2026-11-01 정리. 색인: [INFRA.md](../../INFRA.md) · 검증 기록: [docs/local-models](../local-models/README.md)

Oracle Cloud Always Free 의 Arm 인스턴스. llmwiki 의 **Gemma 실행자**와 로컬 모델 검증이 여기서 돈다. 이 컴퓨터에서 AI 를 돌리지 않고, 묶음을 올려 작업 큐로 처리한다.

## 사양

| 항목 | 값 |
|---|---|
| 모양 | Ampere A1(Arm) 2코어 · RAM 12GB · GPU 없음 |
| 인스턴스 | `llm-bench-a1` · 리전 오사카(`ap-osaka-1`) · Ubuntu 24.04 aarch64 · 2026-10-19 생성 |
| 콘솔 | `https://cloud.oracle.com/compute/instances?region=ap-osaka-1` (로그인: `https://cloud.oracle.com/`) |
| SSH 별칭 | `oci-a1` (코드 기본값. `OCI_JOBS_HOST` 로 바꾼다) |
| 접속 값(IP · 계정 · 키 · OCID · 테넌시) | 시크릿 `infra-oci-a1` — [secrets.md](secrets.md) |
| SSH 키 | 기기마다 다르다 — macserver `~/.ssh/oci_a1`, 개발 맥 `~/.ssh/id_ed25519`(시크릿 `ssh_keys`) |
| 작업 폴더 | `~/lwe` |

## 서버에서 도는 것

| 무엇 | 설정 |
|---|---|
| Gemma | `gemma-4-E4B q4_0` · llama.cpp `098ce526b` · `llama-server -t 2 -c 8192 -np 1 --jinja` · temperature 0 · thinking 끔 · 모델 `~/models/gemma4/*.gguf` |
| Laya | `laya==0.4.12` · 리비전 `7b928d828b7b` · CPU float32 · 스레드 2 · `HF_HUB_OFFLINE=1` |
| 작업 큐 | `~/lwe/jobd/jobd.py` — 정해진 작업 종류만, 한 번에 하나, 종류에 맞춰 Gemma 를 켜고 끈다 |
| 자동 실행 | systemd `lwe-jobd`(`jobd/lwe-jobd.service`) — 부팅 때 켜고 죽으면 10초 뒤 다시. `JOBD_KEEP_GEMMA=1` 이라 Gemma 를 늘 켜 둔다. 재부팅 뒤 Gemma 준비까지 약 2분(콜드 로드) |

`~/lwe` 안: `src/` · `data/` · `jobd/`(저장소 `tools/local-model-eval/` 를 올린 것) · `jobs/in/`(올린 묶음) · `results/raw/`.

작업 종류는 `jobd.py` 의 `KINDS` 에 있다. 제품이 쓰는 것은 `handoff_gemma`(묶음 → 답, 약 6분, 문맥 8K · 묶음 5천 자). 나머지(`gemma_doc` · `laya_*` · `perf_*` · `env_probe`)는 검증용.

## 이어지는 코드

| 무엇 | 파일 |
|---|---|
| 묶음 올리기 · 작업 넣기 · 결과 받기(ssh · scp) | `tools/handoff/oracle.mjs` |
| 터미널 실행 | `node tools/handoff/run.mjs gemma <묶음.md>` · 끊기면 `--fetch <작업 id>` |
| 서버 쪽 | `tools/local-model-eval/jobd/jobd.py` · `gemma_handoff.py` · `lwe-jobd.service`(바꾸면 `scp` 로 `~/lwe/jobd/` 에 올리고 `sudo systemctl restart lwe-jobd`) |
| MCP(`oci-jobs`) | `tools/local-model-eval/jobd/oci-jobs-mcp.mjs` — `oci_job_kinds · submit · status · result · cancel · oci_fetch_results` |

## 접속 복구 — `ssh oci-a1` 이 안 될 때

0. 새 기기라면 먼저 준비한다. 이미 있으면 건너뛴다:
   - gcloud: `brew install --cask google-cloud-sdk` → `gcloud auth login`(`llmwiki-minsu` 권한 계정)
   - SSH 키: `ls ~/.ssh/id_ed25519.pub` 가 없으면 `ssh-keygen -t ed25519`
   - 키 등록: 이미 접속되는 기기에서 `ssh oci-a1 'cat >> ~/.ssh/authorized_keys' < 새기기.pub` 하고, 시크릿 `ssh_keys` 에 새 기기(`hostname -s`)를 더한다
1. 접속 값 확인 — Host 블록이 찍힌다:

```bash
npm run infra -- oci-a1 --ssh
```

2. 찍힌 블록을 `~/.ssh/config` 에 붙인다(자동으로 고치지 않는다).
3. 확인 — `handoff_gemma` 가 목록에 보이면 된다:

```bash
ssh oci-a1 'python3 ~/lwe/jobd/jobd.py kinds'
```

4. 키가 없는 기기면 `Permission denied (publickey)` 가 난다. macserver 를 거쳐 쓰거나(`ssh macserver 'ssh oci-a1 …'`), 그 기기 공개 키를 서버 `~/.ssh/authorized_keys` 에 더한다.
5. IP 가 바뀌었으면(인스턴스를 다시 만들면 바뀐다) 콘솔 인스턴스 목록의 Public IP 를 보고 [secrets.md](secrets.md) "새 버전 넣기"로 고친다.

## 회수(삭제) 위험 — 2026-11-01 확인

- 공식 기준([Always Free 문서](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)): 7일 동안 **셋 다** 20% 미만이면 유휴로 보고 회수할 수 있다 — CPU p95 · 네트워크 · 메모리(A1 만).
- 무료 계정은 30일 넘게 안 쓰면 계정 자체가 정지될 수 있다([FAQ](https://www.oracle.com/cloud/free/faq/)).
- 이 계정은 **Pay As You Go**(2026-10-19 전환). 유료 계정이 예외라는 문장은 공식 문서에 없다 — 기준을 넘게 유지하는 게 안전하다.
- 실측(sar, 10-26~11-01): CPU p95 0.57% · 네트워크 약 0% · 메모리 약 30% → **메모리 하나로 기준을 넘는다.** Gemma(`llama-server`)를 끄면 메모리가 5% 남짓으로 떨어져 셋 다 미만이 된다. 그래서 `lwe-jobd` 가 Gemma 를 늘 켜 둔다(`JOBD_KEEP_GEMMA=1`).
- 유료 계정이라 무료 한도(A1 2 OCPU · 12GB, 블록 볼륨 200GB)를 넘으면 과금된다. 지금 인스턴스는 한도 안이다.

## 알려진 상태 (2026-11-01)

- 2026-11-01: `lwe-jobd` 서비스 등록 → 재부팅해 커널 7.0 적용(`reboot-required` 없음) → 부팅 때 자동 실행 · Gemma 준비 확인.
- 서비스 확인 · 다시 켜기: `ssh oci-a1 'systemctl status lwe-jobd'` · `sudo systemctl restart lwe-jobd` · 로그 `journalctl -u lwe-jobd`.
- 접속 확인: macserver · 개발 맥 모두 `ssh oci-a1` 성공(호스트 `llm-bench-a1`, aarch64, 2코어, 11GB, `~/lwe` · `jobd` 작업 종류 14개). 개발 맥 공개 키는 2026-11-01 서버 `authorized_keys` 에 더했다.
- `oci-jobs` MCP 는 이 폴더에 등록돼 있지 않다. 등록 명령은 [dev-setup.md](dev-setup.md).
- OCI CLI(`oci`)는 설치돼 있지 않다.
- 검증 원시 결과 폴더(`oci-llm-bench/llmwiki-eval/`)는 이 맥에 없다(다른 개발 기기에 있을 수 있다).
- 할 일 · 알려진 문제: [docs/local-models/next.md](../local-models/next.md)
