# 민감 정보 — Secret Manager 에 두고 gcloud 로 꺼낸다

> 2026-11-01 정리. 색인: [INFRA.md](../../INFRA.md)

저장소가 공개라서 IP · 계정 · 호스트 주소 · 키 경로는 md 에 쓰지 않는다. `llmwiki-minsu` 의 Secret Manager 에 JSON 으로 두고, md 에는 시크릿 이름만 적는다.

## 규칙

- 이름 `infra-<대상>` · 라벨 `llmwiki-note=infra` · 값은 JSON 한 덩어리.
- 함수 시크릿(`DRIVE_TOKEN_KEY` · `GOOGLE_OAUTH_CLIENT_SECRET`, 라벨 `firebase-managed`)과 섞지 않는다. 서버(Functions)는 `infra-*` 를 읽지 않는다.
- 비밀번호 · 개인 키 내용 · API 토큰은 넣지 않는다. 넣는 것은 "어디에 어떻게 접속하나"뿐(키는 **파일 경로**만).
- 읽으려면 `llmwiki-minsu` 에 권한이 있는 Google 계정으로 `gcloud auth login` 이 돼 있어야 한다.

## 지금 있는 것

| 시크릿 | 필드 | 문서 |
|---|---|---|
| `infra-oci-a1` | `host` · `user` · `ssh_key` · `region` · `shape` · `dir` | [oracle-a1.md](oracle-a1.md) |
| `infra-macserver` | `host` · `user` · `aliases` · `via` | [machines.md](machines.md) |

`--ssh` 는 `host` · `user` · `ssh_key` 로 `~/.ssh/config` Host 블록을 찍는다(별칭은 시크릿 이름에서 `infra-` 를 뺀 것 + `aliases`).

## 읽기

```bash
npm run infra -- list
```

```bash
npm run infra -- oci-a1
```

```bash
npm run infra -- oci-a1 --ssh
```

래퍼 없이: `gcloud secrets versions access latest --secret=infra-oci-a1 --project llmwiki-minsu`

## 새 버전 넣기 · 새로 만들기

값을 바꾸면 새 버전을 더한다(옛 버전은 남는다). 아래는 형태 예시다 — 실제 값으로 바꿔 터미널에서 직접 실행한다:

```bash
printf '%s' '{"host":"<공인 IP>","user":"<계정>","ssh_key":"~/.ssh/id_ed25519","region":"<리전>","shape":"VM.Standard.A1.Flex 2 OCPU/12GB","dir":"~/lwe"}' | gcloud secrets versions add infra-oci-a1 --data-file=- --project llmwiki-minsu
```

새 대상:

```bash
printf '%s' '{"host":"…","user":"…"}' | gcloud secrets create infra-<대상> --data-file=- --labels=llmwiki-note=infra --replication-policy=automatic --project llmwiki-minsu
```

새 시크릿을 만들면 위 "지금 있는 것" 표와 해당 문서에 이름을 적는다.
