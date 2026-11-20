// 허브 서버: hstack 저장소를 지금 주소 그대로 내보내고(정적 제공), 설명 자료 목록(GET /api/list)과 본 판 기록(POST /api/seen)을 준다.
// 쓰는 법: node hub.mjs [plist|install|uninstall]   (plist는 launchd 설정을 찍는다. install, uninstall은 이 맥에서 로그인 때 켜기를 올리고 내린다)
//   PORT(기본 27180, 0이면 빈 포트), HSTACK_HUB_ROOT(저장소 루트), HSTACK_HUB_STATE(본 상태 파일, 기본 ~/.hstack-hub/seen.json),
//   HSTACK_HUB_HOSTS(127.0.0.1·localhost 말고 받을 Host 이름, 쉼표로 여럿. 포트 없이 쓰면 어느 포트든 받는다),
//   HSTACK_DIAGRAM(그림 엔진 폴더, 기본 ~/workspace/hstack-diagram. 그 viewer/를 그림 뷰어 주소로 내보낸다)
// 목록은 요청마다 파일에서 계산한다(따로 저장하는 두 번째 원본이 없다). 본 상태 파일을 쓰는 쪽은 이 프로세스 하나다.
import http from 'node:http';
import { createReadStream, readFileSync, readdirSync, statSync, openSync, readSync, closeSync, writeFileSync, renameSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, extname, dirname } from 'node:path';
import { homedir } from 'node:os';

const ROOT = resolve(process.env.HSTACK_HUB_ROOT || join(import.meta.dirname, '../../..'));
const STATE = resolve(process.env.HSTACK_HUB_STATE || join(homedir(), '.hstack-hub', 'seen.json'));
const EXTRA_HOSTS = (process.env.HSTACK_HUB_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const HUB_SCREEN = join(import.meta.dirname, '../assets/hub.html');
const PORT = process.env.PORT ? Number(process.env.PORT) : 27180; // 빈 값은 plist가 빼는 것과 같이 설정 없음으로 본다
// explain.mjs와 같은 규칙으로 엔진 폴더를 찾는다
const ENGINE = resolve(process.env.HSTACK_DIAGRAM || join(homedir(), 'workspace/hstack-diagram'));
const VIEWER_URL = '/data/story-map/hstack-diagram/viewer';

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };

// ---- 이 맥에서 늘 켜 두기: launchd agent. plist는 여기서 만들어 내는 파생물이라 저장소에 두지 않는다 ----
const LABEL = 'com.hstack.hub';
const LOG = join(dirname(STATE), 'hub.log');
const PLIST_FILE = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const xml = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const plist = () => {
  const env = Object.entries({ PORT: process.env.PORT, HSTACK_HUB_ROOT: process.env.HSTACK_HUB_ROOT, HSTACK_HUB_STATE: process.env.HSTACK_HUB_STATE, HSTACK_HUB_HOSTS: process.env.HSTACK_HUB_HOSTS, HSTACK_DIAGRAM: process.env.HSTACK_DIAGRAM }).filter(([, v]) => v);
  const str = v => `<string>${xml(v)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>${str(LABEL)}
  <key>ProgramArguments</key>
  <array>${str(process.execPath)}${str(join(import.meta.dirname, 'hub.mjs'))}</array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
${env.length ? `  <key>EnvironmentVariables</key>
  <dict>
${env.map(([k, v]) => `    <key>${k}</key>${str(v)}`).join('\n')}
  </dict>
` : ''}  <key>StandardOutPath</key>${str(LOG)}
  <key>StandardErrorPath</key>${str(LOG)}
</dict>
</plist>
`;
};

const launchctl = (...args) => {
  try { execFileSync('launchctl', args, { stdio: ['ignore', 'pipe', 'pipe'] }); return null; }
  catch (e) { return String(e.stderr || e.message).trim().split('\n')[0] || 'launchctl 실패'; }
};

