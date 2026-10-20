// electron-builder 설정 — 서명 부분(mac.identity · hardenedRuntime · notarize)은 scripts/signing.mjs 가 채운다.
// 자동 업데이트 없음: 화면은 웹 배포로 바뀌고 셸은 드물게 바뀐다.
export function builderConfig(signingMac = { identity: null, hardenedRuntime: false, notarize: false }) {
  return {
    appId: 'app.llmwiki.desktop',
    productName: 'llmwiki',
    directories: { output: 'release' },
    files: ['dist/**', 'package.json', '!node_modules/**'],
    extraMetadata: { main: 'dist/main.mjs' },
    asar: true,
    mac: {
      target: [
        { target: 'zip', arch: ['arm64'] },
        { target: 'dmg', arch: ['arm64'] },
      ],
      category: 'public.app-category.productivity',
      ...signingMac,
    },
  };
}
