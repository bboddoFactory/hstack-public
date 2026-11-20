// 허브 화면(GET /) 행동 시험. 시험용 저장소로 허브 서버를 띄우고 Chrome(cdp.cjs)으로 사용자가 하듯 누르고 본다.
// 쓰는 법: node --test skills/browser-explain/scripts/hub-screen.test.mjs   (Chrome 위치는 CHROME 환경 변수)
// 화면의 약속(시험이 부르는 이름):
//   햄버거 버튼  button[aria-label^="목록 열기"]  (새 자료가 있으면 aria-label "목록 열기, 새 자료 N개", 안에 숫자 배지)
//   목록         [role=tree] 안의 [role=treeitem](aria-level 1 프로젝트, 2 작업과 "작업 보드", 3 자료), aria-expanded, aria-selected
//   본문         main 안의 iframe 하나(자료나 보드를 열었을 때). 홈에서는 "대시보드 (예정)"
//   알림 줄      [aria-label="새 자료"] 영역. 줄마다 작업 이름과 "열기", "닫기" 단추. 넷째부터 "외 N개" 단추
//   딥 링크      #<자료 id>, #보드/<프로젝트>
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { launch } = require('./cdp.cjs');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const hub = join(import.meta.dirname, 'hub.mjs');
const root = mkdtempSync(join(tmpdir(), 'hub-screen-root-'));
const stateDir = mkdtempSync(join(tmpdir(), 'hub-screen-state-'));

const page = title => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title></head><body><main class="page"><h1>${title}</h1></main></body></html>`;
const write = (rel, body) => { const f = join(root, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, body); };
const version = (project, t, m, stamp, title) => write(`data/story-map/${project}/tasks/${t}/자료/${m}/${stamp}.html`, page(title));
const board = (project, tasks) => write(`data/story-map/${project}/board.json`, JSON.stringify({ format: 2, project, verbs: [], tasks: tasks.map(([name, folder, s]) => ({ name, path: `tasks/${folder}/작업.md`, verb: null, state: s })) }));
const pad = n => String(n).padStart(2, '0');
const stampOf = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const clockOf = stamp => `${stamp.slice(9, 11)}:${stamp.slice(11, 13)}`;

// 켜기 전에 있던 자료(모두 본 것)
board('알파', [['진행 작업', '진행', 'doing'], ['많은 작업', '많음', 'doing'], ['후보 작업', '후보', 'todo'], ['끝난 작업', '끝남', 'done'], ['취소 작업', '취소', 'cancelled']]);
version('알파', '진행', '구조-설명', '20261119-120000', '구조 설명');
for (let i = 1; i <= 7; i++) version('알파', '많음', `자료-${i}`, `2026111${i}-090000`, `많은 자료 ${i}`);
version('알파', '후보', '후보-자료', '20261116-080000', '후보 자료');
version('알파', '끝남', '지난-자료', '20261110-090000', '지난 자료');
version('알파', '취소', '취소-자료', '20261111-090000', '취소 자료');
board('베타', [['베타 작업', '베타일', 'doing']]);
version('베타', '베타일', '베타-자료', '20261101-090000', '베타 자료');
mkdirSync(join(root, 'skills/browser-explain/assets'), { recursive: true });
copyFileSync(join(import.meta.dirname, '../assets/explain.css'), join(root, 'skills/browser-explain/assets/explain.css'));

let server, base, browser;
const start = () => new Promise((resolve, reject) => {
  server = spawn(process.execPath, [hub], { env: { ...process.env, PORT: '0', HSTACK_HUB_ROOT: root, HSTACK_HUB_STATE: join(stateDir, 'seen.json') } });
  let out = '';
  server.stdout.on('data', d => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\//); if (m) { base = `http://127.0.0.1:${m[1]}`; resolve(); } });
  server.on('exit', code => reject(new Error(`hub exited ${code}: ${out}`)));
  setTimeout(() => reject(new Error(`no address line: ${out}`)), 10000);
});
test.before(async () => { await start(); browser = await launch({ executablePath: CHROME }); });
test.after(async () => {
  await browser?.close();
  server.removeAllListeners('exit'); server.kill();
  rmSync(root, { recursive: true, force: true }); rmSync(stateDir, { recursive: true, force: true });
});

