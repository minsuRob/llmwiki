// preload(sandbox) — 브리지 window.llmwikiDesktop 하나만. Node API · ipcRenderer 자체는 내놓지 않는다.
// 메인이 "이 프레임이 허용 origin 의 본문 창 최상위인가"를 확인해 준 경우에만 노출한다(탐색이 뚫려도 다른 사이트엔 브리지가 없다).
const { contextBridge, ipcRenderer } = require('electron');

const ok = (() => {
  try {
    return ipcRenderer.sendSync('llmwiki:hello') === true;
  } catch {
    return false;
  }
})();

if (ok) {
  const call = (ch, ...args) => ipcRenderer.invoke(`llmwiki:${ch}`, ...args);
  const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : '');
  contextBridge.exposeInMainWorld('llmwikiDesktop', Object.freeze({
    capabilities: () => call('capabilities'),
    runHandoff: (req) => call('run', {
      runId: str(req?.runId, 40),
      itemId: str(req?.itemId, 80),
      executor: str(req?.executor, 10),
      bundleMarkdown: str(req?.bundleMarkdown, 400_000),
      ...(typeof req?.model === 'string' ? { model: str(req.model, 40) } : {}),
    }),
    onRunEvent: (cb) => {
      if (typeof cb !== 'function') return () => {};
      const h = (_e, ev) => cb(ev);
      ipcRenderer.on('llmwiki:runEvent', h);
      return () => ipcRenderer.removeListener('llmwiki:runEvent', h);
    },
    cancel: (runId) => call('cancel', str(runId, 40)),
    pendingResults: () => call('pending'),
    ack: (runId) => call('ack', str(runId, 40)),
    running: () => call('running'),
    gemmaStatus: () => call('gemmaStatus'),
  }));
}
