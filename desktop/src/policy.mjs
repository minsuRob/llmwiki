// 창 · 탐색 · 새 창 정책 — 순수 함수(test/policy.test.mjs). 메인(main.mjs)이 이 판정만 따른다.
// 원칙: 본문은 배포된 웹 하나(개발 때만 로컬 Expo 추가). 로그인 · 동의 팝업만 창 안에서 열고, 나머지 https 는 시스템 브라우저로.

export const PROD_URL = 'https://llmwiki-minsu.web.app';
const DEV_ORIGINS = ['http://localhost:8081', 'http://127.0.0.1:8081'];

/** 본문으로 띄울 수 있는 origin 들 */
export function appOrigins({ packaged, devUrl } = {}) {
  const set = new Set([PROD_URL]);
  if (!packaged) {
    for (const o of DEV_ORIGINS) set.add(o);
    const dev = originOf(devUrl);
    if (dev && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(dev)) set.add(dev);
  }
  return set;
}

/** 처음 띄울 주소 — 패키징 빌드는 언제나 배포본 */
export function startUrl({ packaged, devUrl } = {}) {
  if (packaged || !devUrl) return `${PROD_URL}/`;
  return appOrigins({ packaged, devUrl }).has(originOf(devUrl)) ? devUrl : `${PROD_URL}/`;
}

export function originOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** 로그인 · 동의 창이 지나가도 되는 곳(Firebase 팝업 핸들러 → Google 로그인 · GIS 동의) */
const AUTH_HOSTS = [/^llmwiki-minsu\.firebaseapp\.com$/, /^accounts\.google\.com$/, /^accounts\.youtube\.com$/, /^(www\.)?google\.com$/, /^accounts\.google\.co\.kr$/];
export function isAuthUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    if (u.hostname === 'llmwiki-minsu.firebaseapp.com') return u.pathname.startsWith('/__/auth/');
    return AUTH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/**
 * 본문 창의 window.open · target=_blank 판정
 * → 'auth'(창 안 팝업, preload 없음) | 'external'(시스템 브라우저) | 'deny'
 */
export function popupDecision(url) {
  if (url === 'about:blank') return 'auth'; // GIS · Firebase 가 빈 창을 먼저 연 뒤 주소를 바꾼다 — 그 창도 아래 탐색 정책을 따른다
  if (isAuthUrl(url)) return 'auth';
  try {
    return new URL(url).protocol === 'https:' ? 'external' : 'deny';
  } catch {
    return 'deny';
  }
}

/** 본문 창의 탐색(will-navigate · will-redirect) — 허용 origin 안에서만 */
export function mainNavigationAllowed(url, origins) {
  return origins.has(originOf(url));
}

/** 로그인 팝업 창의 탐색 — 로그인 길 · 본문 origin(결과를 돌려주러 돌아올 때)만 */
export function authNavigationAllowed(url, origins) {
  return url === 'about:blank' || isAuthUrl(url) || origins.has(originOf(url));
}

/** 웹 페이지가 요청할 수 있는 권한 — 복사만 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);
export function permissionAllowed(permission, requestingUrl, origins) {
  return ALLOWED_PERMISSIONS.has(permission) && origins.has(originOf(requestingUrl));
}
