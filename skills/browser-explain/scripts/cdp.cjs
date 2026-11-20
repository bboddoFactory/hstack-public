// check가 쓰는 만큼만 Chrome을 모는 작은 DevTools Protocol 클라이언트. puppeteer-core(엔진 저장소의 node_modules)에 기대지 않으려고 둔다.
// Node 22 이상의 내장 WebSocket을 쓴다. 쓰는 법: const browser = await launch({executablePath}); const page = await browser.newPage(); ... await browser.close();
const {spawn} = require('node:child_process');
const {mkdtempSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {existsSync} = require('node:fs');

// Chrome 위치는 여기서 한 번 정한다. 환경 변수로 준 경로는 사용자가 고른 것이라 있는지 따지지 않고 그대로 쓴다.
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WIN_CHROME_TAIL = '\\Google\\Chrome\\Application\\chrome.exe';
const LINUX_CHROMES = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
function findChrome({platform = process.platform, env = process.env, exists = existsSync} = {}) {
  if (env.CHROME) return env.CHROME;
  if (env.CHROME_PATH) return env.CHROME_PATH;
  const candidates = platform === 'darwin' ? [MAC_CHROME]
    : platform === 'win32' ? [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).map(base => base + WIN_CHROME_TAIL)
    : LINUX_CHROMES;
  return candidates.find(exists) ?? null;
}

class Connection {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Set();
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const call = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (call) message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result);
      } else for (const listener of this.listeners) listener(message);
    });
    ws.addEventListener('close', () => { for (const call of this.pending.values()) call.reject(new Error('Chrome 연결이 끊겼다')); this.pending.clear(); });
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, {resolve, reject});
      this.ws.send(JSON.stringify({id, method, params, sessionId}));
    });
  }
  on(listener) { this.listeners.add(listener); }
}

class Page {
  constructor(connection, targetId, sessionId) {
    Object.assign(this, {connection, targetId, sessionId});
    this.inflight = new Set(); this.loaded = false; this.main = null; this.notify = () => {};
    connection.on(message => {
      if (message.sessionId !== sessionId) return;
      const p = message.params;
      if (message.method === 'Network.requestWillBeSent' && !p.request.url.startsWith('data:')) this.inflight.add(p.requestId);
      else if (message.method === 'Network.loadingFinished' || message.method === 'Network.loadingFailed') this.inflight.delete(p.requestId);
      // 맨 위 문서의 frameId는 target id와 같다. 처음 오는 문서 응답이 리디렉션 뒤의 마지막 응답이다.
      else if (message.method === 'Network.responseReceived' && p.type === 'Document' && p.frameId === targetId && !this.main) this.main = {requestId: p.requestId, status: p.response.status};
      else if (message.method === 'Page.loadEventFired') this.loaded = true;
      else if (message.method === 'Page.javascriptDialogOpening') this.send('Page.handleJavaScriptDialog', {accept: false}).catch(() => {});
      this.notify();
    });
  }
  send(method, params) { return this.connection.send(method, params, this.sessionId); }
  // puppeteer의 networkidle0: 읽기를 마친 뒤 요청이 하나도 없는 채로 500ms
  async settle(start, timeout) {
    this.inflight.clear(); this.loaded = false; this.main = null;
    const idle = new Promise((resolve, reject) => {
      let timer;
      const limit = setTimeout(() => { this.notify = () => {}; clearTimeout(timer); reject(new Error(`페이지를 여는 데 ${timeout}ms가 넘게 걸렸다`)); }, timeout);
      this.notify = () => {
        clearTimeout(timer);
        if (this.loaded && !this.inflight.size) timer = setTimeout(() => { clearTimeout(limit); this.notify = () => {}; resolve(); }, 500);
      };
    });
    await start();
    await idle;
  }
  async goto(url, {timeout = 30000} = {}) {
    await this.settle(async () => {
      const {errorText} = await this.send('Page.navigate', {url});
      if (errorText) throw new Error(`${url}: ${errorText}`);
    }, timeout);
    const main = this.main;
    if (!main) return null;
    return {
      status: () => main.status,
      text: async () => { const body = await this.send('Network.getResponseBody', {requestId: main.requestId}); return body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body; },
    };
  }
  reload({timeout = 30000} = {}) { return this.settle(() => this.send('Page.reload'), timeout); }
  setViewport({width, height}) { return this.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false}); }
  emulateMediaFeatures(features) { return this.send('Emulation.setEmulatedMedia', {features}); }
  async evaluate(fn, ...args) {
    const result = await this.send('Runtime.evaluate', {expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  close() { return this.connection.send('Target.closeTarget', {targetId: this.targetId}).catch(() => {}); }
}

async function launch({executablePath}) {
  if (typeof WebSocket === 'undefined') throw new Error('Node 22 이상이 필요합니다(내장 WebSocket을 씁니다)');
  const profile = mkdtempSync(join(tmpdir(), 'explain-chrome-'));
  const flags = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', 'about:blank'];
  const child = spawn(executablePath, flags, {stdio: ['ignore', 'ignore', 'pipe']});
  // 실행 파일이 없으면 exit 없이 error만 오므로 둘 다 기다리지 않으면 cleanup이 끝나지 않는다
  const exited = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
  const cleanup = async () => { child.kill('SIGKILL'); await exited; rmSync(profile, {recursive: true, force: true, maxRetries: 3}); };
  try {
    const url = await new Promise((resolve, reject) => {
      let text = '';
      const limit = setTimeout(() => reject(new Error('Chrome이 15초 안에 준비되지 않았다')), 15000);
      child.once('error', error => { clearTimeout(limit); reject(new Error(error.code === 'ENOENT' ? `Chrome을 찾을 수 없습니다: ${executablePath}. CHROME 환경 변수로 위치를 지정하세요.` : error.message)); });
      child.once('exit', () => { clearTimeout(limit); reject(new Error('Chrome이 바로 종료됐다')); });
      child.stderr.on('data', chunk => { text += chunk; const found = text.match(/DevTools listening on (ws:\/\/\S+)/); if (found) { clearTimeout(limit); resolve(found[1]); } });
    });
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, {once: true}); ws.addEventListener('error', () => reject(new Error('Chrome에 연결하지 못했다')), {once: true}); });
    const connection = new Connection(ws);
    return {
      async newPage() {
        const {targetId} = await connection.send('Target.createTarget', {url: 'about:blank'});
        const {sessionId} = await connection.send('Target.attachToTarget', {targetId, flatten: true});
        const page = new Page(connection, targetId, sessionId);
        await Promise.all([page.send('Page.enable'), page.send('Network.enable')]);
        return page;
      },
      async close() {
        await connection.send('Browser.close').catch(() => {});
        await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
        await cleanup();
      },
    };
  } catch (error) { await cleanup(); throw error; }
}

module.exports = {launch, findChrome};
