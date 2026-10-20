// 서명 준비 — signing.config.mjs 의 프로필대로 인증서를 받아 임시 키체인에 넣고, electron-builder 에 넘길 값을 돌려준다.
// MAKi apps/desktop/scripts/release/signing-keychain.js 와 같은 방식(임시 키체인 · 끝나면 그 키체인만 목록에서 뺀다).
//
// 규칙: 인증서 · 키 · 암호는 화면 · 로그에 찍지 않는다. 임시 파일은 0600 · 끝나면 지운다.
// 공증 정보는 이 프로세스의 환경 변수로만 electron-builder 에 넘기고, 정리 때 지운다.
//
//   node scripts/signing.mjs --check   서명 출처 · 인증서(이름 · 팀 · 만료)만 확인하고 아무것도 설치하지 않는다
//   LLMWIKI_SIGNING=<프로필>          출처 고르기(signing.config.mjs), LLMWIKI_NOTARIZE=false  서명만
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT, PROFILES } from '../signing.config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const log = (msg) => console.log(`[signing] ${msg}`);
/** 실패해도 명령줄(임시 비밀번호가 든다)은 찍지 않는다 — 명령 이름 · 첫 인자 · stderr 끝만 */
function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });
  } catch (e) {
    const tail = String(e.stderr ?? '').trim().split('\n').slice(-2).join(' ').slice(0, 300);
    throw new Error(`${cmd.split('/').pop()} ${args[0]} 실패${tail ? `: ${tail}` : ''}`);
  }
}
/** macOS 의 security 는 OpenSSL 3 기본 p12(AES)를 못 읽을 때가 있다 — 시스템 openssl(LibreSSL) 우선 */
const OPENSSL = existsSync('/usr/bin/openssl') ? '/usr/bin/openssl' : 'openssl';

/** 어떤 프로필인가 — LLMWIKI_SIGNING 이 없으면 DEFAULT. 순수 함수(시험) */
export function resolveProfile(env = process.env, profiles = PROFILES, fallback = DEFAULT) {
  const name = env.LLMWIKI_SIGNING || fallback;
  const p = profiles[name];
  if (!p) throw new Error(`서명 프로필 '${name}' 이 없다 — signing.config.mjs 의 PROFILES: ${Object.keys(profiles).join(', ')}`);
  return { name, ...p };
}

/** "Developer ID Application: 이름 (TEAMID)" 에서 팀 ID. 순수 함수(시험) */
export function teamOf(identityName) {
  return /\(([A-Z0-9]{10})\)\s*$/.exec(identityName ?? '')?.[1] ?? null;
}

/** find-identity 출력 → 첫 번째 유효한 Developer ID Application. 순수 함수(시험) */
export function pickIdentity(findIdentityOutput) {
  for (const line of String(findIdentityOutput).split('\n')) {
    const m = /^\s*\d+\)\s+([0-9A-F]{40})\s+"([^"]+)"/.exec(line);
    if (m && m[2].startsWith('Developer ID Application:')) return { sha: m[1], name: m[2] };
  }
  return null;
}

/** 프로필에서 값 받기 → { cert, key, appleId, appPassword, teamId } (없는 것은 빈 값) */
function readSecrets(p) {
  const names = p.names;
  if (p.kind === 'env') return Object.fromEntries(Object.entries(names).map(([k, n]) => [k, process.env[n] ?? '']));
  if (p.kind === 'ssm') {
    const region = process.env.AWS_REGION || p.region;
    const full = Object.values(names).map((n) => `${p.prefix}/${n}`);
    // 한 번에(최대 10개) — 값은 표준출력으로만 받고 찍지 않는다
    const out = JSON.parse(run('aws', ['ssm', 'get-parameters', '--names', ...full, '--with-decryption', '--region', region, '--output', 'json']));
    if (out.InvalidParameters?.length) throw new Error(`SSM 에 없는 값: ${out.InvalidParameters.join(', ')}`);
    const byName = Object.fromEntries(out.Parameters.map((x) => [x.Name, x.Value]));
    return Object.fromEntries(Object.entries(names).map(([k, n]) => [k, byName[`${p.prefix}/${n}`] ?? '']));
  }
  if (p.kind === 'keychain') {
    return { cert: '', key: '', appleId: process.env.APPLE_ID ?? '', appPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD ?? '', teamId: process.env.APPLE_TEAM_ID ?? '' };
  }
  return {};
}

