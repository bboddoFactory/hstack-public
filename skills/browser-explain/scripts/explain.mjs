import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile, writeFile, rm, access, mkdir, readdir, rename, link, stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename, dirname, join, resolve, relative, isAbsolute, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const {findChrome} = createRequire(import.meta.url)('./cdp.cjs');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const skill = join(root, 'skills/browser-explain');
const engine = resolve(process.env.HSTACK_DIAGRAM || join(homedir(), 'workspace/hstack-diagram'));
const engineCli = join(engine, 'src/cli.mjs');
const [command, ...args] = process.argv.slice(2);
const fail = message => { throw new Error(message); };
// 그림 엔진은 CHROME_PATH만 읽는다. 비어 있으면 check와 같은 규칙(findChrome)으로 찾은 경로를 넘긴다.
const chrome = findChrome();
const engineEnv = chrome && !process.env.CHROME_PATH ? {...process.env, CHROME_PATH: chrome} : process.env;
const call = (script, argv, timeout, env = process.env) => {
  const result = spawnSync(process.execPath, [script, ...argv], {encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout, env});
  if (result.error) fail(result.error.message);
  return result;
};
async function requireEngine() {
  try { await access(engineCli); } catch { fail(`그림 엔진을 찾을 수 없습니다: ${engineCli}. HSTACK_DIAGRAM으로 엔진 저장소 위치를 지정하세요.`); }
}
const exists = path => access(path).then(() => true, () => false);
const attr = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// 저장소 안의 경로면 저장소 기준 경로, 밖이면 null
const inside = (base, path) => { const rel = relative(base, path); return rel !== '' && rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel) ? rel : null; };
// 상대 경로는 부른 폴더 기준이 먼저다. 그 자리에 없으면 hstack 저장소 기준으로 본다.
const locate = async arg => isAbsolute(arg) || await exists(resolve(arg)) ? resolve(arg) : resolve(root, arg);

