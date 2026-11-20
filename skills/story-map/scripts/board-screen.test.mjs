// 작업 보드 화면(skills/story-map/board/?p=<프로젝트>) 행동 시험. 시험용 저장소를 허브로 띄우고 Chrome(cdp.cjs)으로 사용자가 하듯 보고 누른다.
// 쓰는 법: node --test skills/story-map/scripts/board-screen.test.mjs   (Chrome 위치는 CHROME 환경 변수)
// 화면의 약속(시험이 부르는 이름):
//   제목         h1 "작업 보드"
//   상태 열      main 안의 section 넷. 머리 h2 "<상태> <개수>"(후보, 진행 중, 완료, 취소 순). 카드는 그 안의 button(작업 이름)
//   좁은 화면    [role=tablist] 안의 [role=tab] "<상태> <개수>", aria-selected. 처음은 진행 중. 좌우 화살표로 옮긴다
//   작업 문서    카드를 누르면 dialog[open], 안에 "닫기" 단추. 못 읽으면 "작업 문서를 읽지 못했습니다"
//   사용자 행동  board.json의 verbs와 verb는 읽지 않는다(화면에 보이지 않고, 등록되지 않은 verb도 오류가 아니다)
//   허브 안      허브(/#보드/<프로젝트>)의 본문 iframe에서 열리면 프로젝트 이름과 h1을 숨기고, 제품 설명 줄은 보인다
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const repo = resolve(import.meta.dirname, '../../..');
const require = createRequire(import.meta.url);
const { launch, findChrome } = require(join(repo, 'skills/browser-explain/scripts/cdp.cjs'));
const hub = join(repo, 'skills/browser-explain/scripts/hub.mjs');
const root = mkdtempSync(join(tmpdir(), 'board-screen-root-'));
const stateDir = mkdtempSync(join(tmpdir(), 'board-screen-state-'));

const write = (rel, body) => { const f = join(root, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body)); };
// 화면이 불러 쓰는 파일은 저장소의 것을 그대로 같은 자리에 둔다
cpSync(join(repo, 'skills/story-map/board'), join(root, 'skills/story-map/board'), { recursive: true });
cpSync(join(repo, 'skills/browser-explain/assets'), join(root, 'skills/browser-explain/assets'), { recursive: true });

// 알파: 아직 옮기지 않은 보드(verbs, verb가 남아 있고 하나는 등록되지 않은 행동)
write('data/story-map/알파/board.json', {
  format: 'task-board', project: '알파 제품',
  verbs: [{ name: '메모 쓰기', about: '메모를 남긴다' }],
  tasks: [
    { name: '저장 오류 수정', path: 'tasks/저장/작업.md', verb: '메모 쓰기', state: 'doing' },
    { name: '검색 붙이기', path: 'tasks/검색/작업.md', verb: null, state: 'todo' },
    { name: '설명 자료 서버', path: 'tasks/서버/작업.md', verb: '없는 행동', state: 'doing' },
    { name: '태그 고르기', path: 'tasks/태그/작업.md', verb: null, state: 'todo' },
    { name: '첫 화면 만들기', path: 'tasks/첫화면/작업.md', verb: null, state: 'done' },
  ],
});
write('data/story-map/알파/product.md', '---\nsummary: "메모를 잃지 않게 한다"\n---\n# 알파 제품\n');
write('data/story-map/알파/tasks/저장/작업.md', '# 저장 오류 수정\n\n## 목적\n\n저장이 실패하면 알린다.\n\n- 완료 기준 하나\n');
// 베타: 옮긴 뒤의 보드(verbs도 verb도 없다)
write('data/story-map/베타/board.json', { format: 'task-board', project: '베타', tasks: [{ name: '베타 작업', path: 'tasks/베타/작업.md', state: 'doing' }] });
// 감마: 기존 에픽 보드
write('data/story-map/감마/board.json', {
  project: '감마',
  rows: [{ name: '기록-화면', goal: '기록을 남긴다', state: '하는 중' }, { name: '후보' }],
  verbs: [{ name: '메모 쓰기', about: '메모를 남긴다', cells: [[{ name: '메모 저장', state: 'done' }], []] }],
});
// 델타: 잘못된 상태
write('data/story-map/델타/board.json', { format: 'task-board', project: '델타', tasks: [{ name: '이상한 작업', path: 'tasks/이상/작업.md', state: 'paused' }] });

