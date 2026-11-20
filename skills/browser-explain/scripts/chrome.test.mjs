// Chrome 위치 찾기 시험(레이어 5b). Windows에서 돌려 볼 수 없어서, 위치를 고르는 함수에 OS와 환경과 "있는 파일"을 넣어 부른다.
// 약속: cdp.cjs가 findChrome({platform, env, exists})를 내보낸다. 돌려주는 값은 쓸 경로, 못 찾으면 null.
//   순서: env.CHROME → env.CHROME_PATH → 그 OS의 흔한 설치 위치. 환경 변수로 준 경로는 있는지 따지지 않고 그대로 쓴다(사용자가 고른 것).
// 쓰는 법: node --test skills/browser-explain/scripts/chrome.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { findChrome } = require('./cdp.cjs');
const has = (...paths) => p => paths.includes(p);
const MAC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

test('a path given in CHROME wins, then CHROME_PATH, on any OS', () => {
  assert.equal(findChrome({ platform: 'win32', env: { CHROME: 'D:\\my\\chrome.exe', CHROME_PATH: 'E:\\x.exe' }, exists: has() }), 'D:\\my\\chrome.exe');
  assert.equal(findChrome({ platform: 'darwin', env: { CHROME_PATH: '/opt/chrome' }, exists: has(MAC) }), '/opt/chrome');
});

test('on macOS the usual app location is found', () => {
  assert.equal(findChrome({ platform: 'darwin', env: {}, exists: has(MAC) }), MAC);
});

test('on Windows Chrome is found under Program Files, Program Files (x86), or the user install', () => {
  const pf = 'C:\\Program Files', x86 = 'C:\\Program Files (x86)', local = 'C:\\Users\\me\\AppData\\Local';
  const env = { PROGRAMFILES: pf, 'PROGRAMFILES(X86)': x86, LOCALAPPDATA: local };
  const tail = '\\Google\\Chrome\\Application\\chrome.exe';
  assert.equal(findChrome({ platform: 'win32', env, exists: has(pf + tail) }), pf + tail);
  assert.equal(findChrome({ platform: 'win32', env, exists: has(x86 + tail) }), x86 + tail);
  assert.equal(findChrome({ platform: 'win32', env, exists: has(local + tail) }), local + tail);
});

test('when nothing is found the answer is null, not a made-up path', () => {
  assert.equal(findChrome({ platform: 'win32', env: { PROGRAMFILES: 'C:\\Program Files' }, exists: has() }), null);
  assert.equal(findChrome({ platform: 'darwin', env: {}, exists: has() }), null);
});

test('check says how to set the location when Chrome cannot be found', () => {
  const r = spawnSync(process.execPath, [join(import.meta.dirname, 'check.cjs'), 'data/없는.html'], { env: { ...process.env, CHROME: '/없는/chrome' }, encoding: 'utf8', timeout: 30000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /CHROME/);
});
