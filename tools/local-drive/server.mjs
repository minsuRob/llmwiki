#!/usr/bin/env node
/**
 * 로컬 Drive — 개발 · 검증용. 이 컴퓨터의 폴더 하나를 Google Drive REST(v3) 처럼 흉내 낸다. 실제 Google Drive 가 아니다.
 *
 * 앱의 Drive 코드(packages/core/src/drive.ts)를 고치지 않고 그대로 돌려 보려고 만든 것이라, 앱이 쓰는 만큼만 구현한다:
 *   files.list(q: trashed · mimeType · '<id>' in parents · appProperties has {key,value}) · files.get(메타 · alt=media · export)
 *   files.create(폴더 · multipart 업로드) · files.update(media 업로드 · trashed · name)
 * 파일은 진짜 파일로 놓인다:  <dir>/내 드라이브/…  (앱이 만든 "llmwiki 작업실" 폴더도 여기에 생긴다)
 * 메타데이터(id · version · appProperties)는 <dir>/.index.json.
 * - 사람이 디스크에서 파일을 고치면(수정 시각이 바뀌면) version 이 오른다 → 앱이 "바깥 변경" 으로 알아챈다.
 * - 디스크에서 이름을 바꿔도(같은 inode) 같은 id 로 남는다. 지우면 404(접근 불가), API 로 지우면 .trash 로 옮긴다.
 * - .gdoc(글) · .gsheet(CSV) · .gslides(글) 은 Google 문서처럼 다룬다(내려받기 대신 export).
 * - 127.0.0.1 에만 열고, Authorization: Bearer <token> 이 맞아야 답한다.
 *
 * 실행:  node tools/local-drive/server.mjs --dir .local-drive --port 8790 --seed
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const FOLDER = "application/vnd.google-apps.folder";
const MIME = {
  ".gdoc": "application/vnd.google-apps.document",
  ".gsheet": "application/vnd.google-apps.spreadsheet",
  ".gslides": "application/vnd.google-apps.presentation",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};
const GOOGLE_TYPES = new Set([MIME[".gdoc"], MIME[".gsheet"], MIME[".gslides"]]);
const EXT_OF = { "text/markdown": ".md", "text/plain": ".txt", "application/json": ".json", "text/csv": ".csv" };

export function startLocalDrive({ dir, port = 8790, token = "local-dev-token", seed = false, log = false } = {}) {
  const ROOT = join(dir, "내 드라이브");
  const TRASH = join(dir, ".trash");
  const INDEX = join(dir, ".index.json");
  mkdirSync(ROOT, { recursive: true });
  mkdirSync(TRASH, { recursive: true });
  let revoked = false;

  /** @type {{ next: number, files: Record<string, any> }} */
  let idx = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, "utf8")) : { next: 1, files: {} };
  const save = () => writeFileSync(INDEX, JSON.stringify(idx, null, 1));
  const abs = (f) => (f.trashed ? join(TRASH, f.id) : join(ROOT, f.rel));
  const relOfParent = (pid) => (pid === "root" ? "" : idx.files[pid]?.rel ?? "");

  if (seed) {
    const put = (rel, body) => {
      const p = join(ROOT, rel);
      if (existsSync(p)) return;
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, body);
    };
    put("10월 실적/10월 매출.gsheet", "월,매출(억),영업이익(억)\n9월,109,11.2\n10월,120,12.9\n");
    put("10월 실적/회의록 1017.gdoc", "10/17 팀 회의\n- 실적 보고는 전월 대비로\n- 마감 10/24\n- 영업이익률은 재무팀 확인 필요\n");
    put("10월 실적/계약서.pdf", "%PDF-1.4\n% local-drive sample\n");
    put("개인/이력서 메모.md", "# 이력서\n- 희망 연봉 비공개\n");
  }

  /** 디스크를 훑어 새 파일은 등록하고, 고친 파일은 version 을 올리고, 사라진 파일은 뺀다 */
  function scan() {
    const seen = new Map();
    const walk = (d) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        const st = statSync(p);
        seen.set(relative(ROOT, p).split(sep).join("/"), st);
        if (st.isDirectory()) walk(p);
      }
    };
    walk(ROOT);
    const byIno = new Map();
    for (const [rel, st] of seen) byIno.set(st.ino, rel);
    let changed = false;
    for (const f of Object.values(idx.files)) {
      if (f.trashed) continue;
      const st = seen.get(f.rel);
      if (st && st.ino === f.ino) {
        if (!st.isDirectory() && st.mtimeMs !== f.mtimeMs) {
          f.version += 1;
          f.mtimeMs = st.mtimeMs;
          changed = true;
        }
        seen.delete(f.rel);
        continue;
      }
      const moved = byIno.get(f.ino);
      if (moved && seen.has(moved)) {
        // 이름 · 자리가 바뀌었다 — id 는 그대로
        const st2 = seen.get(moved);
        f.rel = moved;
        f.name = moved.split("/").pop();
        const parentRel = moved.includes("/") ? moved.slice(0, moved.lastIndexOf("/")) : "";
        f.parents = [Object.values(idx.files).find((x) => x.rel === parentRel && x.mimeType === FOLDER)?.id ?? "root"];
        if (st2.mtimeMs !== f.mtimeMs) f.version += 1;
        f.mtimeMs = st2.mtimeMs;
        seen.delete(moved);
        changed = true;
        continue;
      }
      delete idx.files[f.id];
      changed = true;
    }
    // 남은 것은 새로 나타난 파일 — 얕은 것부터 등록해야 부모 id 가 먼저 생긴다
    for (const rel of [...seen.keys()].sort((a, b) => a.split("/").length - b.split("/").length)) {
      const st = seen.get(rel);
      const id = `L${idx.next++}`;
      const parentRel = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
      const parent = Object.values(idx.files).find((x) => x.rel === parentRel && x.mimeType === FOLDER)?.id ?? "root";
      const name = rel.split("/").pop();
      idx.files[id] = { id, name, rel, parents: [parent], mimeType: st.isDirectory() ? FOLDER : MIME[extname(name).toLowerCase()] ?? "application/octet-stream", version: 1, trashed: false, appProperties: {}, ino: st.ino, mtimeMs: st.mtimeMs };
      changed = true;
    }
    if (changed) save();
  }

  function create(meta, body) {
    const parent = meta.parents?.[0] ?? "root";
    const folder = meta.mimeType === FOLDER;
    let name = String(meta.name ?? "untitled").replace(/[\\/]/g, "_");
    if (!folder && !extname(name) && EXT_OF[meta.mimeType]) name += EXT_OF[meta.mimeType];
    const base = relOfParent(parent);
    let rel = base ? `${base}/${name}` : name;
    if (existsSync(join(ROOT, rel))) rel = rel.replace(/(\.[^./]+)?$/, ` (${idx.next})$1`);
    const p = join(ROOT, rel);
    mkdirSync(folder ? p : dirname(p), { recursive: true });
    if (!folder) writeFileSync(p, body ?? "");
    const st = statSync(p);
    const id = `L${idx.next++}`;
    idx.files[id] = { id, name: rel.split("/").pop(), rel, parents: [parent], mimeType: meta.mimeType ?? "application/octet-stream", version: 1, trashed: false, appProperties: meta.appProperties ?? {}, ino: st.ino, mtimeMs: st.mtimeMs };
    save();
    return idx.files[id];
  }

  const view = (f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    parents: f.parents,
    version: String(f.version),
    trashed: !!f.trashed,
    appProperties: f.appProperties,
    modifiedTime: new Date(f.mtimeMs).toISOString(),
    webViewLink: `http://127.0.0.1:${server.address().port}/view/${f.id}`,
  });

  /** q — trashed=false · mimeType='…' · '<id>' in parents · appProperties has { key='k' and value='v' } (and 로만 잇는다) */
  function matches(f, q) {
    if (!q) return !f.trashed;
    let rest = q;
    for (const m of q.matchAll(/appProperties has \{\s*key='([^']*)' and value='((?:[^'\\]|\\.)*)'\s*\}/g)) {
      if (f.appProperties?.[m[1]] !== m[2].replace(/\\(.)/g, "$1")) return false;
      rest = rest.replace(m[0], "");
    }
    for (const part of rest.split(/\s+and\s+/).map((x) => x.trim()).filter(Boolean)) {
      let m;
      if ((m = /^trashed\s*=\s*(true|false)$/.exec(part))) {
        if (!!f.trashed !== (m[1] === "true")) return false;
      } else if ((m = /^mimeType\s*=\s*'([^']*)'$/.exec(part))) {
        if (f.mimeType !== m[1]) return false;
      } else if ((m = /^'([^']*)'\s+in\s+parents$/.exec(part))) {
        if (!f.parents.includes(m[1])) return false;
      } else throw new Error(`unsupported q: ${part}`);
    }
    return true;
  }

  const readBody = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });

  function multipart(body, contentType) {
    const boundary = /boundary=([^;]+)/.exec(contentType)?.[1];
    const parts = body.split(`--${boundary}`).slice(1, -1).map((p) => p.replace(/^\r\n/, "").replace(/\r\n$/, ""));
    const split = (p) => {
      const i = p.indexOf("\r\n\r\n");
      return p.slice(i + 4);
    };
    return { meta: JSON.parse(split(parts[0])), content: split(parts[1] ?? "") };
  }

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const cors = origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS", Vary: "Origin" } : {};
    const send = (status, body, type = "application/json") => {
      res.writeHead(status, { "Content-Type": `${type}; charset=utf-8`, ...cors });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    if (req.method === "OPTIONS") return send(204, "");
    const url = new URL(req.url, "http://127.0.0.1");
    try {
      scan();
      if (url.pathname.startsWith("/view/")) {
        const f = idx.files[url.pathname.slice(6)];
        return f && !f.trashed && f.mimeType !== FOLDER ? send(200, readFileSync(abs(f), "utf8"), "text/plain") : send(404, "not found", "text/plain");
      }
      // 개발용 — 앱이 Picker 대신 쓰는 목록 · 권한 끊기
      if (url.pathname === "/__revoke") return (revoked = true), send(200, { ok: true });
      if (url.pathname === "/__renew") return (revoked = false), send(200, { ok: true });
      if (revoked || req.headers.authorization !== `Bearer ${token}`) return send(401, { error: { code: 401, message: "invalid token" } });
      if (url.pathname === "/__picker") {
        const appRoots = new Set(Object.values(idx.files).filter((f) => f.appProperties?.llmwikiRole === "root").map((f) => f.rel));
        const files = Object.values(idx.files).filter((f) => !f.trashed && ![...appRoots].some((r) => f.rel === r || f.rel.startsWith(`${r}/`)));
        return send(200, { files: files.map((f) => ({ ...view(f), path: f.rel })) });
      }

      const m = /^\/(upload\/)?drive\/v3\/files(?:\/([^/]+))?(\/export)?$/.exec(url.pathname);
      if (!m) return send(404, { error: { code: 404, message: "unknown path" } });
      const [, isUpload, id, isExport] = m;
      if (log) console.log(req.method, url.pathname, url.searchParams.get("q") ?? "");

      if (req.method === "GET" && !id) {
        const q = url.searchParams.get("q") ?? "";
        return send(200, { files: Object.values(idx.files).filter((f) => matches(f, q)).map(view) });
      }
      const f = id ? idx.files[id] : null;
      if (id && !f) return send(404, { error: { code: 404, message: "File not found" } });
      if (req.method === "GET" && isExport) {
        if (!GOOGLE_TYPES.has(f.mimeType)) return send(403, { error: { code: 403, message: "Export only supports Docs Editors files." } });
        return send(200, readFileSync(abs(f), "utf8"), url.searchParams.get("mimeType") ?? "text/plain");
      }
      if (req.method === "GET" && url.searchParams.get("alt") === "media") {
        if (GOOGLE_TYPES.has(f.mimeType) || f.mimeType === FOLDER) return send(403, { error: { code: 403, message: "Only files with binary content can be downloaded. Use Export with Docs Editors files." } });
        return send(200, readFileSync(abs(f), "utf8"), f.mimeType);
      }
      if (req.method === "GET") return send(200, view(f));

      const body = await readBody(req);
      if (req.method === "POST" && isUpload) {
        const { meta, content } = multipart(body, req.headers["content-type"] ?? "");
        return send(200, view(create(meta, content)));
      }
      if (req.method === "POST") return send(200, view(create(JSON.parse(body || "{}"), "")));
      if (req.method === "PATCH" && isUpload) {
        writeFileSync(abs(f), body);
        f.version += 1;
        f.mtimeMs = statSync(abs(f)).mtimeMs;
        save();
        return send(200, view(f));
      }
      if (req.method === "PATCH") {
        const patch = JSON.parse(body || "{}");
        if (patch.trashed === true && !f.trashed) {
          renameSync(join(ROOT, f.rel), join(TRASH, f.id));
          f.trashed = true;
        }
        if (patch.appProperties) f.appProperties = { ...f.appProperties, ...patch.appProperties };
        f.version += 1;
        save();
        return send(200, view(f));
      }
      return send(405, { error: { code: 405, message: "method" } });
    } catch (e) {
      return send(400, { error: { code: 400, message: String(e?.message ?? e) } });
    }
  });

  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        root: ROOT,
        close: () => new Promise((r) => server.close(() => r())),
      }),
    ),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (k, d) => {
    const i = process.argv.indexOf(`--${k}`);
    return i > 0 ? process.argv[i + 1] : d;
  };
  const s = await startLocalDrive({ dir: arg("dir", ".local-drive"), port: Number(arg("port", "8790")), token: arg("token", "local-dev-token"), seed: process.argv.includes("--seed"), log: process.argv.includes("--log") });
  console.log(`local-drive (개발용 · 실제 Google Drive 아님) ${s.url}  폴더: ${s.root}`);
}
