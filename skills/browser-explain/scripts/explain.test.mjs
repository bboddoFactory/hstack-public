// 스킬 CLI(explain) 행동 시험. 페이지를 만드는 에이전트가 부르는 그대로 부르고 보이는 결과(파일과 출력)를 본다.
// 쓰는 법: node --test skills/browser-explain/scripts/explain.test.mjs
//   엔진은 기본 위치(~/workspace/hstack-diagram)를 쓴다. check는 검사 동안 스스로 서버를 띄운다.
// 부르는 쪽은 PUPPETEER_CORE나 엔진 경로를 모른다: 시험은 그 환경 변수를 지우고 부른다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, copyFileSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { homedir } from 'node:os';

const here = import.meta.dirname;
const hstack = resolve(here, '../../..');
const cli = join(here, 'explain.mjs');
const fixtures = join(here, 'fixtures');
const engine = join(homedir(), 'workspace/hstack-diagram/src/cli.mjs');
const KINDS = ['component', 'data-flow', 'sequence', 'system-context', 'container', 'erd', 'flowchart', 'state-machine'];

const env = { ...process.env };
delete env.PUPPETEER_CORE;
delete env.HSTACK_DIAGRAM;
const run = (args, extra = {}, cwd) => {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...env, ...extra }, cwd, timeout: 180000 });
  return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
};
const explain = (...args) => run(args);
const lines = s => s.trim().split('\n').filter(Boolean);

// 시험용 프로젝트를 hstack 기록 자리(data/story-map/<프로젝트>/tasks/<작업>/작업.md)에 만들고 끝나면 지운다.
const project = mkdtempSync(join(hstack, 'data/story-map/.explain-test-'));
test.after(() => rmSync(project, { recursive: true, force: true }));
let taskNo = 0;
const newTask = () => {
  const dir = join(project, 'tasks', `시험작업${++taskNo}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '작업.md'), '# 시험 작업\n');
  return dir;
};
// 그림 없는 시험과 check 고정 자료가 쓰는 폴더(hstack 저장소 안).
const loose = join(project, '낱장');
mkdirSync(loose, { recursive: true });
for (const f of ['원본.html', '컨테이너.json', '시퀀스.json', '잘림.html', '끊김.html']) copyFileSync(join(fixtures, f), join(loose, f));

const isVersion = f => /^\d{8}-\d{6}\.html$/.test(f);
const versions = dir => readdirSync(dir).filter(isVersion).sort();
const titled = (html, title) => html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
// 자료 하나를 new로 만들고, 원본을 html로 바꾸고, 함께 둘 파일을 넣는다.
const material = (task, name, html, files = {}) => {
  const r = explain('new', 'page', task, name);
  assert.equal(r.code, 0, r.all);
  const dir = join(task, '자료', name);
  if (html !== undefined) writeFileSync(join(dir, '원본.html'), html);
  for (const [f, src] of Object.entries(files)) typeof src === 'string' && existsSync(src) ? copyFileSync(src, join(dir, f)) : writeFileSync(join(dir, f), src);
  return dir;
};
const fixturePage = title => titled(readFileSync(join(fixtures, '원본.html'), 'utf8'), title);
const pictures = { '컨테이너.json': join(fixtures, '컨테이너.json'), '시퀀스.json': join(fixtures, '시퀀스.json') };

const svgSize = svg => ({ w: svg.match(/<svg[^>]*\swidth="(\d+)"/)[1], h: svg.match(/<svg[^>]*\sheight="(\d+)"/)[1] });
const withoutFigures = html => html.replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>').replace(/ data-width="\d+" data-height="\d+"/g, '').replace(/<title>[^<]*<\/title>/, '').replace(/>\s+</g, '><').trim();
// 1x1 PNG. 둘째는 끝에 바이트를 덧붙여 내용만 다르게 한다(디코더는 IEND 뒤를 읽지 않는다).
const png1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const png2 = Buffer.concat([png1, Buffer.from('둘째')]);
// 원본의 첫 본문 절 끝에 조각을 넣는다.
const intoFirstClaim = (html, piece) => html.replace(/(<section class="claim"[\s\S]*?)(<\/section>)/, `$1${piece}$2`);

// ---- describe, draw: 레이어 2 그대로 ----

test('describe <kind> gives exactly the engine help for that kind', () => {
  for (const kind of KINDS) {
    const r = explain('describe', kind);
    assert.equal(r.code, 0, r.all);
    const direct = spawnSync(process.execPath, [engine, '--help', kind], { encoding: 'utf8' });
    assert.equal(r.out, direct.stdout, `describe ${kind} is the engine's --help ${kind}`);
  }
});