let server, base, browser;
const start = () => new Promise((ok, fail) => {
  server = spawn(process.execPath, [hub], { env: { ...process.env, PORT: '0', HSTACK_HUB_ROOT: root, HSTACK_HUB_STATE: join(stateDir, 'seen.json') } });
  let out = '';
  server.stdout.on('data', d => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\//); if (m) { base = `http://127.0.0.1:${m[1]}`; ok(); } });
  server.on('exit', code => fail(new Error(`hub exited ${code}: ${out}`)));
  setTimeout(() => fail(new Error(`no address line: ${out}`)), 10000);
});
test.before(async () => { await start(); browser = await launch({ executablePath: findChrome() }); });
test.after(async () => {
  await browser?.close();
  server.removeAllListeners('exit'); server.kill();
  rmSync(root, { recursive: true, force: true }); rmSync(stateDir, { recursive: true, force: true });
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const open = async (project, width = 1440, dark = false) => {
  const p = await browser.newPage();
  await p.setViewport({ width, height: 900 });
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }]);
  await p.goto(`${base}/skills/story-map/board/?p=${encodeURIComponent(project)}`);
  return p;
};
const TOOLS = `
  const vis = el => !!el && el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  const text = el => el.textContent.replace(/\\s+/g, ' ').trim();
  const columns = () => [...document.querySelectorAll('main section')].filter(vis);
  const heads = () => columns().map(s => text(s.querySelector('h2')));
  const cards = (scope = document) => [...scope.querySelectorAll('main section button')].filter(vis).map(text);
  const tabs = () => [...document.querySelectorAll('[role=tablist] [role=tab]')].filter(vis);
  const selected = () => tabs().filter(t => t.getAttribute('aria-selected') === 'true').map(text);
  const named = re => [...document.querySelectorAll('button, [role=tab], [role=button]')].filter(vis).find(el => new RegExp(re).test(text(el)));
  const dialog = () => document.querySelector('dialog[open]');
  const fontSizes = scope => { const out = new Set(); for (const el of scope.querySelectorAll('*')) { if (!vis(el)) continue; if ([...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) out.add(parseFloat(getComputedStyle(el).fontSize)); } return [...out].sort((a, b) => a - b); };
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
const key = async (p, k) => {
  const code = { ArrowLeft: 37, ArrowRight: 39 }[k];
  for (const type of ['keyDown', 'keyUp']) await p.send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: code });
};
const STEPS = [14, 17, 20, 24, 35];

test('on a wide screen the board is four status columns, cards in board order, and no user actions', async () => {
  const p = await open('알파');
  await until(p, 'return columns().length === 4', 5000, '상태 열 넷');
  assert.equal(await run(p, 'return text(document.querySelector("h1"))'), '작업 보드');
  assert.deepEqual(await run(p, 'return heads()'), ['후보 2', '진행 중 2', '완료 1', '취소 0']);
  assert.deepEqual(await run(p, 'return columns().map(s => cards(s))'), [['검색 붙이기', '태그 고르기'], ['저장 오류 수정', '설명 자료 서버'], ['첫 화면 만들기'], []]);
  const main = await run(p, 'return text(document.querySelector("main"))');
  for (const word of ['공통', '메모 쓰기', '없는 행동', '사용자 행동']) assert.ok(!main.includes(word), `${word} is not shown`);
  assert.equal(await run(p, 'return tabs().length'), 0, 'no tabs on a wide screen');
  assert.ok(await run(p, 'return document.documentElement.scrollWidth <= innerWidth'), 'the page does not scroll sideways');
  await p.close();
});

test('on a phone the board shows one status at a time behind tabs, starting at in progress', async () => {
  const p = await open('알파', 390);
  await until(p, 'return tabs().length === 4', 5000, '상태 탭 넷');
  assert.deepEqual(await run(p, 'return tabs().map(text)'), ['후보 2', '진행 중 2', '완료 1', '취소 0']);
  assert.deepEqual(await run(p, 'return selected()'), ['진행 중 2']);
  assert.deepEqual(await run(p, 'return cards()'), ['저장 오류 수정', '설명 자료 서버'], 'only the in-progress cards are visible');
  await run(p, 'named("^완료 1$").click()');
  await until(p, 'return selected()[0] === "완료 1"', 3000, '완료 탭이 골라진다');
  assert.deepEqual(await run(p, 'return cards()'), ['첫 화면 만들기']);
  await run(p, 'named("^완료 1$").focus()');
  await key(p, 'ArrowRight');
  await until(p, 'return selected()[0] === "취소 0" && document.activeElement === tabs()[3]', 3000, '오른쪽 화살표로 취소 탭');
  assert.deepEqual(await run(p, 'return cards()'), []);
  assert.ok(await run(p, 'return document.documentElement.scrollWidth <= innerWidth'), 'the page does not scroll sideways');
  await p.close();
});

test('a card opens the task document in a dialog, and a missing document says so', async () => {
  const p = await open('알파');
  await until(p, 'return cards().length === 5');
  await run(p, 'named("^저장 오류 수정$").click()');
  await until(p, 'return dialog() && /저장이 실패하면 알린다/.test(dialog().textContent)', 5000, '작업 문서가 대화상자에');
  assert.ok(await run(p, 'return !!named("^닫기$")'), 'the dialog has a close button');
  await run(p, 'named("^닫기$").click()');
  await until(p, 'return !dialog()', 3000, '닫힌다');
  await run(p, 'named("^검색 붙이기$").click()');
  await until(p, 'return dialog() && /작업 문서를 읽지 못했습니다/.test(dialog().textContent)', 5000, '없는 문서는 실패를 말한다');
  assert.ok(!(await run(p, 'return /저장이 실패하면/.test(dialog().textContent)')), 'the previous document is not left behind');
  assert.ok(await run(p, 'return [...dialog().querySelectorAll("h1,h2,h3,h4")].some(h => text(h) === "검색 붙이기")'), 'a failed document still names the task');
  await p.close();
});

test('the task name is shown once in the dialog when the document starts with the same title', async () => {
  const p = await open('알파');
  await until(p, 'return cards().length === 5');
  await run(p, 'named("^저장 오류 수정$").click()');
  await until(p, 'return dialog() && /저장이 실패하면 알린다/.test(dialog().textContent)');
  assert.equal(await run(p, 'return [...dialog().querySelectorAll("*")].filter(el => vis(el) && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim() === "저장 오류 수정")).length'), 1);
  await p.close();
});

test('inside the hub body the board drops its own project name and title, but opened directly it keeps them', async () => {
  for (const width of [1440, 390]) {
    const p = await browser.newPage();
    await p.setViewport({ width, height: 900 });
    await p.goto(`${base}/#${encodeURIComponent('보드/알파')}`);
    const inner = `const f = [...document.querySelectorAll('main iframe')].find(vis); const d = f?.contentDocument; if (!d || !d.querySelector('main section button')) return null;`;
    await until(p, `${inner} return true`, 8000, `허브 본문에 보드(${width})`);
    assert.equal(await run(p, `${inner} return [...d.querySelectorAll('h1')].some(vis)`), false, `${width}: no board title inside the hub`);
    assert.equal(await run(p, `${inner} return [...d.querySelectorAll('body *')].some(el => vis(el) && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim() === '알파 제품'))`), false, `${width}: no project name inside the hub`);
    assert.ok(await run(p, `${inner} return [...d.querySelectorAll('body *')].some(el => vis(el) && /메모를 잃지 않게 한다/.test(el.textContent))`), `${width}: the product line stays`);
    await p.close();
  }
  const direct = await open('알파');
  await until(direct, 'return cards().length === 5');
  assert.ok(await run(direct, 'return vis(document.querySelector("h1")) && /알파 제품/.test(document.body.textContent)'), 'opened directly, the title and project name show');
  await direct.close();
});

