import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PROFILES, DEFAULT } from '../signing.config.mjs';
import { pickIdentity, resolveProfile, teamOf } from '../scripts/signing.mjs';

test('서명 프로필 — 환경 변수로 고르고, 없으면 기본값, 모르는 이름은 멈춘다', () => {
  assert.equal(resolveProfile({}).name, DEFAULT);
  assert.equal(resolveProfile({ LLMWIKI_SIGNING: 'none' }).kind, 'none');
  assert.throws(() => resolveProfile({ LLMWIKI_SIGNING: 'nope' }), /없다/);
  for (const [name, p] of Object.entries(PROFILES)) {
    assert.ok(['none', 'ssm', 'env', 'keychain'].includes(p.kind), name);
    if (p.names) for (const k of ['cert', 'key', 'appleId', 'appPassword', 'teamId']) assert.equal(typeof p.names[k], 'string', `${name}.${k}`);
    assert.ok(!JSON.stringify(p).match(/-----BEGIN|MII[A-Za-z0-9+/]{20}/), `${name} 에 값이 들어 있으면 안 된다`);
  }
});

test('인증서 이름 → 팀 ID, find-identity 출력에서 Developer ID 고르기', () => {
  assert.equal(teamOf("Developer ID Application: FEEEL'D INC., (46LU76SNUA)"), '46LU76SNUA');
  assert.equal(teamOf('Apple Development: x'), null);
  const out = `  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Apple Development: someone (AAAAAAAAAA)"\n  2) 89ABCDEF0123456789ABCDEF0123456789ABCDEF "Developer ID Application: FEEEL'D INC., (46LU76SNUA)"\n     2 valid identities found`;
  assert.deepEqual(pickIdentity(out), { sha: '89ABCDEF0123456789ABCDEF0123456789ABCDEF', name: "Developer ID Application: FEEEL'D INC., (46LU76SNUA)" });
  assert.equal(pickIdentity('0 valid identities found'), null);
});