test('describe with an unknown kind fails and names the kinds', () => {
  const r = explain('describe', 'pie');
  assert.notEqual(r.code, 0);
  for (const kind of KINDS) assert.ok(r.all.includes(kind), `names ${kind}`);
});

test('draw writes the picture next to the input and says one short line, never the SVG', () => {
  for (const name of ['컨테이너', '시퀀스']) {
    const r = explain('draw', join(loose, `${name}.json`));
    assert.equal(r.code, 0, r.all);
    const svg = readFileSync(join(loose, `${name}.svg`), 'utf8');
    assert.match(svg, /^<svg/);
    assert.equal(lines(r.out).length, 1, `one line: ${r.out}`);
    assert.ok(Buffer.byteLength(r.all) < 600, `short output (${Buffer.byteLength(r.all)} bytes)`);
    assert.ok(!r.all.includes('<svg'), 'the SVG is not printed');
  }
});

test('draw with a wrong input fails, says what to fix, and removes the old picture of that name', () => {
  const bad = join(loose, '틀린.json');
  writeFileSync(bad, JSON.stringify({ diagram: 'container', boundary: { id: 'b', name: '시스템' }, nodes: [], edges: [] }));
  writeFileSync(join(loose, '틀린.svg'), '<svg>옛 그림</svg>');
  const r = explain('draw', bad);
  assert.notEqual(r.code, 0);
  assert.ok(r.all.includes('title'), `names the field to fix: ${r.all}`);
  assert.ok(Buffer.byteLength(r.all) < 2000, `short output (${Buffer.byteLength(r.all)} bytes)`);
  assert.ok(!existsSync(join(loose, '틀린.svg')), 'the old picture is gone');
});

// ---- new: 자리를 받는다 ----

test('new page makes the material folder with a page source and says its path in one line', () => {
  const task = newTask();
  const r = explain('new', 'page', task, '허브-새표시');
  assert.equal(r.code, 0, r.all);
  assert.equal(lines(r.out).length, 1, `one line: ${r.out}`);
  const src = join(task, '자료', '허브-새표시', '원본.html');
  assert.ok(existsSync(src), 'the page source is there');
  assert.ok(r.out.includes('원본.html'), `says where: ${r.out}`);
  assert.match(readFileSync(src, 'utf8'), /<main class="page">/);
});

test('a fresh page from new builds as it is: one version, named by the time it went up', () => {
  const task = newTask();
  const dir = material(task, '빈-틀');
  const r = explain('build', dir);
  assert.equal(r.code, 0, r.all);
  assert.equal(lines(r.out).length, 1, `one line: ${r.out}`);
  assert.match(r.out, /올림/);
  assert.match(r.out, /판 1/);
  assert.equal(versions(dir).length, 1);
});

test('new refuses a name that is already there and leaves the old page as it was', () => {
  const task = newTask();
  const dir = material(task, '같은-이름', '<!-- 내가 쓴 글 -->');
  const r = explain('new', 'page', task, '같은-이름');
  assert.notEqual(r.code, 0);
  assert.equal(readFileSync(join(dir, '원본.html'), 'utf8'), '<!-- 내가 쓴 글 -->');
});

test('new refuses a folder that is not a task folder and makes nothing', () => {
  const notTask = join(project, '작업아님');
  mkdirSync(notTask, { recursive: true });
  const r = explain('new', 'page', notTask, '어딘가');
  assert.notEqual(r.code, 0);
  assert.ok(!existsSync(join(notTask, '자료')), 'no material folder');
});

