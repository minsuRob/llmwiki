// llmwiki 데스크톱 셸 — 배포된 웹을 그대로 띄우고, 정해진 실행자(Claude · Codex · Gemma)에 묶음 하나를 넘기는 일만 더한다.
// 원칙: docs/architecture.md "데스크톱 셸". 구현 지시: docs/archive/prompts/electron-shell.md.
// 화면은 웹 배포로만 바뀐다. 여기 바꿀 일은 브리지 계약(bridge-types.ts) · 보안 정책(policy.mjs)이 바뀔 때뿐이다.
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runHandoff } from '../../tools/handoff/lib.mjs';
import * as oracle from '../../tools/handoff/oracle.mjs';
import { createConfirm } from './confirm.mjs';
import { childEnv, findExecutables, versionOf } from './executables.mjs';
import { createLog } from './log.mjs';
import { appOrigins, authNavigationAllowed, mainNavigationAllowed, originOf, permissionAllowed, popupDecision, startUrl } from './policy.mjs';
import { Runner } from './runner.mjs';
import { LIMITS } from './validate.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
/* 패키징 빌드는 esbuild 가 'release' 로 바꿔 넣는다 — 개발용 주소 · 가짜 실행자 분기가 살아 있지 않게 */
const BUILD = globalThis.__LLMWIKI_BUILD__ ?? 'dev';
const DEV = BUILD !== 'release' && !app.isPackaged;
const devUrl = DEV ? process.env.LLMWIKI_DESKTOP_URL : undefined;
const FAKES = DEV && process.env.LLMWIKI_DESKTOP_FAKE_EXECUTORS === '1';
/* 자동 시험용 — 개발 빌드 + 가짜 실행자일 때만 확인 창을 건너뛴다(실제 외부 전송에는 쓰이지 않는다) */
const AUTO_CONFIRM = FAKES && process.env.LLMWIKI_DESKTOP_AUTO_CONFIRM === '1';
const ORIGINS = appOrigins({ packaged: !DEV, devUrl });
const START = startUrl({ packaged: !DEV, devUrl });
const PRELOAD = here('./preload.cjs');
const OFFLINE = here(BUILD === 'release' ? './static/offline.html' : '../static/offline.html');
const LOAD_TIMEOUT_MS = 10_000;

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let log = () => {};
let runner = null;
let found = { path: process.env.PATH ?? '/usr/bin:/bin', claude: null, codex: null };
let versions = {};
/** 실행 파일 찾기가 끝났나 — 창은 먼저 띄우고, capabilities 만 이것을 기다린다 */
let lookup = Promise.resolve();
let gemmaCache = { at: 0, value: { reachable: false } };
let gemmaOracle = oracle;
let FAKE_CLI_PATH = null;

/** IPC 보낸 쪽 — 본문 창의 최상위 프레임이고 허용 origin 일 때만 */
function trusted(event) {
  const f = event.senderFrame;
  const ok = Boolean(win && f && event.sender === win.webContents && f === win.webContents.mainFrame && ORIGINS.has(originOf(f.url)));
  if (!ok) log('ipc_rejected', { origin: originOf(f?.url ?? '') ?? 'null' });
  return ok;
}
const handle = (ch, fn) => ipcMain.handle(`llmwiki:${ch}`, (event, ...args) => {
  if (!trusted(event)) throw new Error('not allowed');
  return fn(...args);
});

async function gemmaStatus(force = false) {
  if (!force && Date.now() - gemmaCache.at < 60_000) return gemmaCache.value;
  const value = await gemmaOracle.queueStatus().catch(() => ({ reachable: false }));
  gemmaCache = { at: Date.now(), value };
  return value;
}

async function capabilities() {
  await lookup;
  const g = await gemmaStatus();
  const cli = (name) => found[name] || FAKES
    ? { available: true, where: 'local_cli', ...(versions[name] ? { version: versions[name] } : {}) }
    : { available: false, reason: 'not_installed', where: 'local_cli' };
  return {
    apiVersion: 1,
    shellVersion: app.getVersion(),
    platform: process.platform,
    executors: {
      claude: cli('claude'),
      codex: cli('codex'),
      gemma: g.reachable ? { available: true, where: 'oracle_queue' } : { available: false, reason: 'ssh_failed', where: 'oracle_queue' },
    },
    limits: { maxBundleBytes: LIMITS.maxBundleBytes, maxConcurrent: LIMITS.maxConcurrent, timeoutMs: LIMITS.timeoutMs },
  };
}

function execOpts(executor) {
  if (executor === 'gemma') return { oracle: gemmaOracle };
  if (FAKES) return { bin: FAKE_CLI_PATH, env: childEnv(found.path, { FAKE_MODE: executor === 'codex' ? 'codex' : 'ok' }) };
  return { bin: found[executor] ?? undefined, env: childEnv(found.path) };
}

function showOffline(code) {
  if (!win || win.isDestroyed()) return;
  log('offline', { code: String(code) });
  win.loadFile(OFFLINE, { query: { url: START, code: String(code), v: app.getVersion() } }).catch(() => undefined);
}

