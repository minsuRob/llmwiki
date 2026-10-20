// 공증 — electron-builder afterSign 훅. MAKi apps/desktop/scripts/release/notarize.js 처럼 공증만 하고 표시(staple)는 붙이지 않는다.
// (붙이지 않아도 Gatekeeper 가 처음 열 때 애플 서버에 묻는다. 붙이려면 LLMWIKI_STAPLE=true — 실패해도 빌드는 계속)
// 애플 ID · 앱 암호 · 팀 ID 는 signing.mjs 가 이 프로세스 환경 변수로만 넘긴다. 화면 · 로그에 찍지 않는다.
import { execFile } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sh = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { maxBuffer: 16 << 20, ...opts }, (err, stdout, stderr) => resolve({ code: err ? err.code ?? 1 : 0, stdout: String(stdout), stderr: String(stderr) }));
});

export async function notarizeApp(appPath, { staple = process.env.LLMWIKI_STAPLE === 'true' } = {}) {
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) throw new Error('[notarize] 공증 정보가 없다');
  const zip = join(appPath, '..', 'llmwiki-notarize-input.zip');
  rmSync(zip, { force: true });
  const z = await sh('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zip]);
  if (z.code) throw new Error(`[notarize] ditto 실패: ${z.stderr.slice(-300)}`);
  const started = Date.now();
  console.log('[notarize] 애플에 제출 — 끝날 때까지 기다린다');
  const r = await sh('xcrun', ['notarytool', 'submit', zip, '--apple-id', APPLE_ID, '--password', APPLE_APP_SPECIFIC_PASSWORD, '--team-id', APPLE_TEAM_ID, '--wait', '--output-format', 'json']);
  rmSync(zip, { force: true });
  let out = {};
  try {
    out = JSON.parse(r.stdout);
  } catch {
    /* 아래에서 실패 처리 */
  }
  const secs = Math.round((Date.now() - started) / 1000);
  if (r.code || out.status !== 'Accepted') {
    throw new Error(`[notarize] 공증 실패(${out.status ?? `코드 ${r.code}`}, id ${out.id ?? '?'}) — 'xcrun notarytool log <id>' 로 이유 확인`);
  }
  console.log(`[notarize] 공증 통과 · id ${out.id} · ${secs}초`);
  // 릴리스 설명에 쓰려고 남긴다(비밀값 없음)
  writeFileSync(join(appPath, '..', '..', 'notarization.json'), JSON.stringify({ id: out.id, status: out.status, at: new Date().toISOString(), seconds: secs }, null, 1));
  if (staple) {
    const s = await sh('xcrun', ['stapler', 'staple', appPath]);
    console.log(s.code ? '[notarize] 표시 붙이기 실패 — 건너뛴다(공증은 됐다)' : '[notarize] 표시를 붙였다');
  }
  return out.id;
}

/** electron-builder afterSign */
export default async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  await notarizeApp(app);
}
