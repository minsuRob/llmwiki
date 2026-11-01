# GCP · Firebase 자원

> 2026-11-01 정리. 색인: [INFRA.md](../../INFRA.md)

## 프로젝트

| 프로젝트 | 쓰임 |
|---|---|
| `llmwiki-minsu` | llmwiki 전부 — Hosting · Functions · Firestore · Auth · OAuth 클라이언트 · Secret Manager |
| `robertpersonal-minsu` | 이 맥 gcloud 의 **기본 프로젝트**(llmwiki 와 무관). 그래서 명령마다 `--project llmwiki-minsu` 를 붙인다 |

## Secret Manager (`llmwiki-minsu`)

| 시크릿 | 누가 쓰나 | 규칙 |
|---|---|---|
| `DRIVE_TOKEN_KEY` | Functions — Drive 열쇠 암호화(AES-256-GCM) | 라벨 `firebase-managed=functions`. **손대지 않는다** |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Functions — Google 토큰 교환 | 같음 |
| `infra-*` | 사람 · AI 세션 — 접속 값 메모 | 라벨 `llmwiki-note=infra`. [secrets.md](secrets.md) |

함수 시크릿의 설정 · 교체는 Firebase(`firebase functions:secrets:set`)로 한다. 열쇠 규칙은 [docs/architecture.md](../architecture.md) 원칙 4.

## 앱 설정 값

`aria-rn/.env.local`(커밋하지 않음)에 두 키가 있다. 값은 Google Cloud 콘솔 → API 및 서비스 → 사용자 인증 정보.

- `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_PICKER_API_KEY`

## OAuth

동의 화면 상태 · 브랜딩 검증: [docs/google-verification.md](../google-verification.md). 범위는 `drive.file` · `openid` · `email`.

## gcloud 주의

- 이 맥 gcloud 는 Python 3.9 경고를 낸다. 동작은 하지만 `CLOUDSDK_PYTHON` 을 3.10 이상으로 지정하면 사라진다.
- 로그인 계정은 `gcloud auth list` 로 확인한다.
