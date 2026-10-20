// 서명 · 공증 출처 — 바꿀 곳은 이 파일 하나다. 빌드 때 LLMWIKI_SIGNING=<이름> 으로 고르고, 없으면 DEFAULT.
//
// kind
//   none      서명하지 않는다(ad-hoc 도 안 한다). 이 맥에서만 쓸 때.
//   ssm       AWS SSM Parameter Store 에서 인증서 · 개인 키 · 공증 정보를 받는다(MAKi 와 같은 방식).
//   env       환경 변수(base64)에서 받는다 — 개인 Apple Developer 계정으로 바꿀 때 CI 비밀값으로 넣기 쉽다.
//   keychain  이미 로그인 키체인에 설치된 인증서를 이름으로 쓴다(공증 정보는 환경 변수).
//
// 공통 필드
//   expectTeam  인증서의 팀 ID 가 이것과 다르면 멈춘다(엉뚱한 인증서로 서명하지 않게).
//   notarize    공증까지 할지(애플 ID · 앱 암호 · 팀 ID 가 다 있어야 실제로 한다).
//
// 개인 계정으로 바꾸려면: personal 항목의 expectTeam 을 채우고 DEFAULT 를 'personal' 로.
// 값(인증서 · 키 · 암호)은 여기에 적지 않는다 — 이름(어디서 읽을지)만 적는다.

export const PROFILES = {
  none: { kind: 'none' },

  /** 회사(FEEEL'D INC.) Developer ID — MAKi 스테이징과 같은 SSM 값. 만료 2027-02-01 */
  feeeld: {
    kind: 'ssm',
    prefix: '/front/staging',
    region: 'ap-northeast-2',
    names: {
      cert: 'MAC_CERTIFICATE_BASE64', // Developer ID Application 인증서(.cer, DER 또는 PEM)
      key: 'MAC_PRIVATE_KEY_BASE64', // 그 개인 키(PEM)
      appleId: 'APPLE_ID',
      appPassword: 'APPLE_APP_SPECIFIC_PASSWORD',
      teamId: 'APPLE_TEAM_ID',
    },
    expectTeam: '46LU76SNUA',
    notarize: true,
  },

  /** 개인 Apple Developer 계정(아직 없음) — 환경 변수로 받는다 */
  personal: {
    kind: 'env',
    names: {
      cert: 'LLMWIKI_MAC_CERT_BASE64',
      key: 'LLMWIKI_MAC_KEY_BASE64',
      appleId: 'LLMWIKI_APPLE_ID',
      appPassword: 'LLMWIKI_APPLE_APP_PASSWORD',
      teamId: 'LLMWIKI_APPLE_TEAM_ID',
    },
    expectTeam: null,
    notarize: true,
  },
};

export const DEFAULT = 'feeeld';
