// 패키징 준비 — 메인 + tools/handoff 를 한 파일로 묶고(electron-builder 는 앱 폴더 밖 파일을 담지 않는다),
// preload · 오프라인 페이지를 dist/ 로 복사한다. 개발용 분기(로컬 주소 · 가짜 실행자)는 'release' 상수로 꺼진다.
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({
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