const NAME = /^[가-힣a-z0-9]+(-[가-힣a-z0-9]+)*$/;
const TASK_DIR = /^data\/story-map\/[^/]+\/tasks\/[^/]+$/;
const MATERIAL_DIR = /^data\/story-map\/[^/]+\/tasks\/[^/]+\/자료\/[^/]+$/;
const VERSION = /^\d{8}-\d{6}\.html$/;
const versionsOf = async dir => (await readdir(dir)).filter(f => VERSION.test(f)).sort();
const titleOf = html => (html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim().replace(/\s+/g, ' ');
const stamp = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

// 그림 하나: 같은 이름 옆에 SVG를 만든다. 실패하면 옛 SVG도 지워 build가 낡은 그림을 읽지 못하게 한다.
async function drawJson(input) {
  const output = input.slice(0, -extname(input).length) + '.svg';
  try {
    await requireEngine();
    const result = call(engineCli, ['--input', input, '--output', output], undefined, engineEnv);
    if (result.status !== 0) fail((result.stderr || result.stdout || '그림 생성 실패').trim().slice(0, 1600));
    return {output, notices: JSON.parse(result.stdout).notices || []};
  } catch (error) { await rm(output, {force: true}); throw error; }
}

// 종류마다 빈 틀 하나: page는 설명 페이지, board는 후보를 나란히 놓고 고르는 비교판
const KIND_TEMPLATE = {page: 'page-blank.html', board: 'board-blank.html'};
async function newMaterial(kind, taskArg, name) {
  if (!Object.hasOwn(KIND_TEMPLATE, kind)) fail(`new의 종류는 page와 board 둘뿐입니다: ${kind}`);
  const task = await locate(taskArg);
  const taskRel = inside(root, task);
  if (!taskRel || !TASK_DIR.test(taskRel) || !await exists(join(task, '작업.md'))) fail(`작업 폴더가 아닙니다: ${taskArg}. data/story-map/<프로젝트>/tasks/<작업>/ 이고 작업.md가 있어야 합니다.`);
  if (!NAME.test(name)) fail(`자료 이름은 한글, 영소문자, 숫자, 하이픈만 쓰고 하이픈은 낱말 사이에만 둡니다: ${name}`);
  const template = await readFile(join(skill, 'assets', KIND_TEMPLATE[kind]), 'utf8');
  const dir = join(task, '자료', name);
  await mkdir(dirname(dir), {recursive: true});
  try { await mkdir(dir); } catch (error) {
    if (error.code === 'EEXIST') fail(`같은 이름의 자료가 이미 있습니다: ${taskRel}/자료/${name}. 다른 이름을 쓰거나, 그 자료를 고치려면 원본.html을 고쳐 build하세요.`);
    throw error;
  }
  try { await writeFile(join(dir, '원본.html'), template.replaceAll('{{제목}}', name.replaceAll('-', ' ')), {flag: 'wx'}); }
  catch (error) { await rm(dir, {recursive: true, force: true}); throw error; }
  console.log(`만듦: ${taskRel}/자료/${name}/원본.html`);
}

// 판이 부르는 로컬 파일(같은 자료 폴더 안 상대 경로의 img, video, audio, source, track)은 내용 해시를 붙인 이름으로 복사해 고정한다.
// 원본 파일을 나중에 바꿔도 지난 판은 그때 그 파일을 보이고, 같은 내용이면 같은 이름이라 같은 판이 같은 바이트로 나온다.
const LOCAL_TAG = /<(?:img|video|audio|source|track)\b[^>]*>/gi;
const LOCAL_ATTR = /(\s(?:src|poster)=)(?:"([^"]*)"|'([^']*)')/gi;
async function pinLocals(html, dir) {
  const values = new Set();
  for (const tag of html.matchAll(LOCAL_TAG)) for (const a of tag[0].matchAll(LOCAL_ATTR)) values.add(a[2] ?? a[3]);
  const renamed = new Map(), copies = [];
  for (const value of values) {
    if (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(value)) continue;
    const file = value.split(/[?#]/)[0], suffix = value.slice(file.length);
    let from;
    try { from = resolve(dir, decodeURIComponent(file)); } catch { continue; }
    if (!file || !inside(dir, from)) continue;
    let data;
    try { data = await readFile(from); } catch { fail(`판이 부르는 파일을 읽을 수 없습니다: ${value}`); }
    const ext = extname(file), pinned = `${file.slice(0, file.length - ext.length)}-${createHash('sha256').update(data).digest('hex').slice(0, 10)}${ext}`;
    renamed.set(value, pinned + suffix);
    copies.push({to: resolve(dir, decodeURIComponent(pinned)), data});
  }
  const out = html.replace(LOCAL_TAG, tag => tag.replace(LOCAL_ATTR, (m, pre, v1, v2) => {
    const pinned = renamed.get(v1 ?? v2);
    return pinned ? `${pre}${v1 !== undefined ? `"${pinned}"` : `'${pinned}'`}` : m;
  }));
  return {html: out, copies};
}

// 끊긴 build가 남긴 임시 파일(만든 프로세스가 없는 것)을 치운다. 돌고 있는 다른 build의 것은 건드리지 않는다.
async function sweepStale(dir) {
  for (const f of await readdir(dir)) {
    const pid = Number(f.match(/^_검사중-(\d+)\.html$/)?.[1]);
    if (!pid || pid === process.pid) continue;
    try { process.kill(pid, 0); } catch (error) { if (error.code !== 'EPERM') await rm(join(dir, f), {force: true}); }
  }
}

async function build(materialArg) {
  const dir = await locate(materialArg);
  const rel = inside(root, dir);
  if (!rel || !MATERIAL_DIR.test(rel) || !(await stat(dir).catch(() => null))?.isDirectory() || !await exists(join(dir, '원본.html'))) fail(`자료 폴더가 아닙니다: ${materialArg}. data/story-map/<프로젝트>/tasks/<작업>/자료/<이름>/ 이고 원본.html이 있어야 합니다(explain new page로 만듭니다).`);
  const source = await readFile(join(dir, '원본.html'), 'utf8');
  await sweepStale(dir);

  // 제목: 허브 목록에 보이는 이름이다
  const title = titleOf(source);
  if (!title) fail('원본.html의 <title>이 비었습니다. 목록에 보일 짧은 이름을 쓰세요.');
  if ([...title].length > 30) fail(`<title>이 30자를 넘습니다(${[...title].length}자): ${title}. 목록에 보일 짧은 이름으로 줄이세요(긴 주장은 h1에 씁니다).`);
  const siblings = dirname(dir);
  for (const other of await readdir(siblings)) {
    if (other === basename(dir)) continue;
    const versions = await versionsOf(join(siblings, other)).catch(() => []);
    if (versions.length && titleOf(await readFile(join(siblings, other, versions.at(-1)), 'utf8')) === title) fail(`같은 작업의 자료 '${other}'가 같은 <title>을 씁니다: ${title}. 같은 자료를 고친 것이면 그 폴더의 원본.html을 build하고, 다른 자료면 <title>을 바꾸세요.`);
  }

  // 그림: 그림 자리마다 같은 이름 JSON에서 다시 그린다. JSON이 없으면 SVG 파일을 쓴다.
  const placeholder = /<div\s+class=["']diagram["']\s+data-src=["']([^"']+)["']\s*>\s*<\/div\s*>/gi;
  const spots = [...source.matchAll(placeholder)];
  const svgs = new Map();
  for (const src of new Set(spots.map(m => m[1]))) {
    const svgPath = resolve(dir, src);
    if (!inside(dir, svgPath) || extname(svgPath).toLowerCase() !== '.svg') fail(`그림 자리의 data-src는 자료 폴더 안의 .svg 파일이어야 합니다: ${src}`);
    const json = svgPath.slice(0, -4) + '.json';
    if (await exists(json)) {
      try { await drawJson(json); } catch (error) { fail(`그림 입력 ${relative(dir, json)}: ${error.message}`); }
    } else if (!await exists(svgPath)) fail(`그림 '${basename(svgPath, '.svg')}'의 입력이 없습니다: ${relative(dir, json)}도 ${src}도 없습니다. describe로 입력 규칙을 보고 JSON을 쓰세요.`);
    svgs.set(src, await readFile(svgPath, 'utf8'));
  }
  let filled = '', last = 0;
  for (const match of spots) {
    const svg = svgs.get(match[1]);
    const tag = svg.match(/<svg\b[^>]*>/i)?.[0];
    const width = tag?.match(/\bwidth=["']([^"']+)["']/i)?.[1];
    const height = tag?.match(/\bheight=["']([^"']+)["']/i)?.[1];
    const label = svg.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    if (!width || !height || !label) fail(`그림에 width, height 또는 title이 없습니다: ${match[1]}`);
    filled += source.slice(last, match.index) + `<div class="diagram-viewer" data-width="${attr(width)}" data-height="${attr(height)}">\n<div class="diagram-viewport" tabindex="0" role="region" aria-label="${label.replace(/"/g, '&quot;')}">\n<div class="diagram-content">\n${svg}\n</div>\n</div>\n</div>`;
    last = match.index + match[0].length;
  }
  filled += source.slice(last);
  const {html, copies} = await pinLocals(filled, dir);

  // 마지막 판과 내용이 같으면 새 판을 만들지 않는다(같은 build를 다시 불러도 같은 결과)
  // 검사하는 동안 같은 자료를 다른 build가 먼저 올렸을 수 있어, 놓기 직전에 한 번 더 본다.
  const sameAsLast = async () => { const versions = await versionsOf(dir); return versions.length && await readFile(join(dir, versions.at(-1)), 'utf8') === html ? versions.length : 0; };
  const same = async () => { const n = await sameAsLast(); if (n) console.log(`변경 없음: 판 ${n} 그대로`); return n; };
  if (await same()) return;

  // 임시 이름으로 써서 검사하고, 통과해야만 시각 이름으로 놓는다. 실패하면 이번에 만든 파일을 모두 지운다.
  const temp = join(dir, `_검사중-${process.pid}.html`), created = [];
  try {
    for (const {to, data} of copies) {
      if (await exists(to)) continue;
      const part = `${to}.${process.pid}.part`;
      await writeFile(part, data);
      await rename(part, to);
      created.push(to);
    }
    await writeFile(temp, html);
    const tempRel = inside(root, temp);
    const result = call(join(skill, 'scripts/check.cjs'), [tempRel], 180000);
    if (result.status !== 0) fail((result.stdout + result.stderr).trim().replaceAll(tempRel, `${rel}/원본.html`).replace(/^실패 /, '') || '페이지 검사 실패');
    if (await same()) return;
    let when = new Date(), name;
    for (;;) {
      name = `${stamp(when)}.html`;
      try { await link(temp, join(dir, name)); break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; when = new Date(when.getTime() + 1000); }
    }
    const free = result.stdout.match(/자유 블록 (\d+)개/)?.[1] ?? '0';
    console.log(`올림: ${rel}/${name} (판 ${(await versionsOf(dir)).indexOf(name) + 1}, 자유 블록 ${free}개)`);
  } catch (error) {
    for (const file of created) await rm(file, {force: true});
    throw error;
  } finally { await rm(temp, {force: true}); }
}

try {
  if (command === 'describe' && args.length === 1) {
    await requireEngine();
    const result = call(engineCli, ['--help', args[0]]);
    process.stdout.write(result.stdout); process.stderr.write(result.stderr);
    process.exitCode = result.status || 0;
  } else if (command === 'draw' && args.length === 1) {
    const input = resolve(args[0]);
    if (extname(input).toLowerCase() !== '.json') fail('입력은 .json 파일이어야 합니다.');
    const {output, notices} = await drawJson(input);
    console.log(`그림 생성: ${output}` + (notices.length ? ` | 알림: ${notices.map(n => n.message).join('; ')}` : ''));
  } else if (command === 'new' && args.length === 3) {
    await newMaterial(...args);
  } else if (command === 'build' && args.length === 1) {
    await build(args[0]);
  } else if (command === 'check' && args.length === 1) {
    let target = args[0];
    if (!/^https?:\/\//i.test(target)) {
      const path = await locate(target);
      const rel = inside(root, path);
      if (!rel) fail(`hstack 저장소 안의 페이지 경로가 필요합니다: ${target}`);
      target = rel;
    }
    const result = call(join(skill, 'scripts/check.cjs'), [target], 180000);
    if (result.status !== 0) fail((result.stdout + result.stderr).trim().replace(/^실패 /, '') || '페이지 검사 실패');
    const free = result.stdout.match(/자유 블록 (\d+)개/)?.[1];
    console.log(`검사 통과: ${args[0]}` + (free ? ` (자유 블록 ${free}개)` : ''));
  } else fail('사용법: explain.mjs describe <종류> | draw <입력.json> | new page|board <작업 폴더> <이름> | build <자료 폴더> | check <페이지>');
} catch (error) {
  console.error(`실패: ${error.message}`);
  process.exitCode = 1;
}
