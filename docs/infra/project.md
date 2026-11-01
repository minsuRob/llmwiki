# 프로젝트 자원

> 2026-11-01 정리. 색인: [INFRA.md](../../INFRA.md)

| 무엇 | 값 | 근거 |
|---|---|---|
| 저장소 | GitHub `minsuRob/llmwiki` — **공개** | `git remote -v` |
| 기본 브랜치 | `main` (작업은 기능 브랜치 → 시험 통과 뒤 main) | [CLAUDE.md](../../CLAUDE.md) |
| Firebase 프로젝트 | `llmwiki-minsu` (이름 llmwiki) | `.firebaserc` |
| 웹 주소 | `https://llmwiki-minsu.web.app` — `/about` · `/privacy` · `/terms` 는 정적 페이지 | `firebase.json` rewrites · `aria-rn/public/*.html` |
| Hosting 내용 | `aria-rn/dist` (배포 전 `build:web`) | `firebase.json` |
| Functions | `asia-northeast3` · Node · esbuild 번들 | [functions/CLAUDE.md](../../functions/CLAUDE.md) |
| Firestore | 규칙 `firestore.rules` — 앱은 자기 `users/{uid}` 읽기만 | [functions/CLAUDE.md](../../functions/CLAUDE.md) |
| 사용자 데이터 | 각 사용자 Google Drive `llmwiki 작업실` (`drive.file`) — 서버는 저장 · 색인하지 않는다 | [docs/architecture.md](../architecture.md) 원칙 2 |
| OAuth 동의 화면 | 프로덕션 · 외부, 브랜딩 검증 준비 중 | [docs/google-verification.md](../google-verification.md) |

## 폴더

폴더별 역할은 [README.md](../../README.md) 표, 파일 지도는 각 폴더 `CLAUDE.md`.

## 배포 · 시험

```bash
npm run deploy:web
```

```bash
npm run deploy
```

- `deploy:web` 은 hosting 만, `deploy` 는 hosting + functions + firestore.
- **배포 · 푸시는 사용자 확인 뒤.** 시험 명령은 [CLAUDE.md](../../CLAUDE.md) "명령".
- 배포본 확인: `bash tests/cloud-smoke.sh`(테스트 계정 · 데이터는 스스로 지운다).
- `firebase` CLI 는 전역 설치가 아니다(`npx firebase` 또는 설치 필요).
