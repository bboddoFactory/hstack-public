// 허브 서버(hub.mjs) 행동 시험. 시험용 저장소 폴더로 서버를 띄우고 브라우저가 부르는 그대로 HTTP로 부른다.
// 쓰는 법: node --test skills/browser-explain/scripts/hub.test.mjs
// 서버는 첫 줄에 "허브: http://127.0.0.1:<포트>/"를 찍는다. PORT=0이면 빈 포트를 고른다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';

const hub = join(import.meta.dirname, 'hub.mjs');
const root = mkdtempSync(join(tmpdir(), 'hub-root-'));
const stateDir = mkdtempSync(join(tmpdir(), 'hub-state-'));
const state = join(stateDir, 'seen.json');
// 정리는 뒤에서 한 번에: 읽기 막은 판을 풀고 나서 지운다(after 훅은 등록 순서대로 돈다)

const page = title => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title></head><body><main class="page"><h1>${title}</h1></main></body></html>`;
const write = (rel, body) => { const f = join(root, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, body); return f; };
const task = (project, name) => `data/story-map/${project}/tasks/${name}`;
const version = (project, t, m, stamp, title) => write(`${task(project, t)}/자료/${m}/${stamp}.html`, page(title));
const board = (project, tasks) => write(`data/story-map/${project}/board.json`, JSON.stringify({ format: 2, project, verbs: [], tasks: tasks.map(([name, folder, s]) => ({ name, path: `tasks/${folder}/작업.md`, verb: null, state: s })) }));

// 켜기 전에 있던 자료들
board('알파', [['진행 작업', '진행', 'doing'], ['후보 작업', '후보', 'todo'], ['끝난 작업', '끝남', 'done'], ['취소 작업', '취소', 'cancelled'], ['빈 작업', '빔', 'doing']]);
for (const t of ['진행', '후보', '끝남', '취소', '빔']) write(`${task('알파', t)}/작업.md`, '# 작업\n');
version('알파', '진행', '구조-설명', '20261119-100000', '구조 설명 판1');
version('알파', '진행', '구조-설명', '20261119-120000', '구조 설명');
write(`${task('알파', '진행')}/자료/구조-설명/원본.html`, page('원본은 목록에 없다'));
write(`${task('알파', '진행')}/자료/구조-설명/_검사중-123.html`, page('임시 파일은 목록에 없다'));
write(`${task('알파', '진행')}/옛-비교.html`, page('자료 밖 옛 HTML'));
version('알파', '후보', '후보-자료', '20261118-090000', '후보 자료');
version('알파', '끝남', '지난-자료', '20261110-090000', '지난 자료');
version('알파', '취소', '취소-자료', '20261111-090000', '취소 자료');
// 보드가 깨진 프로젝트: 작업은 진행 중으로 보인다
write('data/story-map/베타/board.json', '{ 깨진 json');
write(`${task('베타', '깨진보드')}/작업.md`, '# 작업\n');
version('베타', '깨진보드', '살아남는-자료', '20261117-080000', '살아남는 자료');
// 읽을 수 없는 판: 그 자료만 빠진다
const unreadable = version('베타', '깨진보드', '못읽는-자료', '20261117-090000', '못 읽는 자료');
chmodSync(unreadable, 0o000);
// 옛 페이지와 공통 CSS(정적 제공)
write('skills/browser-explain/assets/explain.css', ':root{--bg:#fff}');
write('data/story-map/알파/tasks/진행/레이어1/설명.html', page('옛 페이지'));

let server, base, port;
const start = () => new Promise((resolve, reject) => {
  server = spawn(process.execPath, [hub], { env: { ...process.env, PORT: '0', HSTACK_HUB_ROOT: root, HSTACK_HUB_STATE: state, HSTACK_HUB_HOSTS: 'myhost.example.ts.net' } });
  let out = '';
  server.stdout.on('data', d => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\//); if (m) { port = Number(m[1]); base = `http://127.0.0.1:${port}`; resolve(); } });
  server.on('exit', code => reject(new Error(`hub exited ${code}: ${out}`)));
  setTimeout(() => reject(new Error(`no address line: ${out}`)), 10000);
});
const stop = () => new Promise(resolve => { server.removeAllListeners('exit'); server.once('exit', resolve); server.kill(); });
test.before(start);
test.after(async () => {
  await stop();
  try { chmodSync(unreadable, 0o644); } catch {}
  rmSync(root, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

// 경로와 헤더를 그대로 보내는 요청(fetch는 Host와 ../를 바꾼다)
const raw = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  // 한글 같은 비ASCII 글자만 인코딩한다(브라우저처럼). %2e%2e 같은 것은 그대로 보낸다.
  const sent = path.replace(/[^\x00-\x7f]+/g, encodeURIComponent);
  const req = http.request({ host: '127.0.0.1', port, path: sent, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, res => {
    let data = ''; res.setEncoding('utf8'); res.on('data', d => data += d); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
  });
  req.on('error', reject); if (body) req.write(body); req.end();
});
const list = async () => { const r = await raw('/api/list'); assert.equal(r.status, 200, r.body); return JSON.parse(r.body); };
const findTask = (l, project, folder) => l.projects.find(p => p.id === project)?.tasks.find(t => t.id === folder);
const allMaterials = l => l.projects.flatMap(p => p.tasks.flatMap(t => t.materials));
const seen = (id, v, headers = { origin: `http://127.0.0.1:${port}` }) => raw('/api/seen', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ id, version: v }) });