// ---- build: 그림을 넣고, 검사하고, 판을 놓는다 ----

test('build puts each picture into the viewer the pages already use, as a new version', () => {
  const task = newTask();
  const dir = material(task, '구조-설명', fixturePage('스킬 CLI가 생겨도 페이지 제작 에이전트는 남는다'), pictures);
  const r = explain('build', dir);
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /판 1/);
  assert.ok(!r.all.includes('<svg'), 'the SVG is not printed');
  const [v] = versions(dir);
  const page = readFileSync(join(dir, v), 'utf8');
  assert.ok(!page.includes('class="diagram" data-src'), 'no picture spot is left');
  // 그림 밖은 사람이 만든 지금 페이지와 같다(뷰어 구조, aria-label, 머리의 CSS·JS).
  assert.equal(withoutFigures(page), withoutFigures(readFileSync(join(fixtures, '완성-기대.html'), 'utf8')));
  const viewers = [...page.matchAll(/<div class="diagram-viewer" data-width="(\d+)" data-height="(\d+)">[\s\S]*?(<svg[\s\S]*?<\/svg>)/g)];
  assert.equal(viewers.length, 2);
  for (const [m, name] of viewers.map((x, i) => [x, ['컨테이너', '시퀀스'][i]])) {
    const svg = readFileSync(join(dir, `${name}.svg`), 'utf8').trim();
    assert.equal(m[3], svg, `${name} is the picture drawn from its JSON`);
    assert.deepEqual({ w: m[1], h: m[2] }, svgSize(svg), `${name} viewer size`);
  }
});

test('build with nothing changed makes no new version and says so', () => {
  const task = newTask();
  const dir = material(task, '그대로');
  assert.equal(explain('build', dir).code, 0);
  const r = explain('build', dir);
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /변경 없음/);
  assert.equal(versions(dir).length, 1);
});

test('build after an edit adds version 2 and never touches version 1', () => {
  const task = newTask();
  const dir = material(task, '고침');
  assert.equal(explain('build', dir).code, 0);
  const [v1] = versions(dir);
  const before = readFileSync(join(dir, v1));
  const src = join(dir, '원본.html');
  writeFileSync(src, intoFirstClaim(readFileSync(src, 'utf8'), '<p>고친 문장이 더해졌다.</p>'));
  const r = explain('build', dir);
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /판 2/);
  const vs = versions(dir);
  assert.equal(vs.length, 2);
  assert.ok(readFileSync(join(dir, v1)).equals(before), 'version 1 is byte for byte the same');
  assert.ok(readFileSync(join(dir, vs[1]), 'utf8').includes('고친 문장이 더해졌다'));
});

test('build draws each picture again from its JSON, so a changed JSON never ships an old picture', () => {
  const task = newTask();
  const dir = material(task, '그림-고침', fixturePage('그림을 고친 자료'), pictures);
  assert.equal(explain('build', dir).code, 0);
  const seq = JSON.parse(readFileSync(join(dir, '시퀀스.json'), 'utf8'));
  seq.participants[0].name = '새로-바꾼-참가자';
  writeFileSync(join(dir, '시퀀스.json'), JSON.stringify(seq));
  const r = explain('build', dir);
  assert.equal(r.code, 0, r.all);
  const [v1, v2] = versions(dir);
  assert.ok(readFileSync(join(dir, v2), 'utf8').includes('새로-바꾼-참가자'), 'version 2 has the new picture');
  assert.ok(!readFileSync(join(dir, v1), 'utf8').includes('새로-바꾼-참가자'));
});