test('text uses only the five type steps, on the board and in the dialog, wide and phone', async () => {
  const p = await open('알파');
  await until(p, 'return cards().length === 5');
  for (const s of await run(p, 'return fontSizes(document.body)')) assert.ok(STEPS.includes(s), `wide board: ${s}px`);
  await run(p, 'named("^저장 오류 수정$").click()');
  await until(p, 'return dialog() && /저장이 실패하면/.test(dialog().textContent)');
  for (const s of await run(p, 'return fontSizes(dialog())')) assert.ok(STEPS.includes(s), `dialog: ${s}px`);
  await p.close();
  const phone = await open('알파', 390);
  await until(phone, 'return tabs().length === 4');
  for (const s of await run(phone, 'return fontSizes(document.body)')) assert.ok([...STEPS, 29].includes(s), `phone: ${s}px`);
  await phone.close();
});

test('the board follows the device dark setting', async () => {
  const light = await open('알파');
  await until(light, 'return cards().length === 5');
  assert.equal(await run(light, 'return getComputedStyle(document.body).backgroundColor'), 'rgb(255, 255, 255)');
  await light.close();
  const dark = await open('알파', 1440, true);
  await until(dark, 'return cards().length === 5');
  assert.equal(await run(dark, 'return getComputedStyle(document.body).backgroundColor'), 'rgb(11, 12, 12)');
  assert.equal(await run(dark, 'return getComputedStyle(document.querySelector("h1")).color'), 'rgb(255, 255, 255)');
  await dark.close();
});

test('a board without actions reads, an old epic board still reads, and a bad state is an error', async () => {
  const beta = await open('베타');
  await until(beta, 'return columns().length === 4', 5000, '베타 보드');
  assert.deepEqual(await run(beta, 'return heads()'), ['후보 0', '진행 중 1', '완료 0', '취소 0']);
  await beta.close();
  const gamma = await open('감마');
  await until(gamma, 'return /메모 저장/.test(document.body.textContent) && /메모 쓰기/.test(document.body.textContent)', 5000, '옛 에픽 보드의 칸과 동사');
  await gamma.close();
  const delta = await open('델타');
  await until(delta, 'return /보드를 읽지 못했습니다/.test(document.body.textContent)', 5000, '잘못된 상태는 오류');
  assert.equal(await run(delta, 'return cards().length'), 0);
  await delta.close();
});
