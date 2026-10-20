// 패키징 — 메인 + tools/handoff 를 한 파일로 묶고(electron-builder 는 앱 폴더 밖 파일을 담지 않는다),
// preload · 오프라인 페이지를 dist/ 로 복사한 뒤, 서명 프로필(signing.config.mjs)대로 서명 · 공증해 dmg · zip 을 만든다.
//   LLMWIKI_SIGNING=none npm run build     서명 없이
//   node scripts/signing.mjs --check        서명 출처만 확인
import { build as esbuild } from 'esbuild';
import { build as builder } from 'electron-builder';
import { cp, mkdir, rm } from 'node:fs/promises';

import { builderConfig } from '../electron-builder.config.mjs';
import afterSign from './notarize.mjs';
import { setupSigning } from './signing.mjs';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await esbuild({
  entryPoints: ['src/main.mjs'],
  outfile: 'dist/main.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['electron', './fakes.mjs'],
  define: { 'globalThis.__LLMWIKI_BUILD__': '"release"' },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: 'none',
});
await cp('src/preload.cjs', 'dist/preload.cjs');
await cp('static', 'dist/static', { recursive: true });
console.log('dist/ 준비 완료');

const signing = setupSigning();
try {
  await builder({ config: { ...builderConfig(signing.builderMac), ...(signing.notarize ? { afterSign } : {}) } });
} finally {
  signing.cleanup();
}