// ---- 화면을 다루는 작은 도구(시험 쪽). 이름과 역할로만 찾는다 ----
const sleep = ms => new Promise(r => setTimeout(r, ms));
const open = async (hash = '', width = 1440) => {
  const p = await browser.newPage();
  await p.setViewport({ width, height: 900 });
  await p.goto(`${base}/${hash}`);
  return p;
};
// 브라우저 안에서 쓸 도구. 함수 본문을 문자열로 넣는다
const TOOLS = `
  const vis = el => !!el && el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  const own = el => { const c = el.cloneNode(true); c.querySelectorAll('[role=group]').forEach(g => g.remove()); return c.textContent.replace(/\\s+/g, ' ').trim(); };
  const items = () => [...document.querySelectorAll('[role=tree] [role=treeitem]')].filter(vis);
  const item = re => items().find(el => new RegExp(re).test(own(el)));
  const named = (re, scope = document) => [...scope.querySelectorAll('button, a, [role=button], [role=treeitem]')].filter(vis).find(el => new RegExp(re).test((el.getAttribute('aria-label') || el.textContent).trim()));
  const menu = () => document.querySelector('button[aria-label^="목록 열기"]');
  const banner = () => document.querySelector('[aria-label="새 자료"]');
  const frame = () => [...document.querySelectorAll('main iframe')].find(vis);
  const framePath = () => { const f = frame(); if (!f) return null; const u = new URL(f.src, location.href); return decodeURIComponent(u.pathname) + decodeURIComponent(u.search); };
`;
const run = (p, body) => p.evaluate(new Function(`${TOOLS}; ${body}`));
const until = async (p, body, timeout = 5000, what = body) => {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await run(p, body).catch(() => undefined);
    if (v) return v;
    if (Date.now() > end) assert.fail(`기다렸지만 되지 않았다: ${what}`);
    await sleep(150);
  }
};
const openDrawer = async p => { await until(p, 'return menu()'); if (!(await run(p, 'return items().length > 0'))) await run(p, 'menu().click()'); await until(p, 'return items().length > 0', 5000, '목록이 보인다'); };
const key = async (p, k) => {
  const code = { ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39 }[k];
  for (const type of ['keyDown', 'keyUp']) await p.send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: code });
};

test('opening the hub with no link shows the home, which says the dashboard is coming', async () => {
  const p = await open();
  await until(p, 'return /대시보드 \\(예정\\)/.test(document.querySelector("main")?.textContent)', 5000, '대시보드 (예정)');
  assert.equal(await run(p, 'return !!frame()'), false, 'no material is opened');
  assert.equal(await run(p, 'return menu().getAttribute("aria-label")'), '목록 열기', 'nothing is new yet');
  await p.close();
});

test('the drawer is a tree of project, task and material, with the work board first and past work folded', async () => {
  const p = await open();
  await openDrawer(p);
  const projects = await run(p, 'return items().filter(el => el.getAttribute("aria-level") === "1").map(own)');
  assert.deepEqual(projects, ['알파', '베타'], 'projects by their latest version');
  const under = await run(p, `const all = items(); const i = all.findIndex(el => own(el) === '알파'); return all.slice(i + 1, i + 4).map(el => [el.getAttribute('aria-level'), own(el)]);`);
  assert.deepEqual(under[0], ['2', '작업 보드'], 'first row under a project is the work board');
  assert.match(under[1][1], /^진행 작업/, 'live tasks by latest version');
  assert.match(under[2][1], /^구조 설명/, 'materials under their task');
  assert.equal(await run(p, 'return !!item("^끝난 작업")'), false, 'past tasks are folded');
  await run(p, 'named("^지난 자료 2").click()');
  await until(p, 'return !!item("^끝난 작업") && !!item("^취소 작업")', 3000, '지난 자료를 펴면 끝남과 취소가 보인다');
  const many = await run(p, 'return items().filter(el => el.getAttribute("aria-level") === "3" && /^많은 자료/.test(own(el))).length');
  assert.equal(many, 5, 'five latest materials, then more');
  await run(p, 'named("^자료 2개 더").click()');
  await until(p, 'return items().filter(el => /^많은 자료/.test(own(el))).length === 7', 3000, '자료 2개 더를 누르면 일곱');
  assert.match(await run(p, 'return own(item("^구조 설명"))'), /11-19$/, 'an older material shows its date');
  assert.equal(await run(p, 'return own(item("^알파"))'), '알파', 'a project row has no time');
  await p.close();
});