function guardAuthWindow(child) {
  const wc = child.webContents;
  const block = (e, url) => {
    if (!authNavigationAllowed(url, ORIGINS)) {
      e.preventDefault();
      log('auth_nav_blocked', { origin: originOf(url) ?? 'other' });
    }
  };
  wc.on('will-navigate', block);
  wc.on('will-redirect', block);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 420,
    minHeight: 560,
    title: 'llmwiki',
    show: false,
    backgroundColor: '#f7f7f5',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: DEV,
      spellcheck: false,
    },
  });
  const wc = win.webContents;
  win.once('ready-to-show', () => win.show());

  const guard = (e, url) => {
    if (url.startsWith('file://') && url.split('?')[0] === `file://${OFFLINE}`) return;
    if (!mainNavigationAllowed(url, ORIGINS)) {
      e.preventDefault();
      log('nav_blocked', { origin: originOf(url) ?? 'other' });
      if (/^https:\/\//.test(url)) shell.openExternal(url);
    }
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);
  wc.on('will-attach-webview', (e) => e.preventDefault());

  wc.setWindowOpenHandler(({ url }) => {
    const d = popupDecision(url);
    if (d === 'auth') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 680,
          parent: win,
          webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, devTools: DEV, preload: undefined },
        },
      };
    }
    if (d === 'external') shell.openExternal(url);
    else log('popup_blocked', { origin: originOf(url) ?? 'other' });
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => guardAuthWindow(child));

  // 접속 실패 · 10초 안에 안 뜨면 오프라인 안내
  let loaded = false;
  let timer = null;
  const arm = () => {
    loaded = false;
    clearTimeout(timer);
    timer = setTimeout(() => { if (!loaded) showOffline('timeout'); }, LOAD_TIMEOUT_MS);
  };
  wc.on('did-start-navigation', (e) => { if (e.isMainFrame && !e.isSameDocument && !e.url.startsWith('file:')) arm(); });
  wc.on('did-finish-load', () => { loaded = true; clearTimeout(timer); });
  wc.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* 취소(다음 탐색) */ || url.startsWith('file:')) return;
    loaded = true;
    clearTimeout(timer);
    showOffline(code);
  });
  wc.on('render-process-gone', (_e, d) => log('renderer_gone', { reason: d.reason }));

  arm();
  win.loadURL(START).catch(() => undefined);
  win.on('closed', () => { win = null; });
}

function menu() {
  const tpl = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu', submenu: [
      { label: `llmwiki 정보 (셸 ${app.getVersion()})`, click: () => dialog.showMessageBox({ message: 'llmwiki 데스크톱', detail: `셸 ${app.getVersion()} · Electron ${process.versions.electron}\n화면: ${START}\n\n화면은 웹 배포로 바뀌고, 셸은 실행(Claude · Codex · Gemma)만 맡습니다.` }) },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] }] : []),
    { role: 'editMenu' },
    { label: '보기', submenu: [
      { label: '새로고침', accelerator: 'CmdOrCtrl+R', click: () => { if (win) win.webContents.getURL().startsWith('file:') ? win.loadURL(START) : win.webContents.reload(); } },
      ...(DEV ? [{ role: 'toggleDevTools' }] : []),
      { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  log = createLog(join(app.getPath('userData'), 'logs'));
  log('start', { version: app.getVersion(), reason: DEV ? (FAKES ? 'dev-fakes' : 'dev') : 'release' });

  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, cb, details) => cb(permissionAllowed(permission, details.requestingUrl ?? wc.getURL(), ORIGINS)));
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => permissionAllowed(permission, requestingOrigin, ORIGINS));

  if (FAKES) {
    const f = await import('./fakes.mjs');
    FAKE_CLI_PATH = f.FAKE_CLI;
    gemmaOracle = f.fakeOracle();
  }
  lookup = (async () => {
    found = await findExecutables(join(app.getPath('userData'), 'config.json'));
    log('executables', { reason: `claude:${found.claude ? 'y' : 'n'} codex:${found.codex ? 'y' : 'n'}` });
    // 버전은 표시용 — 기다리지 않는다
    Promise.all([versionOf(found.claude, childEnv(found.path)), versionOf(found.codex, childEnv(found.path))]).then(([claude, codex]) => { versions = { claude, codex }; });
  })();

  runner = new Runner({
    runHandoff,
    confirm: AUTO_CONFIRM ? async () => true : createConfirm(dialog, () => win),
    emit: (e) => { if (win && !win.isDestroyed() && ORIGINS.has(originOf(win.webContents.getURL()))) win.webContents.send('llmwiki:runEvent', e); },
    dir: join(app.getPath('userData'), 'runs'),
    tmp: tmpdir(),
    execOpts,
    log,
  });
  await runner.init();

  ipcMain.on('llmwiki:hello', (event) => { event.returnValue = trusted(event); });
  handle('capabilities', () => capabilities());
  handle('run', (req) => runner.run(req));
  handle('cancel', (runId) => runner.cancel(runId));
  handle('pending', () => runner.pending());
  handle('ack', (runId) => runner.ack(runId));
  handle('running', () => runner.running());
  handle('gemmaStatus', () => gemmaStatus(true));

  menu();
  createWindow();
  const resumed = await runner.resume();
  if (resumed) log('resume', { count: resumed });
  gemmaStatus(true); // 첫 capabilities 를 빨리 — 결과는 캐시에
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (!win && app.isReady()) createWindow();
});