test('a local image a version shows stays that image after the file is replaced for a later version', () => {
  const task = newTask();
  const figure = '<figure class="fig"><img src="화면.png" alt="시험 화면"><figcaption><p class="fig-sub">시험 화면</p></figcaption></figure>';
  const dir = material(task, '캡처', undefined, { '화면.png': png1 });
  const src = join(dir, '원본.html');
  writeFileSync(src, intoFirstClaim(readFileSync(src, 'utf8'), figure));
  assert.equal(explain('build', dir).code, 0);
  writeFileSync(join(dir, '화면.png'), png2);
  writeFileSync(src, intoFirstClaim(readFileSync(src, 'utf8'), '<p>새 캡처로 다시 만들었다.</p>'));
  const r = explain('build', dir);
  assert.equal(r.code, 0, r.all);
  const [v1, v2] = versions(dir);
  const shown = v => readFileSync(join(dir, readFileSync(join(dir, v), 'utf8').match(/<img src="([^"]+)"/)[1]));
  assert.ok(shown(v1).equals(png1), 'version 1 still shows the first capture');
  assert.ok(shown(v2).equals(png2), 'version 2 shows the new capture');
});

test('build refuses a title another material of the same task already has, and makes no version', () => {
  const task = newTask();
  material(task, '먼저', titled(readFileSync(join(material(task, '틀복사'), '원본.html'), 'utf8'), '겹치는 제목'));
  assert.equal(explain('build', join(task, '자료', '먼저')).code, 0);
  const dir = material(task, '나중', titled(readFileSync(join(task, '자료', '틀복사', '원본.html'), 'utf8'), '겹치는 제목'));
  const r = explain('build', dir);
  assert.notEqual(r.code, 0);
  assert.ok(r.all.includes('먼저'), `names the material that has the title: ${r.all}`);
  assert.equal(versions(dir).length, 0);
});

test('build refuses an empty or too long title', () => {
  const task = newTask();
  for (const [name, title] of [['빈-제목', ''], ['긴-제목', '가'.repeat(31)]]) {
    const dir = material(task, name);
    writeFileSync(join(dir, '원본.html'), titled(readFileSync(join(dir, '원본.html'), 'utf8'), title));
    const r = explain('build', dir);
    assert.notEqual(r.code, 0, `${name}: ${r.all}`);
    assert.equal(versions(dir).length, 0);
  }
});

test('build of a page check rejects says why, quotes the text, and leaves no version and no temporary file', () => {
  const task = newTask();
  const before = readFileSync(join(fixtures, '잘림.html'), 'utf8');
  const dir = material(task, '잘린-자료', titled(before, '잘린 자료'));
  const r = explain('build', dir);
  assert.notEqual(r.code, 0);
  assert.ok(r.all.includes('다시 보내기'), `quotes the cut text: ${r.all}`);
  assert.deepEqual(readdirSync(dir).filter(f => f.endsWith('.html')), ['원본.html'], 'only the source is left');
});

test('build with a picture input the engine rejects names the field to fix and makes no version', () => {
  const task = newTask();
  const dir = material(task, '틀린-그림', fixturePage('틀린 그림 자료'), {
    '컨테이너.json': JSON.stringify({ diagram: 'container', boundary: { id: 'b', name: '시스템' }, nodes: [], edges: [] }),
    '시퀀스.json': join(fixtures, '시퀀스.json'),
  });
  const r = explain('build', dir);
  assert.notEqual(r.code, 0);
  assert.ok(r.all.includes('title'), `names the field to fix: ${r.all}`);
  assert.equal(versions(dir).length, 0);
});

test('build fails when a picture has neither a JSON nor an SVG, names it, and makes no version', () => {
  const task = newTask();
  const dir = material(task, '그림-빠짐', fixturePage('그림이 빠진 자료'), { '컨테이너.json': join(fixtures, '컨테이너.json') });
  const r = explain('build', dir);
  assert.notEqual(r.code, 0);
  assert.ok(r.all.includes('시퀀스'), `names the missing picture: ${r.all}`);
  assert.equal(versions(dir).length, 0);
});

// ---- 자유 블록: 컴포넌트에 없는 모양은 블록 안에서 ----

const freeBlock = '<div class="free" id="t1"><style>#t1 .mark{color:var(--accent)}</style><p class="mark">처음 글</p><script>document.querySelector("#t1 .mark").textContent = "스크립트가 바꾼 글";</script></div>';

test('a free block with its own scoped style and script goes up, and build counts it', () => {
  const task = newTask();
  const dir = material(task, '자유-블록');
  const src = join(dir, '원본.html');
  writeFileSync(src, intoFirstClaim(readFileSync(src, 'utf8'), freeBlock));
  const r = explain('build', dir);
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /자유 블록 1/);
});