test('opening a material shows it in the body, puts it in the address, and marks the row', async () => {
  const p = await open();
  await openDrawer(p);
  await run(p, 'item("^구조 설명").click()');
  await until(p, `return framePath() === '/data/story-map/알파/tasks/진행/자료/구조-설명/20261119-120000.html'`, 5000, '본문에 그 판');
  assert.equal(await run(p, 'return decodeURIComponent(location.hash.slice(1))'), '알파/진행/구조-설명');
  assert.match(await run(p, 'return document.body.textContent'), /진행 작업[\s\S]*구조 설명/, 'top bar path names the task and material');
  await openDrawer(p);
  assert.equal(await run(p, 'return item("^구조 설명").getAttribute("aria-selected")'), 'true');
  await p.close();
});

test('the work board row opens that project board in the body', async () => {
  const p = await open();
  await openDrawer(p);
  await run(p, 'items().find(el => own(el) === "작업 보드").click()');
  await until(p, `return framePath() === '/skills/story-map/board/?p=알파'`, 5000, '본문에 알파 보드');
  assert.equal(await run(p, 'return decodeURIComponent(location.hash.slice(1))'), '보드/알파');
  await p.close();
});

test('a deep link opens its material, and an unknown one says so and opens the drawer', async () => {
  let p = await open('#' + encodeURIComponent('알파/진행/구조-설명'));
  await until(p, `return framePath() === '/data/story-map/알파/tasks/진행/자료/구조-설명/20261119-120000.html'`, 5000, '딥 링크의 판');
  await p.close();
  p = await open('#' + encodeURIComponent('없는/작업/자료'));
  await until(p, 'return /이 자료를 찾지 못했다/.test(document.body.textContent) && items().length > 0', 5000, '찾지 못했다는 안내와 열린 목록');
  await p.close();
});

const fresh = [['알파', '진행', '새-하나', '진행 작업'], ['알파', '후보', '새-둘', '후보 작업'], ['알파', '많음', '새-셋', '많은 작업'], ['베타', '베타일', '새-넷', '베타 작업']];
let freshStamp;

test('versions that go up while the hub is open show without reloading: badge, banner of three and "외 1개", NEW', async () => {
  const p = await open();
  await until(p, 'return menu()');
  await sleep(1100); // 서버를 켠 초보다 나중의 판이어야 새 것이다
  freshStamp = stampOf(new Date());
  for (const [pr, t, m] of fresh) version(pr, t, m, freshStamp, m.replace('-', ' '));
  await until(p, 'return menu().getAttribute("aria-label") === "목록 열기, 새 자료 4개"', 15000, '10초 안에 배지 4');
  assert.match(await run(p, 'return menu().textContent'), /4/);
  const rows = await run(p, 'return [...banner().querySelectorAll("button")].filter(vis).filter(b => (b.getAttribute("aria-label") || b.textContent).trim() === "열기").length');
  assert.equal(rows, 3, 'three rows, the fourth is folded');
  await run(p, 'named("^외 1개", banner()).click()');
  await until(p, 'return [...banner().querySelectorAll("button")].filter(vis).filter(b => (b.getAttribute("aria-label") || b.textContent).trim() === "열기").length === 4', 3000, '외 1개를 펴면 넷');
  await openDrawer(p);
  const row = await run(p, 'return own(item("^새 하나"))');
  assert.match(row, /NEW/);
  assert.match(row, new RegExp(clockOf(freshStamp) + '$'), "today's material shows its time");
  assert.ok(await run(p, 'return [...item("^진행 작업").querySelectorAll("*")].some(el => !el.closest("[role=group]") && el.children.length === 0 && el.textContent.trim() === "1")'), 'task row shows its unseen count badge 1');
  await p.close();
});

test('opening from the banner opens that material and clears its NEW everywhere, also after reload', async () => {
  const p = await open();
  await until(p, 'return !!banner() && vis(banner())', 5000, '알림 줄');
  await run(p, `const row = [...banner().querySelectorAll('*')].find(el => /진행 작업/.test(el.textContent) && named('^열기$', el)); named('^열기$', row).click();`);
  await until(p, `return framePath() === '/data/story-map/알파/tasks/진행/자료/새-하나/${freshStamp}.html'`, 5000, '알림 줄의 열기로 새 판');
  await until(p, 'return menu().getAttribute("aria-label") === "목록 열기, 새 자료 3개"', 5000, '배지 3');
  await p.reload();
  await until(p, 'return menu().getAttribute("aria-label") === "목록 열기, 새 자료 3개"', 5000, '다시 읽어도 3');
  await openDrawer(p);
  assert.doesNotMatch(await run(p, 'return own(item("^새 하나"))'), /NEW/);
  await p.close();
});

