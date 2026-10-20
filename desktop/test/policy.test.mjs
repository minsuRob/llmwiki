import { test } from 'node:test';
import assert from 'node:assert/strict';

import { appOrigins, authNavigationAllowed, mainNavigationAllowed, permissionAllowed, popupDecision, startUrl } from '../src/policy.mjs';

const prod = appOrigins({ packaged: true, devUrl: 'http://localhost:9999' });
const dev = appOrigins({ packaged: false, devUrl: 'http://localhost:8082' });

test('본문 origin — 패키징은 배포본 하나, 개발은 로컬 Expo 추가', () => {
  assert.deepEqual([...prod], ['https://llmwiki-minsu.web.app']);
  assert.ok(dev.has('http://localhost:8081') && dev.has('http://localhost:8082'));
  assert.ok(!appOrigins({ packaged: false, devUrl: 'http://evil.example' }).has('http://evil.example'), '개발 주소도 localhost 만');
  assert.equal(startUrl({ packaged: true, devUrl: 'http://localhost:8081' }), 'https://llmwiki-minsu.web.app/');
  assert.equal(startUrl({ packaged: false, devUrl: 'http://localhost:8081' }), 'http://localhost:8081');
});

test('T5 ①③④ 본문 창 탐색 — 허용 origin 밖은 막는다', () => {
  assert.ok(mainNavigationAllowed('https://llmwiki-minsu.web.app/work/abc', prod));
  for (const url of ['https://example.com/', 'http://llmwiki-minsu.web.app/', 'file:///etc/hosts', 'https://llmwiki-minsu.web.app.evil.com/', 'javascript:alert(1)', 'http://localhost:8081/']) {
    assert.equal(mainNavigationAllowed(url, prod), false, url);
  }
});

test('T5 ② 새 창 — 로그인 길만 창 안, 다른 https 는 시스템 브라우저, 나머지는 거절', () => {
  assert.equal(popupDecision('https://llmwiki-minsu.firebaseapp.com/__/auth/handler?apiKey=x'), 'auth');
  assert.equal(popupDecision('https://accounts.google.com/o/oauth2/v2/auth?x=1'), 'auth');
  assert.equal(popupDecision('about:blank'), 'auth');
  assert.equal(popupDecision('https://example.com/'), 'external');
  assert.equal(popupDecision('https://drive.google.com/file/d/1'), 'external');
  assert.equal(popupDecision('https://llmwiki-minsu.firebaseapp.com/other'), 'external');
  for (const url of ['http://example.com/', 'file:///etc/hosts', 'javascript:alert(1)', 'mailto:a@b.c', 'not a url']) assert.equal(popupDecision(url), 'deny', url);
});

test('로그인 창 탐색 — 로그인 길과 본문으로 돌아오기만', () => {
  assert.ok(authNavigationAllowed('https://accounts.google.com/signin', prod));
  assert.ok(authNavigationAllowed('https://llmwiki-minsu.firebaseapp.com/__/auth/handler', prod));
  assert.ok(authNavigationAllowed('https://llmwiki-minsu.web.app/', prod));
  assert.equal(authNavigationAllowed('https://example.com/', prod), false);
  assert.equal(authNavigationAllowed('http://accounts.google.com/', prod), false);
});

test('권한 — 허용 origin 의 복사만', () => {
  assert.ok(permissionAllowed('clipboard-sanitized-write', 'https://llmwiki-minsu.web.app/', prod));
  for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal']) assert.equal(permissionAllowed(p, 'https://llmwiki-minsu.web.app/', prod), false, p);
  assert.equal(permissionAllowed('clipboard-sanitized-write', 'https://example.com/', prod), false);
});
