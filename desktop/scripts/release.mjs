// 데스크톱 릴리스 — 버전(package.json) 확인 → 빌드 · 서명 · 공증 → 태그 desktop-v<버전> → GitHub Releases 에 dmg · zip.
// 설치 파일은 git 에 넣지 않는다(파일당 100MB 제한 · 저장소 비대). 기본은 초안(draft) — 관리자만 보이고, 확인 뒤 공개한다.
//
//   npm run desktop:release               초안으로
//   npm run desktop:release -- --publish  바로 공개
//   npm run desktop:release -- --skip-build  release/ 의 같은 버전 산출물을 그대로 올린다
//
// 버전을 올리려면 desktop/package.json 의 version 을 바꾸고 커밋한 뒤 실행한다. 같은 태그가 있으면 멈춘다.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const publish = args.includes('--publish');
const skipBuild = args.includes('--skip-build');
const sh = (cmd, a, opts = {}) => execFileSync(cmd, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const die = (msg) => {
  console.error(`[release] ${msg}`);
  process.exit(1);
};

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) die(`버전 형식이 이상하다: ${version}`);
const tag = `desktop-v${version}`;
const files = [`release/llmwiki-${version}-arm64.dmg`, `release/llmwiki-${version}-arm64-mac.zip`];

// 1. 깨끗한 작업 트리 · 태그 중복 확인
if (sh('git', ['status', '--porcelain'])) die('커밋하지 않은 변경이 있다 — 커밋한 뒤 다시');
if (sh('git', ['tag', '-l', tag])) die(`태그 ${tag} 가 이미 있다 — package.json 의 version 을 올려 주세요`);
if (sh('git', ['ls-remote', '--tags', 'origin', tag])) die(`원격에 태그 ${tag} 가 이미 있다`);
const commit = sh('git', ['rev-parse', 'HEAD']);
const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);

// 2. 빌드 · 서명 · 공증
if (!skipBuild) {
  const r = spawnSync('node', ['scripts/build.mjs'], { stdio: 'inherit' });
  if (r.status !== 0) die('빌드 실패');
}
for (const f of files) if (!existsSync(f)) die(`산출물이 없다: ${f}`);

// 3. 서명 · 공증 정보(설명용)
const app = 'release/mac-arm64/llmwiki.app';
// codesign -dv 는 stderr 로 쓴다
if (spawnSync('codesign', ['--verify', '--deep', '--strict', app]).status !== 0) die('서명 검증 실패');
const signer = /Authority=(.+)/.exec(spawnSync('codesign', ['-dv', '--verbose=2', app], { encoding: 'utf8' }).stderr ?? '')?.[1] ?? '서명 없음';
const notary = existsSync('release/notarization.json') ? JSON.parse(readFileSync('release/notarization.json', 'utf8')) : null;
const size = (f) => `${Math.round(Number(sh('stat', ['-f', '%z', f])) / 1e6)}MB`;

const notes = `llmwiki 데스크톱 셸 ${version}

배포된 웹(https://llmwiki-minsu.web.app)을 띄우고 Claude · Codex · Gemma 바로 실행만 더하는 셸입니다. 화면은 웹 배포로 바뀌므로 셸은 브리지 · 보안 정책이 바뀔 때만 새로 받습니다.

| 항목 | 값 |
|---|---|
| 버전 | ${version} (브리지 apiVersion 1) |
| 커밋 | \`${commit.slice(0, 7)}\` (${branch}) |
| 서명 | ${signer} |
| 공증 | ${notary ? `${notary.status} · id \`${notary.id}\` · 공증 표시(staple) 없음` : '안 함'} |
| 플랫폼 | macOS arm64 |

- \`llmwiki-${version}-arm64.dmg\` (${size(files[0])}) — 열어서 응용 프로그램으로 끌어 넣기
- \`llmwiki-${version}-arm64-mac.zip\` (${size(files[1])}) — 같은 앱, 압축본

구조 · 원칙: docs/architecture.md "데스크톱 셸".
`;

// 4. 태그 · 릴리스
sh('git', ['tag', '-a', tag, '-m', `llmwiki desktop ${version}`]);
sh('git', ['push', 'origin', tag]);
const ghArgs = ['release', 'create', tag, ...files, '--title', `llmwiki desktop ${version}`, '--notes', notes, '--target', commit];
if (!publish) ghArgs.push('--draft');
const url = sh('gh', ghArgs);
console.log(`[release] ${publish ? '공개' : '초안'} 릴리스: ${url}`);