// 종료 코드를 돌려준다
const runCommand = cmd => {
  if (cmd === 'plist') { process.stdout.write(plist()); return 0; }
  if (cmd !== 'install' && cmd !== 'uninstall') { console.error(`알 수 없는 명령: ${cmd} (plist, install, uninstall)`); return 1; }
  if (process.platform !== 'darwin') { console.error('이 OS는 아직 지원하지 않는다'); return 1; }
  const domain = `gui/${process.getuid()}`;
  if (cmd === 'uninstall') {
    if (!existsSync(PLIST_FILE)) { console.log('설치되어 있지 않다'); return 0; }
    launchctl('bootout', `${domain}/${LABEL}`); // 올라가 있지 않아도 파일은 지운다
    rmSync(PLIST_FILE, { force: true });
    console.log('내렸다');
    return 0;
  }
  mkdirSync(dirname(PLIST_FILE), { recursive: true });
  mkdirSync(dirname(LOG), { recursive: true }); // launchd는 로그 폴더를 만들지 않는다
  writeFileSync(PLIST_FILE, plist());
  launchctl('bootout', `${domain}/${LABEL}`); // 이미 올라가 있으면 내리고 다시 올린다
  const failed = launchctl('bootstrap', domain, PLIST_FILE);
  if (failed) { console.error(`launchctl 실패: ${failed}`); return 1; }
  console.log(`허브: http://127.0.0.1:${PORT}/`);
  return 0;
};

// 명령은 본 상태 파일을 만들거나 서버를 띄우기 전에 끝낸다
if (process.argv[2]) process.exit(runCommand(process.argv[2]));

// ---- 목록: 파일에서 매번 계산하는 파생값 ----
const VERSION = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.html$/;
const names = dir => { try { return readdirSync(dir); } catch { return []; } };
const isDir = p => { try { return statSync(p).isDirectory(); } catch { return false; } }; // 심볼릭 링크는 따라간다

