# llmwiki — 환경 · 서버 · 계정 색인

프로젝트 자원(GitHub · Firebase · GCP), 오라클 서버, 개발 기기, 로컬 실행 방법을 찾는 첫 장. 필요한 문서만 읽는다.

**저장소는 공개(PUBLIC)다.** IP · 계정 · 호스트 주소 같은 접속 값은 md 에 쓰지 않는다. GCP Secret Manager(`llmwiki-minsu`)에 두고 이렇게 꺼낸다:

```bash
npm run infra -- list
```

```bash
npm run infra -- oci-a1 --ssh
```

| 알고 싶은 것 | 문서 | 분량 |
|---|---|---|
| 저장소 · Firebase 프로젝트 · 배포 주소 · 배포 규칙 | [docs/infra/project.md](docs/infra/project.md) | 짧음 |
| 오라클 무료 서버(Oracle A1) — 사양 · 돌아가는 것 · 접속 복구 | [docs/infra/oracle-a1.md](docs/infra/oracle-a1.md) | 중간 |
| GCP · Firebase 자원 · 함수 시크릿 · gcloud 주의 | [docs/infra/google-cloud.md](docs/infra/google-cloud.md) | 짧음 |
| 개발 기기 · 원격(Tailscale · SSH 별칭) | [docs/infra/machines.md](docs/infra/machines.md) | 짧음 |
| 로컬 실행 · 포트 · MCP 등록 · 열쇠 파일 위치 | [docs/infra/dev-setup.md](docs/infra/dev-setup.md) | 중간 |
| 민감 정보 규칙 — 시크릿 이름 · 읽기 · 넣기 | [docs/infra/secrets.md](docs/infra/secrets.md) | 짧음 |

코드 구조 · 규칙은 [CLAUDE.md](CLAUDE.md), 원칙은 [docs/architecture.md](docs/architecture.md) 에 있다. 여기에는 "무엇이 어디에 있나"만 둔다.