test('a style outside a free block, or a free-block selector that does not start with its id, fails', () => {
  const task = newTask();
  const cases = {
    '블록-밖-스타일': html => html.replace('</head>', '<style>.mark{color:red}</style></head>'),
    '범위-밖-선택자': html => intoFirstClaim(html, '<div class="free" id="t2"><style>.mark{color:var(--accent)}</style><p class="mark">글</p></div>'),
  };
  for (const [name, edit] of Object.entries(cases)) {
    const dir = material(task, name);
    const src = join(dir, '원본.html');
    writeFileSync(src, edit(readFileSync(src, 'utf8')));
    const r = explain('build', dir);
    assert.notEqual(r.code, 0, `${name}: ${r.all}`);
    assert.equal(versions(dir).length, 0);
  }
});

// ---- check: 따로 쓰는 검사, 읽는 쪽 서버와 엔진에 기대지 않는다 ----

test('check passes a page without pictures even when the engine is not there', () => {
  const task = newTask();
  const dir = material(task, '그림-없음');
  const empty = join(project, '빈엔진');
  mkdirSync(empty, { recursive: true });
  const r = run(['check', join(dir, '원본.html')], { HSTACK_DIAGRAM: empty });
  assert.equal(r.code, 0, r.all);
});

test('check does not lean on the reading server: it passes with that address pointed at a closed port', () => {
  const task = newTask();
  const dir = material(task, '서버-없이', fixturePage('서버 없이 검사'), pictures);
  assert.equal(explain('build', dir).code, 0);
  const r = run(['check', join(dir, versions(dir)[0])], { BASE: 'http://127.0.0.1:1/' });
  assert.equal(r.code, 0, r.all);
});

test('check fails a page whose picture spot was never filled', () => {
  const r = explain('check', join(loose, '원본.html'));
  assert.notEqual(r.code, 0);
  assert.match(r.all, /그림/, `says a picture is missing: ${r.all}`);
});

test('check still takes paths relative to the folder the agent works in and to the hstack repository', () => {
  const task = newTask();
  const dir = material(task, '상대-경로');
  assert.equal(run(['check', '원본.html'], {}, dir).code, 0);
  assert.equal(explain('check', relative(hstack, join(dir, '원본.html'))).code, 0);
});

test('check fails a page whose text is cut off inside its box, and quotes the text', () => {
  const r = explain('check', join(loose, '잘림.html'));
  assert.notEqual(r.code, 0, r.all);
  assert.match(r.all, /잘/, `says text is cut off: ${r.all}`);
  assert.ok(r.all.includes('다시 보내기'), `quotes the cut text: ${r.all}`);
});

test('check fails a page where a word or number breaks across lines in the middle, and quotes it', () => {
  const r = explain('check', join(loose, '끊김.html'));
  assert.notEqual(r.code, 0, r.all);
  assert.match(r.all, /끊/, `says a word breaks: ${r.all}`);
  assert.ok(r.all.includes('890건'), `quotes the broken word: ${r.all}`);
});

test('the example page agents read goes up as a material once its pictures are drawn', () => {
  const task = newTask();
  const dir = material(task, '예시-페이지', readFileSync(join(hstack, 'skills/browser-explain/assets/page.html'), 'utf8'), pictures);
  const r = explain('build', dir);
  assert.equal(r.code, 0, r.all);
});

// ---- 3.5b 겉모양과 틀: 비교판 틀, 새 컴포넌트, DESIGN.md에 없는 값 없음 ----
// 비교판 뼈대: main.board > header.page-head, section.choices > article.choice(h3, p.theory, 내용) 2~4개, section.claim(있을 때만), section.unknowns
const choice = (name, theory = true) => `<article class="choice"><h3>${name}</h3>${theory ? `<p class="theory">60-30-10: 강조색은 10%만 쓴다</p>` : ''}<p>${name}의 내용</p></article>`;
const withChoices = (html, items) => html.replace(/<section class="choices"[\s\S]*?<\/section>/, `<section class="choices">${items.join('')}</section>`);

