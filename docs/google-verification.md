# Google OAuth 브랜딩 검증 준비

> 2026-10-22 확인. 콘솔: Google 인증 플랫폼(프로젝트 `llmwiki-minsu`).

## 지금 상태

| 항목 | 상태 | 뜻 |
|---|---|---|
| 게시 상태 | **프로덕션 단계** · 외부 | 테스트 모드가 아니다. Drive 열쇠(refresh token)가 7일마다 만료되지 않는다 |
| 데이터 액세스 | 인증 필요 없음 | 앱이 쓰는 `drive.file` · `openid` · `email` 은 민감하지 않은 범위다. 보안 평가(CASA) · 시연 영상이 필요 없다 |
| 브랜딩 | **표시되지 않음** | 동의 화면에 앱 이름 · 로고가 정식으로 보이지 않는다. 아래 브랜딩 검증을 받으면 보인다 |

## 앱 쪽에 준비한 것

| 콘솔 칸 | 값 | 파일 |
|---|---|---|
| 애플리케이션 홈페이지 | `https://llmwiki-minsu.web.app/about` | `aria-rn/public/about.html` |
| 개인정보처리방침 | `https://llmwiki-minsu.web.app/privacy` | `aria-rn/public/privacy.html` |
| 서비스 약관 | `https://llmwiki-minsu.web.app/terms` | `aria-rn/public/terms.html` |

- 세 페이지는 로그인 없이 열리는 정적 HTML 이다(Expo 웹 빌드가 `public/` 을 그대로 복사, `firebase.json` 의 rewrites 로 `/about` · `/privacy` · `/terms` 가 각 `.html` 을 연다. `cleanUrls` 는 쓰지 않는다 — Search Console 확인 파일 `google…html` 이 리다이렉트 없이 그대로 열려야 한다). 한국어 + 영어.
- 방침에는 Google API 사용자 데이터 정책의 **제한적 사용(Limited Use)** 문장과, `drive.file` 로 무엇을 하는지 · 서버가 무엇을 보관하는지(암호화한 Drive 열쇠 · MCP 열쇠 해시) · AI 처리 · 삭제 방법을 적었다. 바꿀 때는 `docs/architecture.md` 와 맞춘다.
- 앱 안: 로그인 화면 아래와 설정 → 계정 아래에 세 링크(`aria-rn/src/components/LegalLinks.tsx`). 로그인 화면 소개 문구도 지금 컨셉으로 바꿨다.
- 문의 이메일은 동의 화면의 사용자 지원 이메일과 같은 `minsu.rob@gmail.com`.

## 사람이 콘솔에서 할 일(순서대로)

1. **배포** — 세 페이지와 앱 링크가 올라가야 한다(`npm run deploy:web`).
2. **도메인 소유 확인** — [Google Search Console](https://search.google.com/search-console) 에서 URL 접두어 `https://llmwiki-minsu.web.app/` 를 추가하고 'HTML 파일' 방식을 고른다. 받은 `google<숫자·글자>.html` 을 `aria-rn/public/` 에 넣고 다시 배포한 뒤 '확인'. (`web.app` 은 DNS 를 바꿀 수 없어 HTML 파일 방식이 맞다.)
3. **브랜딩 칸 채우기** — 콘솔 → 브랜딩:
   - 앱 이름 `llmwiki`, 사용자 지원 이메일 그대로
   - 홈페이지 · 개인정보처리방침 · 서비스 약관: 위 표의 주소
   - 승인된 도메인: `llmwiki-minsu.web.app` (Firebase 로그인용 `llmwiki-minsu.firebaseapp.com` 이 이미 있으면 그대로 둔다)
   - 개발자 연락처 이메일
   - **로고는 지금 올리지 않는다** — 앱 아이콘(`aria-rn/assets/icon.png`)이 Expo 기본 템플릿 아이콘이다. 로고를 올리면 검증이 필요해지고, 템플릿 그림은 반려 사유가 될 수 있다. 실제 로고(120×120 PNG)를 만든 뒤 올린다.
4. **데이터 액세스(선택)** — 범위 목록이 비어 있다. 앱이 실제로 요청하는 `.../auth/drive.file` · `openid` · `.../auth/userinfo.email` 을 '민감하지 않은 범위'로 등록해 두면 검토자가 보기 쉽다.
5. **인증 센터 → 브랜딩 인증 제출**. 민감하지 않은 범위만 쓰므로 보통 며칠 안에 끝난다. 결과는 개발자 연락처 이메일로 온다.

## 진행 기록(2026-10-22)

- Search Console: URL 접두어 `https://llmwiki-minsu.web.app/` 소유 확인 완료(HTML 파일 `aria-rn/public/google669b85aaa8d5054c.html` — 지우면 확인이 풀린다).
- 브랜딩: 홈페이지 `/about` · 방침 `/privacy` · 약관 `/terms` · 승인 도메인(`llmwiki-minsu.web.app` · `llmwiki-minsu.firebaseapp.com`) · 개발자 연락처 저장 완료. 로고 없음.
- 데이터 액세스: `drive.file` · `userinfo.email` · `userinfo.profile` · `openid` 등록 — 모두 '민감하지 않은 범위'.
- **브랜딩 인증 제출은 못 함** — Google 문서는 브랜딩 페이지의 'Verify Branding' 단추로 제출한다고 하지만, 이 프로젝트의 브랜딩 페이지 · 인증 센터 어디에도 그 단추가 없었다(저장 · 변경사항 취소뿐). 저장은 바로 반영됐다. 인증 센터는 여전히 '브랜딩이 사용자에게 표시되고 있지 않습니다'.
- 다음에 볼 것: 하루쯤 뒤 인증 센터 상태가 바뀌는지. 그대로면 실제 로고(120×120)를 올리면 검증 흐름(초안 → 인증 → 게시)이 열리는지 확인.

## 확인할 것
- 배포 뒤 `https://llmwiki-minsu.web.app/about` · `/privacy` · `/terms` 가 로그인 없이 열리는지, 앱(`/`)은 그대로인지.
- 기존 Drive 연결은 이미 프로덕션 상태에서 받은 열쇠라 다시 연결할 필요 없다.
