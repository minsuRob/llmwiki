#!/usr/bin/env node
/**
 * 편집기 시험 — 브라우저 없이(헤드리스 Lexical) 마크다운 왕복을 본다.
 * 앱 소스는 확장자 없는 import · JSX 라 Node 가 바로 못 읽는다 → esbuild 로 묶어(functions 의 esbuild) node --test 로 돌린다.
 * 실행: npm --prefix aria-rn run test:editor  (먼저 npm --prefix functions install)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const require = createRequire(join(APP, "..", "functions", "package.json"));
const esbuild = require("esbuild");

const dir = join(APP, "src", "features", "editor");
const tests = readdirSync(dir).filter((f) => f.endsWith(".test.ts"));
const out = mkdtempSync(join(tmpdir(), "llmwiki-editor-test-"));
try {
  await esbuild.build({
    entryPoints: tests.map((f) => join(dir, f)),
    outdir: out,
    bundle: true,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    // 앱 node_modules 에서 찾는다(lexical · react)
    nodePaths: [join(APP, "node_modules")],
    loader: { ".css": "empty" },
    logLevel: "warning",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  const files = readdirSync(out).filter((f) => f.endsWith(".js")).map((f) => join(out, f));
  const r = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
  process.exitCode = r.status ?? 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