test('the list is projects, then tasks by board state, then materials named by their latest version', async () => {
  const l = await list();
  const live = findTask(l, '알파', '진행');
  assert.equal(live.name, '진행 작업');
  assert.equal(live.state, 'doing');
  assert.equal(live.past, false);
  assert.equal(live.materials.length, 1);
  const m = live.materials[0];
  assert.equal(m.id, '알파/진행/구조-설명');
  assert.equal(m.title, '구조 설명', 'title of the latest version');
  assert.equal(m.version, '20261119-120000');
  assert.equal(m.url, '/data/story-map/알파/tasks/진행/자료/구조-설명/20261119-120000.html');
  assert.match(m.time, /^2026-11-19T12:00:00/);
  assert.equal(findTask(l, '알파', '후보').past, false, 'todo is live');
  assert.equal(findTask(l, '알파', '끝남').past, true, 'done is past');
  assert.equal(findTask(l, '알파', '취소').past, true, 'cancelled is past');
});

test('live tasks come before past ones, each by their latest version', async () => {
  const tasks = (await list()).projects.find(p => p.id === '알파').tasks.map(t => t.id);
  assert.deepEqual(tasks, ['진행', '후보', '취소', '끝남']);
});

test('sources, temporary files, HTML outside 자료, and tasks without materials are not listed', async () => {
  const l = await list();
  const titles = allMaterials(l).map(m => m.title);
  for (const t of ['원본은 목록에 없다', '임시 파일은 목록에 없다', '자료 밖 옛 HTML', '구조 설명 판1']) assert.ok(!titles.includes(t), t);
  assert.equal(findTask(l, '알파', '빔'), undefined, 'a task with no material is not a node');
});

test('a project whose board cannot be read still shows its tasks as live, and an unreadable version drops only that material', async () => {
  const l = await list();
  const t = findTask(l, '베타', '깨진보드');
  assert.ok(t, 'task is listed');
  assert.equal(t.past, false);
  assert.deepEqual(t.materials.map(m => m.title), ['살아남는 자료']);
});

test('versions that were there before the hub first started count as seen', async () => {
  for (const m of allMaterials(await list())) assert.equal(m.unseen, false, m.id);
});

test('a version that goes up while the hub runs shows as unseen, and opening it is remembered across a restart', async () => {
  version('알파', '진행', '새-자료', '20991231-235959', '새 자료');
  let m = allMaterials(await list()).find(x => x.id === '알파/진행/새-자료');
  assert.equal(m.unseen, true);
  const r = await seen(m.id, m.version);
  assert.ok(r.status >= 200 && r.status < 300, `${r.status} ${r.body}`);
  m = allMaterials(await list()).find(x => x.id === '알파/진행/새-자료');
  assert.equal(m.unseen, false);
  assert.ok(existsSync(state), 'seen state is written to the state file');
  await stop(); await start();
  m = allMaterials(await list()).find(x => x.id === '알파/진행/새-자료');
  assert.equal(m.unseen, false, 'still seen after restart');
  version('알파', '진행', '새-자료', '21000101-000000', '새 자료');
  m = allMaterials(await list()).find(x => x.id === '알파/진행/새-자료');
  assert.equal(m.unseen, true, 'a newer version is unseen again');
});

test('old pages and the shared CSS are served as before, with no-cache and revalidation', async () => {
  const r = await raw('/data/story-map/알파/tasks/진행/레이어1/설명.html');
  assert.equal(r.status, 200);
  assert.ok(r.body.includes('옛 페이지'));
  const css = await raw('/skills/browser-explain/assets/explain.css?v=20261118');
  assert.equal(css.status, 200);
  assert.match(css.headers['cache-control'] ?? '', /no-cache/);
  assert.match(css.headers['content-type'] ?? '', /text\/css/);
  const tag = css.headers.etag, modified = css.headers['last-modified'];
  assert.ok(tag || modified, 'has a validator');
  const again = await raw('/skills/browser-explain/assets/explain.css?v=20261118', { headers: tag ? { 'if-none-match': tag } : { 'if-modified-since': modified } });
  assert.equal(again.status, 304);
});

test('the Tailscale name is accepted as a host, an unknown host is refused', async () => {
  assert.equal((await raw('/api/list', { headers: { host: 'myhost.example.ts.net' } })).status, 200);
  assert.equal((await raw('/api/list', { headers: { host: 'evil.example.com' } })).status, 403);
});

test('paths outside the repository are refused', async () => {
  writeFileSync(join(root, '..', 'hub-secret.txt'), '비밀');
  test.after(() => rmSync(join(root, '..', 'hub-secret.txt'), { force: true }));
  for (const p of ['/../hub-secret.txt', '/%2e%2e/hub-secret.txt', '/data/%2e%2e/%2e%2e/hub-secret.txt']) {
    const r = await raw(p);
    assert.ok(r.status === 403 || r.status === 404, `${p}: ${r.status}`);
    assert.ok(!r.body.includes('비밀'), p);
  }
});

test('seen from another origin, without an origin, or for an unknown material is refused', async () => {
  const m = allMaterials(await list())[0];
  assert.equal((await seen(m.id, m.version, { origin: 'https://evil.example.com' })).status, 403);
  assert.equal((await seen(m.id, m.version, {})).status, 403);
  assert.equal((await seen('없는/작업/자료', '20261119-120000')).status, 400);
});

test('hidden folders such as .git are not served', async () => {
  write('.git/config', '[core]\n비밀 설정');
  write('data/story-map/알파/.secret/키.txt', '비밀 키');
  for (const p of ['/.git/config', '/data/story-map/알파/.secret/키.txt', '/%2egit/config']) {
    const r = await raw(p);
    assert.equal(r.status, 404, p);
    assert.ok(!r.body.includes('비밀'), p);
  }
});