test('closing a banner row only hides it there: NEW and the count stay, and it stays hidden after reload', async () => {
  const p = await open();
  await until(p, 'return !!banner() && /후보 작업/.test(banner().textContent)', 5000, '후보 작업 알림');
  await run(p, `const row = [...banner().querySelectorAll('*')].find(el => /후보 작업/.test(el.textContent) && named('^닫기$', el)); named('^닫기$', row).click();`);
  await until(p, 'return !banner() || !vis(banner()) || !/후보 작업/.test(banner().innerText)', 3000, '닫은 줄이 사라진다');
  assert.equal(await run(p, 'return menu().getAttribute("aria-label")'), '목록 열기, 새 자료 3개', 'count stays');
  await p.reload();
  await until(p, 'return menu().getAttribute("aria-label") === "목록 열기, 새 자료 3개"');
  assert.equal(await run(p, 'return !!banner() && vis(banner()) && /후보 작업/.test(banner().innerText)'), false, 'still hidden after reload');
  await openDrawer(p);
  assert.match(await run(p, 'return own(item("^새 둘"))'), /NEW/, 'NEW stays');
  await p.close();
});

// 목록 API를 실패시킨다(DevTools Fetch 가로채기)
const failList = async p => {
  await p.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/list*' }] });
  p.connection.on(m => { if (m.sessionId === p.sessionId && m.method === 'Fetch.requestPaused') p.send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'ConnectionRefused' }).catch(() => {}); });
};

test('if the list cannot be read the drawer says so and offers retry; a failed refresh keeps the last list', async () => {
  let p = await browser.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  await failList(p);
  await p.goto(`${base}/`);
  await until(p, 'return menu()');
  await run(p, 'menu().click()');
  await until(p, 'return /목록을 불러오지 못했다/.test(document.body.innerText) && !!named("^다시 시도")', 5000, '실패 안내와 다시 시도');
  await p.send('Fetch.disable');
  await run(p, 'named("^다시 시도").click()');
  await until(p, 'return items().length > 0', 5000, '다시 시도하면 목록');
  await p.close();

  p = await open();
  await openDrawer(p);
  await failList(p);
  await sleep(11000); // 다시 읽기 한 번이 실패할 시간
  assert.ok(await run(p, 'return items().length > 0 && !/목록을 불러오지 못했다/.test(document.body.innerText)'), 'last list stays');
  await p.close();
});

test('the tree works with the keyboard: arrows move, left folds, right unfolds', async () => {
  const p = await open();
  await openDrawer(p);
  await run(p, 'item("^알파$").focus()');
  await key(p, 'ArrowDown');
  assert.equal(await run(p, 'return own(document.activeElement)'), '작업 보드');
  await key(p, 'ArrowUp');
  await key(p, 'ArrowLeft');
  const nextOfAlpha = 'const all = items(); const i = all.indexOf(item("^알파$")); return all[i + 1] ? all[i + 1].getAttribute("aria-level") : "none";';
  await until(p, `return item("^알파$").getAttribute("aria-expanded") === "false" && ['1', 'none'].includes((() => { ${nextOfAlpha} })())`, 3000, '왼쪽으로 접힘: 알파 아래 줄이 사라진다');
  await key(p, 'ArrowRight');
  await until(p, `return item("^알파$").getAttribute("aria-expanded") === "true" && (() => { ${nextOfAlpha} })() === '2'`, 3000, '오른쪽으로 펼침: 알파 아래 줄이 다시 보인다');
  await p.close();
});

test('at phone width the drawer leaves room to tap away, rows are tall enough, and nothing scrolls sideways', async () => {
  const p = await open('', 390);
  await openDrawer(p);
  const m = await run(p, `const tree = document.querySelector('[role=tree]'); return { page: document.documentElement.scrollWidth, drawer: tree.closest('dialog, aside, nav, [role=dialog]')?.getBoundingClientRect().width ?? tree.getBoundingClientRect().width, short: items().filter(el => el.getBoundingClientRect().height < 44).map(own) };`);
  assert.ok(m.page <= 390, `page ${m.page}px wide`);
  assert.ok(m.drawer <= 342, `drawer ${m.drawer}px`);
  assert.deepEqual(m.short, [], 'rows at least 44px');
  await p.close();
});
