// 허브를 이 맥에서 늘 켜 두는 쪽의 행동 시험(레이어 5a): 그림 뷰어 주소, launchd 설정(plist), serve.sh.
// 쓰는 법: node --test skills/browser-explain/scripts/hub-service.test.mjs   (macOS: plutil로 plist를 읽는다)
// 실제 LaunchAgents에 올리는 install, uninstall은 여기서 부르지 않는다(메인이 이 맥에서 직접 확인한다).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import net from 'node:net';

const hub = join(import.meta.dirname, 'hub.mjs');
const repo = resolve(import.meta.dirname, '../../..');
const serveSh = join(repo, 'skills/story-map/scripts/serve.sh');
const root = mkdtempSync(join(tmpdir(), 'hub-svc-root-'));
const engine = mkdtempSync(join(tmpdir(), 'hub-svc-engine-'));
const stateDir = mkdtempSync(join(tmpdir(), 'hub-svc-state-'));
const write = (base, rel, body) => { const f = join(base, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, body); };
write(engine, 'viewer/diagram-viewer.css', '.viewer{color:red}');
write(engine, 'viewer/.secret', '비밀');
write(engine, 'package.json', '{"name":"엔진 밖 파일"}');
write(root, 'data/story-map/알파/board.json', '{"format":2,"tasks":[]}');

const children = new Set();
const run = (cmd, args, env) => { const c = spawn(cmd, args, { env: { ...process.env, ...env } }); children.add(c); c.on('exit', () => children.delete(c)); return c; };
const lineFrom = (child, re, ms = 10000) => new Promise((ok, fail) => {
  let out = '';
  const timer = setTimeout(() => fail(new Error(`기다린 줄이 없다: ${out}`)), ms);
  const on = d => { out += d; const m = out.match(re); if (m) { clearTimeout(timer); ok(m); } };
  child.stdout.on('data', on); child.stderr.on('data', d => { out += d; });
});
const exitOf = (child, ms = 5000) => new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('끝나지 않았다')), ms);
  child.once('exit', code => { clearTimeout(timer); ok(code); });
});
const freePort = () => new Promise(ok => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const get = (port, path) => new Promise((ok, fail) => {
  const sent = path.replace(/[^\x00-\x7f]+/g, encodeURIComponent);
  http.get({ host: '127.0.0.1', port, path: sent, headers: { host: `127.0.0.1:${port}` } }, res => { let b = ''; res.setEncoding('utf8'); res.on('data', d => b += d); res.on('end', () => ok({ status: res.statusCode, type: res.headers['content-type'] ?? '', body: b })); }).on('error', fail);
});
test.after(() => {
  for (const c of children) c.kill();
  for (const d of [root, engine, stateDir]) rmSync(d, { recursive: true, force: true });
});

test('the diagram viewer address is served from the engine folder, without a link inside data/', async () => {
  const c = run(process.execPath, [hub], { PORT: '0', HSTACK_HUB_ROOT: root, HSTACK_HUB_STATE: join(stateDir, 'a.json'), HSTACK_DIAGRAM: engine });
  const port = Number((await lineFrom(c, /127\.0\.0\.1:(\d+)\//))[1]);
  const css = await get(port, '/data/story-map/hstack-diagram/viewer/diagram-viewer.css?v=20261117');
  assert.equal(css.status, 200);
  assert.match(css.type, /text\/css/);
  assert.equal(css.body, '.viewer{color:red}');
  assert.equal((await get(port, '/data/story-map/hstack-diagram/viewer/없는.js')).status, 404);
  for (const p of ['/data/story-map/hstack-diagram/viewer/.secret', '/data/story-map/hstack-diagram/viewer/../package.json', '/data/story-map/hstack-diagram/viewer/%2e%2e/package.json']) {
    const r = await get(port, p);
    assert.ok(r.status === 403 || r.status === 404, `${p}: ${r.status}`);
    assert.ok(!r.body.includes('비밀') && !r.body.includes('엔진 밖'), p);
  }
  assert.equal((await get(port, '/data/story-map/알파/board.json')).status, 200, 'other data paths still come from the repository');
  c.kill();
});

test('`hub.mjs plist` prints a launchd agent that starts this hub at login, restarts it, and carries the settings', async () => {
  const c = run(process.execPath, [hub, 'plist'], { HSTACK_HUB_HOSTS: 'myhost.example.ts.net', HSTACK_DIAGRAM: '/opt/엔진', PORT: '' });
  let out = ''; c.stdout.on('data', d => out += d);
  assert.equal(await exitOf(c), 0, 'prints and exits, does not serve');
  const plist = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: out }).toString());
  assert.ok(typeof plist.Label === 'string' && plist.Label.length > 0, 'has a label');
  assert.deepEqual(plist.ProgramArguments, [process.execPath, hub], 'absolute node and hub paths');
  assert.equal(plist.RunAtLoad, true);
  assert.equal(plist.KeepAlive, true);
  assert.equal(plist.EnvironmentVariables?.HSTACK_HUB_HOSTS, 'myhost.example.ts.net');
  assert.equal(plist.EnvironmentVariables?.HSTACK_DIAGRAM, '/opt/엔진');
  assert.ok(!('PORT' in (plist.EnvironmentVariables ?? {})) || plist.EnvironmentVariables.PORT === '', 'an empty setting is not carried as a port');
  for (const k of ['StandardOutPath', 'StandardErrorPath']) assert.ok(isAbsolute(plist[k] ?? ''), `${k} is an absolute log path`);
});

test('serve.sh only prints the board address when the hub is already up, and starts the hub when it is not', async () => {
  const port = await freePort();
  const env = { PORT: String(port), HSTACK_HUB_ROOT: root, HSTACK_HUB_STATE: join(stateDir, 'b.json') };
  // 허브가 없을 때: serve.sh가 허브를 띄운다
  const first = run('sh', [serveSh], env);
  await lineFrom(first, new RegExp(`http://127\\.0\\.0\\.1:${port}/skills/story-map/board/\\?p=`));
  let up = false;
  for (let i = 0; i < 50 && !up; i++) { up = (await get(port, '/api/list').catch(() => ({ status: 0 }))).status === 200; if (!up) await new Promise(r => setTimeout(r, 100)); }
  assert.ok(up, 'the hub answers on that port');
  // 이미 떠 있을 때: 주소만 알리고 끝난다
  const second = run('sh', [serveSh], env);
  const printed = lineFrom(second, new RegExp(`http://127\\.0\\.0\\.1:${port}/skills/story-map/board/\\?p=`));
  assert.equal(await exitOf(second), 0, 'exits without starting a second server');
  await printed;
  first.kill();
});