const b64 = (s) => Buffer.from(String(s).replace(/\s+/g, ''), 'base64');

/** 인증서(DER · PEM) → PEM 파일 경로, 이름 · 만료 */
function certInfo(dir, certB64) {
  const raw = join(dir, 'cert.cer');
  const pem = join(dir, 'cert.pem');
  writeFileSync(raw, b64(certB64), { mode: 0o600 });
  try {
    run(OPENSSL, ['x509', '-in', raw, '-out', pem]);
  } catch {
    run(OPENSSL, ['x509', '-inform', 'DER', '-in', raw, '-out', pem]);
  }
  const subject = run(OPENSSL, ['x509', '-in', pem, '-noout', '-subject', '-nameopt', 'utf8,sep_comma_plus']).trim();
  const end = run(OPENSSL, ['x509', '-in', pem, '-noout', '-enddate']).trim().replace(/^notAfter=/, '');
  const cn = /CN=([^,]+(?:,\s*\([A-Z0-9]{10}\))?)/.exec(subject)?.[1]?.trim() ?? subject;
  return { pem, cn, expires: new Date(end) };
}

/**
 * 서명 준비. → { enabled, profile, identity, teamId, notarize, builderMac, cleanup }
 * builderMac 은 electron-builder 의 mac 설정에 덮어쓸 값.
 */
export function setupSigning({ check = false } = {}) {
  const profile = resolveProfile();
  const off = { enabled: false, profile: profile.name, notarize: false, builderMac: { identity: null, hardenedRuntime: false, notarize: false }, cleanup: () => {} };
  if (profile.kind === 'none') {
    log(`프로필 '${profile.name}' — 서명하지 않는다`);
    return off;
  }
  if (process.platform !== 'darwin') {
    log('macOS 가 아니라 서명하지 않는다');
    return off;
  }

  const s = readSecrets(profile);
  // LLMWIKI_NOTARIZE=false 면 서명만(공증은 애플 팀 기록에 남는다 — 시험 빌드에서는 끌 수 있게)
  const canNotarize = Boolean(profile.notarize && process.env.LLMWIKI_NOTARIZE !== 'false' && s.appleId && s.appPassword && s.teamId);
  const work = mkdtempSync(join(tmpdir(), 'llmwiki-signing-'));
  const cleanTemp = () => rmSync(work, { recursive: true, force: true });

  // keychain: 이미 설치된 인증서를 이름으로
  if (profile.kind === 'keychain') {
    const id = pickIdentity(run('security', ['find-identity', '-v', '-p', 'codesigning']));
    if (!id) throw new Error('키체인에 Developer ID Application 인증서가 없다');
    checkTeam(profile, teamOf(id.name));
    cleanTemp();
    return finish(profile, id.name, canNotarize, s, () => {});
  }

  if (!s.cert || !s.key) {
    cleanTemp();
    throw new Error(`프로필 '${profile.name}' 에서 인증서 · 개인 키를 받지 못했다`);
  }
  const info = certInfo(work, s.cert);
  const days = Math.floor((info.expires - Date.now()) / 86_400_000);
  log(`인증서: ${info.cn} · 만료 ${info.expires.toISOString().slice(0, 10)}(${days}일 남음)`);
  if (days < 0) {
    cleanTemp();
    throw new Error('인증서가 만료됐다 — signing.config.mjs 의 출처를 새 인증서로 바꿔 주세요');
  }
  if (days < 30) log(`⚠ 인증서 만료가 ${days}일 남았다`);
  checkTeam(profile, teamOf(info.cn));
  if (check) {
    log(`공증: ${canNotarize ? '가능(애플 ID · 앱 암호 · 팀 ID 있음)' : '안 함'}`);
    cleanTemp();
    return { ...off, profile: profile.name, identity: info.cn, notarize: canNotarize };
  }

  // 임시 키체인 — 비밀번호는 매번 새로, 어디에도 남기지 않는다
  const keyPath = join(work, 'key.pem');
  writeFileSync(keyPath, b64(s.key), { mode: 0o600 });
  const pass = randomBytes(16).toString('hex');
  const p12 = join(work, 'signing.p12');
  run(OPENSSL, ['pkcs12', '-export', '-inkey', keyPath, '-in', info.pem, '-out', p12, '-passout', `pass:${pass}`]);
  rmSync(keyPath, { force: true });

  const kcDir = join(ROOT, 'release-build');
  mkdirSync(kcDir, { recursive: true });
  const keychain = join(kcDir, 'llmwiki-signing.keychain-db');
  if (existsSync(keychain)) run('security', ['delete-keychain', keychain]);
  run('security', ['create-keychain', '-p', pass, keychain]);
  run('security', ['set-keychain-settings', '-lut', '7200', keychain]);
  run('security', ['unlock-keychain', '-p', pass, keychain]);
  run('security', ['import', p12, '-k', keychain, '-P', pass, '-f', 'pkcs12', '-T', '/usr/bin/codesign', '-T', '/usr/bin/security']);
  rmSync(p12, { force: true });
  run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', pass, keychain]);
  const before = userKeychains();
  run('security', ['list-keychains', '-d', 'user', '-s', keychain, ...before]);

  const id = pickIdentity(run('security', ['find-identity', '-v', '-p', 'codesigning', keychain]));
  const cleanup = () => {
    // 다른 빌드(MAKi iOS 등)가 그사이 목록을 바꿨을 수 있다 — 지금 목록에서 우리 키체인만 뺀다
    try {
      const rest = userKeychains().filter((k) => resolve(k) !== resolve(keychain));
      if (rest.length) run('security', ['list-keychains', '-d', 'user', '-s', ...rest]);
    } catch {
      /* 되돌리기는 최선만 */
    }
    try {
      if (existsSync(keychain)) run('security', ['delete-keychain', keychain]);
    } catch {
      /* 최선만 */
    }
    cleanTemp();
    log('임시 키체인을 지웠다');
  };
  if (!id) {
    cleanup();
    throw new Error('임시 키체인에서 서명 인증서를 찾지 못했다');
  }
  return finish(profile, id.name, canNotarize, s, cleanup, keychain);
}