test('new board makes a comparison board that goes up as it is', () => {
  const task = newTask();
  const r = explain('new', 'board', task, '색-후보');
  assert.equal(r.code, 0, r.all);
  const dir = join(task, '자료', '색-후보');
  assert.match(readFileSync(join(dir, '원본.html'), 'utf8'), /<main class="board">/);
  const b = explain('build', dir);
  assert.equal(b.code, 0, b.all);
  assert.match(b.out, /판 1/);
});

test('a board with three candidates side by side goes up', () => {
  const task = newTask();
  assert.equal(explain('new', 'board', task, '세-후보').code, 0);
  const dir = join(task, '자료', '세-후보');
  const src = join(dir, '원본.html');
  writeFileSync(src, withChoices(readFileSync(src, 'utf8'), [choice('가 후보'), choice('나 후보'), choice('다 후보')]));
  const r = explain('build', dir);
  assert.equal(r.code, 0, r.all);
});

test('a board with one candidate, or a candidate without its theory line, fails and says what is missing', () => {
  const task = newTask();
  for (const [name, items, word] of [['후보-하나', [choice('혼자')], '후보'], ['이론-없음', [choice('가 후보'), choice('나 후보', false)], '이론']]) {
    assert.equal(explain('new', 'board', task, name).code, 0);
    const dir = join(task, '자료', name);
    const src = join(dir, '원본.html');
    writeFileSync(src, withChoices(readFileSync(src, 'utf8'), items));
    const r = explain('build', dir);
    assert.notEqual(r.code, 0, `${name}: ${r.all}`);
    assert.ok(r.all.includes(word), `${name} says what is missing: ${r.all}`);
    assert.equal(versions(dir).length, 0);
  }
});

test('new refuses a kind other than page and board and names the two', () => {
  const task = newTask();
  const r = explain('new', 'sheet', task, '표');
  assert.notEqual(r.code, 0);
  assert.ok(r.all.includes('page') && r.all.includes('board'), r.all);
  assert.ok(!existsSync(join(task, '자료', '표')));
});

test('a page with an image figure, a code block with a very long line and inline code goes up without overflowing the phone width', () => {
  const task = newTask();
  const dir = material(task, '이미지와-코드', undefined, { '화면.png': png1 });
  const src = join(dir, '원본.html');
  const long = 'const 아주_긴_한_줄 = ' + '"' + 'x'.repeat(300) + '";';
  const piece = '<figure class="fig"><img src="화면.png" alt="시험 화면"><figcaption><p class="fig-sub">시험 화면</p></figcaption></figure>'
    + `<pre class="code"><code>${long}</code></pre><p>명령은 <code>explain build</code>로 부른다.</p>`;
  writeFileSync(src, intoFirstClaim(readFileSync(src, 'utf8'), piece));
  const r = explain('build', dir);
  assert.equal(r.code, 0, r.all);
});

test('explain.css uses no colour or font size that DESIGN.md does not name', () => {
  const css = readFileSync(join(hstack, 'skills/browser-explain/assets/explain.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const design = readFileSync(join(hstack, 'DESIGN.md'), 'utf8').split('# 설명 자료와 허브의 화면 기준')[1];
  const hex = s => [...s.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0].toLowerCase());
  const named = new Set(hex(design));
  const strays = [...new Set(hex(css))].filter(c => !named.has(c) && !['#fff', '#ffffff'].includes(c));
  assert.deepEqual(strays, [], 'every hex colour in explain.css is in DESIGN.md');
  const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map(m => Number(m[1]));
  const allowed = new Set([14, 17, 20, 24, 29, 35]);
  assert.deepEqual([...new Set(sizes.filter(n => !allowed.has(n)))], [], 'every px font size is a DESIGN.md step');
});