// 판 이름의 시각은 올린 PC의 지역 시각이다. 이 PC의 시간대로 읽어 ISO(오프셋 포함)로 낸다.
const stampDate = file => { const m = VERSION.exec(file); return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]); };
const iso = d => {
  const p = (n, w = 2) => String(Math.abs(n)).padStart(w, '0'), off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${off < 0 ? '-' : '+'}${p(Math.trunc(off / 60))}:${p(off % 60)}`;
};

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
// 제목은 <head> 안에 있다. 앞 16KB만 읽고, 못 읽으면 던진다(그 자료만 빠진다).
const titleOf = file => {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(16384);
    const html = buf.toString('utf8', 0, readSync(fd, buf, 0, buf.length, 0));
    const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
    return t ? t.replace(/&(?:amp|lt|gt|quot|#39);/g, e => ENTITIES[e]).replace(/\s+/g, ' ').trim() : '';
  } finally { closeSync(fd); }
};

// 보드가 없거나 깨졌으면 빈 표: 그 프로젝트의 작업은 모두 진행 중으로 보인다(숨기지 않는다).
const boardCards = project => {
  try {
    const cards = new Map();
    for (const c of JSON.parse(readFileSync(join(ROOT, 'data/story-map', project, 'board.json'), 'utf8')).tasks) {
      const m = /^tasks\/([^/]+)\/작업\.md$/.exec(c?.path ?? '');
      if (m) cards.set(m[1], c);
    }
    return cards;
  } catch { return new Map(); }
};

const urlPart = s => s.replace(/[%#?\s]/g, encodeURIComponent);

const scan = () => {
  const out = [];
  const storyMap = join(ROOT, 'data/story-map');
  for (const project of names(storyMap)) {
    if (!isDir(join(storyMap, project))) continue;
    const cards = boardCards(project);
    const tasks = [];
    for (const task of names(join(storyMap, project, 'tasks'))) {
      const materialsDir = join(storyMap, project, 'tasks', task, '자료');
      const materials = [];
      for (const material of names(materialsDir)) {
        const dir = join(materialsDir, material);
        if (!isDir(dir)) continue;
        const versions = names(dir).filter(f => VERSION.test(f)).sort().map(f => f.slice(0, -5));
        if (!versions.length) continue;
        const latest = versions.at(-1);
        let title;
        try { title = titleOf(join(dir, `${latest}.html`)); } catch { continue; }
        const date = stampDate(`${latest}.html`);
        materials.push({
          id: `${project}/${task}/${material}`, title: title || material.replace(/-/g, ' '), version: latest, versions,
          url: `/data/story-map/${[project, 'tasks', task, '자료', material, `${latest}.html`].map(urlPart).join('/')}`,
          time: iso(date), at: date.getTime(),
        });
      }
      if (!materials.length) continue;
      materials.sort((a, b) => b.at - a.at);
      const card = cards.get(task);
      const state = typeof card?.state === 'string' ? card.state : 'doing';
      tasks.push({ id: task, name: card?.name || task, state, past: state === 'done' || state === 'cancelled', materials, at: materials[0].at });
    }
    if (!tasks.length) continue;
    tasks.sort((a, b) => a.past - b.past || b.at - a.at);
    out.push({ id: project, tasks, at: Math.max(...tasks.map(t => t.at)) });
  }
  return out.sort((a, b) => b.at - a.at);
};

// 처음 켠 시각(since)보다 먼저 올린 판은 본 것으로 친다. 그 뒤 판은 본 판과 다를 때만 안 본 것이다.
const publicList = (projects, state) => ({
  projects: projects.map(p => ({
    id: p.id,
    tasks: p.tasks.map(t => ({
      id: t.id, name: t.name, state: t.state, past: t.past,
      materials: t.materials.map(m => ({ id: m.id, title: m.title, version: m.version, url: m.url, time: m.time, unseen: m.version !== state.seen[m.id] && m.at > Date.parse(state.since) })),
    })),
  })),
});

// ---- 본 상태: 이 프로세스만 쓴다. 임시 파일에 쓰고 rename해 반쯤 쓴 파일이 남지 않게 한다 ----
const saveState = s => { mkdirSync(dirname(STATE), { recursive: true }); writeFileSync(`${STATE}.tmp`, JSON.stringify(s, null, 2)); renameSync(`${STATE}.tmp`, STATE); };
const loadState = () => {
  if (existsSync(STATE)) {
    try {
      const s = JSON.parse(readFileSync(STATE, 'utf8'));
      if (typeof s.since === 'string' && !Number.isNaN(Date.parse(s.since)) && s.seen && typeof s.seen === 'object') return s;
    } catch { /* 아래에서 깨진 파일로 다룬다 */ }
    renameSync(STATE, `${STATE}.broken`);
    console.error(`본 상태 파일을 읽을 수 없어 ${STATE}.broken으로 옮기고 새로 만든다`);
  }
  const fresh = { since: new Date().toISOString(), seen: {} };
  saveState(fresh); // since는 처음 켤 때 한 번 정해 파일에 남겨야 다시 켜도 유지된다
  return fresh;
};
const state = loadState();

// ---- 요청 경계: Host, Origin, 경로 ----
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'cache-control': 'no-cache', ...headers });
  res.end(body);
};
const sendJson = (res, status, value) => send(res, status, JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8' });
const text = (res, status, message) => send(res, status, message, { 'content-type': 'text/plain; charset=utf-8' });

const hostAllowed = (host, port) => {
  host = (host || '').toLowerCase();
  if (!host) return false;
  if (host === `127.0.0.1:${port}` || host === `localhost:${port}`) return true;
  const name = host.replace(/:\d+$/, '');
  return EXTRA_HOSTS.some(h => h === host || (!/:\d+$/.test(h) && h === name));
};
// Tailscale serve는 https를 http로 넘기므로 스킴은 비교하지 않고 호스트(포트 포함)만 본다.
const originMatchesHost = (origin, host) => { try { return new URL(origin).host.toLowerCase() === host.toLowerCase(); } catch { return false; } };

const readBody = (req, limit = 4096) => new Promise((resolveBody, reject) => {
  let data = '';
  req.setEncoding('utf8');
  req.on('data', d => { data += d; if (data.length > limit) { reject(new Error('too large')); req.destroy(); } });
  req.on('end', () => resolveBody(data));
  req.on('error', reject);
});

const handleSeen = async (req, res) => {
  const host = req.headers.host;
  if (!req.headers.origin || !originMatchesHost(req.headers.origin, host)) return text(res, 403, '다른 출처의 요청');
  let id, version;
  try { ({ id, version } = JSON.parse(await readBody(req))); } catch { return text(res, 400, '본문은 {id, version} JSON'); }
  const material = scan().flatMap(p => p.tasks.flatMap(t => t.materials)).find(m => m.id === id);
  if (typeof id !== 'string' || typeof version !== 'string' || !material || !material.versions.includes(version)) return text(res, 400, '없는 자료나 판');
  state.seen[id] = version;
  saveState(state);
  sendJson(res, 200, { ok: true });
};

// 저장소 안의 파일 하나를 내보낸다. 디렉터리는 index.html이 있을 때만 연다(목록은 보이지 않는다).
const serveStatic = (req, res, url) => {
  let pathname;
  try { pathname = decodeURIComponent(url.split(/[?#]/)[0]); } catch { return text(res, 400, '잘못된 주소'); }
  if (!pathname.startsWith('/') || pathname.includes('\0')) return text(res, 400, '잘못된 주소');
  // 디코딩한 뒤에 ..를 거른다: %2e%2e와 %2f로 만든 ..도 여기서 걸린다
  if (pathname.split('/').includes('..')) return text(res, 403, '저장소 밖 경로');
  // .git 같은 숨은 폴더와 파일은 Tailscale 안에서도 내보내지 않는다
  if (pathname.split('/').some(seg => seg.startsWith('.'))) return text(res, 404, '없는 파일');
  // 그림 뷰어 주소만 엔진 폴더의 viewer/에서 내보낸다(PC마다 다른 data/ 안 링크에 기대지 않는다)
  const viewer = pathname === VIEWER_URL || pathname.startsWith(`${VIEWER_URL}/`);
  let file = viewer ? join(ENGINE, 'viewer', pathname.slice(VIEWER_URL.length)) : join(ROOT, pathname), info;
  try { info = statSync(file); } catch { return text(res, 404, '없는 파일'); }
  if (info.isDirectory()) {
    if (!pathname.endsWith('/')) return send(res, 301, '', { location: `${url.split(/[?#]/)[0]}/${url.includes('?') ? url.slice(url.indexOf('?')) : ''}` });
    file = join(file, 'index.html');
    try { info = statSync(file); } catch { return text(res, 404, '없는 파일'); }
  }
  if (!info.isFile()) return text(res, 404, '없는 파일');
  sendFile(req, res, file, info);
};

// 파일 하나를 ETag와 Last-Modified로 재검증하며 내보낸다
const sendFile = (req, res, file, info) => {
  const etag = `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
  const headers = { 'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', etag, 'last-modified': info.mtime.toUTCString(), 'cache-control': 'no-cache' };
  const none = req.headers['if-none-match'], since = req.headers['if-modified-since'];
  const fresh = none !== undefined ? none.split(',').some(t => t.trim() === etag || t.trim() === '*') : since !== undefined && Math.trunc(info.mtimeMs / 1000) <= Math.trunc(Date.parse(since) / 1000);
  if (fresh) { res.writeHead(304, headers); res.end(); return; }
  res.writeHead(200, { ...headers, 'content-length': info.size });
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = createReadStream(file);
  stream.on('error', e => { console.error(`읽기 실패 ${file}: ${e.message}`); res.destroy(); });
  stream.pipe(res);
};

const server = http.createServer(async (req, res) => {
  try {
    if (!hostAllowed(req.headers.host, server.address().port)) return text(res, 403, '허용하지 않는 Host');
    const path = req.url.split(/[?#]/)[0];
    if (path === '/api/list') {
      if (req.method !== 'GET') return text(res, 405, 'GET만');
      return sendJson(res, 200, publicList(scan(), state));
    }
    if (path === '/api/seen') {
      if (req.method !== 'POST') return text(res, 405, 'POST만');
      return await handleSeen(req, res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405, 'GET만');
    // 허브 화면은 스킬 안의 파일이다: 어떤 HSTACK_HUB_ROOT로 띄워도 `/`가 열린다
    if (path === '/') return sendFile(req, res, HUB_SCREEN, statSync(HUB_SCREEN));
    serveStatic(req, res, req.url);
  } catch (e) {
    console.error(`${req.method} ${req.url}: ${e.stack?.split('\n')[0] ?? e}`);
    if (!res.headersSent) text(res, 500, '서버 오류'); else res.destroy();
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`허브: http://127.0.0.1:${server.address().port}/`));