function finish(profile, identityName, canNotarize, s, cleanupKeychain, keychain) {
  // electron-builder 는 "Developer ID Application:" 을 뺀 이름을 받는다
  const identity = identityName.replace(/^Developer ID Application:\s*/, '');
  const set = {};
  if (canNotarize) {
    set.APPLE_ID = s.appleId;
    set.APPLE_APP_SPECIFIC_PASSWORD = s.appPassword;
    set.APPLE_TEAM_ID = s.teamId;
  }
  if (keychain) set.CSC_KEYCHAIN = keychain;
  const prev = Object.fromEntries(Object.keys(set).map((k) => [k, process.env[k]]));
  Object.assign(process.env, set);
  delete process.env.CSC_LINK; // 다른 출처가 끼어들지 않게
  log(`서명: ${identityName} · 공증 ${canNotarize ? '함' : '안 함'} (프로필 '${profile.name}')`);
  return {
    enabled: true,
    profile: profile.name,
    identity,
    teamId: teamOf(identityName),
    notarize: canNotarize,
    builderMac: { identity, hardenedRuntime: true, notarize: canNotarize, entitlements: 'build/entitlements.mac.plist', entitlementsInherit: 'build/entitlements.mac.plist', gatekeeperAssess: false },
    cleanup: () => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      cleanupKeychain();
    },
  };
}

function checkTeam(profile, team) {
  if (profile.expectTeam && team !== profile.expectTeam) {
    throw new Error(`인증서 팀(${team ?? '?'})이 프로필 '${profile.name}' 의 expectTeam(${profile.expectTeam})과 다르다`);
  }
}

function userKeychains() {
  return run('security', ['list-keychains', '-d', 'user']).split('\n').map((l) => l.trim().replaceAll('"', '')).filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    setupSigning({ check: process.argv.includes('--check') });
  } catch (e) {
    console.error(`[signing] ${e.message}`);
    process.exit(1);
  }
}
