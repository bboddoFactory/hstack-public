// 설명 페이지가 공통 틀을 지키는지 실제 브라우저로 열어 센다. 하나라도 어기면 종료 코드 1.
// 쓰는 법: node check.cjs <페이지 주소 또는 hstack 저장소 기준 경로>...
//   경로는 검사하는 동안 스스로 띄우는 정적 서버(hstack 저장소 루트, 127.0.0.1의 빈 포트) 뒤에 붙인다. 페이지를 못 열면 실패다.
//   떠 있는 다른 서버와 그림 엔진에 기대지 않는다. Chrome 위치는 cdp.cjs의 findChrome이 정하고 CHROME 환경 변수로 바꾼다.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {launch, findChrome} = require('./cdp.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const CSS_PATH = '/skills/browser-explain/assets/explain.css?v=';
const targets = process.argv.slice(2);
if (!targets.length) { console.error('쓰는 법: node check.cjs <페이지>...'); process.exit(2); }

const TYPES = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8'};
const serveRoot = () => new Promise(resolve => {
  const server = http.createServer((req, res) => {
    let file;
    try { file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); } catch { res.writeHead(400).end(); return; }
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404, {'content-type': 'text/plain; charset=utf-8'}).end('없는 파일'); return; }
      res.writeHead(200, {'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'}).end(data);
    });
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

// 원본 HTML에서 SVG 안을 뺀 부분. SVG 안의 style과 class는 그림의 것이라 틀 검사에서 뺀다.
const outsideSvg = html => html.replace(/<svg[\s\S]*?<\/svg>/gi, '');
const classesIn = css => new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(m => m[1]));

// 자유 블록(div.free[id])은 틀에 없는 모양을 쓰는 탈출구다. 안에서는 자기 <style>(선택자가 모두 #id로 시작), 모르는 class, 인라인 style, script를 허용한다.
// 아래 두 함수는 페이지 안에서 돈다(바깥 변수를 쓰지 않는다).
// 원본 글(script가 돌기 전)을 DOMParser로 읽어 블록 밖의 class와 인라인 style을 센다.
const inspectSource = (src, known) => {
  const doc = new DOMParser().parseFromString(src, 'text/html');
  const knownSet = new Set(known), used = new Set(), inline = [];
  for (const e of doc.querySelectorAll('[class], [style]')) {
    if (e.closest('svg') || e.closest('div.free[id]')) continue;
    for (const c of e.classList) if (!(c === 'free' && e.tagName === 'DIV')) used.add(c);
    const style = e.getAttribute('style');
    // style 속성은 데이터 값을 CSS 변수로 넘길 때만 쓴다(예: 막대 길이 style="--v:42%")
    if (style && style.split(';').map(x => x.trim()).filter(Boolean).some(d => !d.startsWith('--'))) inline.push(style);
  }
  return {inline, unknown: [...used].filter(c => !knownSet.has(c)), freeCount: doc.querySelectorAll('div.free[id]').length, freeNoId: doc.querySelectorAll('div.free:not([id])').length};
};
// 열린 페이지의 <style>을 본다: 블록 밖의 것, 블록 안이지만 선택자가 블록 id로 시작하지 않는 것.
const inspectStyles = () => {
  const split = text => { const parts = []; let depth = 0, from = 0; for (let i = 0; i < text.length; i++) { const c = text[i]; if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--; else if (c === ',' && !depth) { parts.push(text.slice(from, i)); from = i + 1; } } parts.push(text.slice(from)); return parts.map(s => s.trim()).filter(Boolean); };
  const outside = [], unscoped = [];
  for (const style of document.querySelectorAll('style')) {
    if (style.closest('svg')) continue;
    const block = style.closest('div.free[id]');
    if (!block) { outside.push(style.textContent.trim().slice(0, 40)); continue; }
    const prefix = '#' + CSS.escape(block.id);
    const walk = rules => { for (const rule of rules) {
      if (rule instanceof CSSStyleRule) { for (const sel of split(rule.selectorText)) if (!sel.startsWith(prefix) || /[\w\\-]/.test(sel.charAt(prefix.length))) unscoped.push(sel); }
      else if (rule.cssRules && !(rule instanceof CSSKeyframesRule)) walk(rule.cssRules);
    } };
    if (style.sheet) walk(style.sheet.cssRules);
  }
  return {outside, unscoped};
};

async function measure(page, scheme) {
  await page.emulateMediaFeatures([{name: 'prefers-color-scheme', value: scheme}]);
  return page.evaluate(() => {
    const rgb = s => (s.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => { const f = c => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const bgOf = e => { for (; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0.5)) return c; } return [255, 255, 255]; };
    const textEls = [...document.querySelectorAll('body *')].filter(e => !e.closest('svg') && !(e.closest('.diagram-viewer') && !e.closest('.diagram-content')) && e.offsetParent !== null && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
    const low = [];
    for (const e of textEls) {
      const a = lum(rgb(getComputedStyle(e).color)), b = lum(bgOf(e));
      const r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (r < 4.5) low.push(`${e.tagName.toLowerCase()}.${[...e.classList].join('.')} ${r.toFixed(2)} "${e.textContent.trim().slice(0, 20)}"`);
    }
    return low;
  });
}

async function textProblems(page) {
  return page.evaluate(() => {
    const clipped = [], broken = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode());) {
      const e = node.parentElement, text = node.textContent;
      if (!text.trim() || e.closest('svg') || (e.closest('.diagram-viewer') && !e.closest('.diagram-content')) || !e.checkVisibility({checkVisibilityCSS: true, checkOpacity: true})) continue;
      const range = document.createRange();
      const rectAt = (start, end) => { range.setStart(node, start); range.setEnd(node, end); return [...range.getClientRects()].filter(r => r.width && r.height); };
      const rects = rectAt(0, text.length);
      if (!rects.length) continue;
      let cut = false;
      for (let p = e; p && !cut; p = p.parentElement) {
        const s = getComputedStyle(p), box = p.getBoundingClientRect();
        // 가로나 세로로 밀어서 닿는 곳(scroll, auto)은 잘린 것이 아니다. 닿을 수 없게 감추는 hidden과 clip만 본다.
        const x = /^(hidden|clip)$/.test(s.overflowX), y = /^(hidden|clip)$/.test(s.overflowY);
        if (!x && !y) continue;
        const left = box.left + p.clientLeft, top = box.top + p.clientTop;
        cut = rects.some(r => (x && (r.left < left - 1 || r.right > left + p.clientWidth + 1)) || (y && (r.top < top - 1 || r.bottom > top + p.clientHeight + 1)));
      }
      if (cut) clipped.push(text.trim().replace(/\s+/g, ' '));
      for (const match of text.matchAll(/[^\s\-/(]+/gu)) {
        const lines = rectAt(match.index, match.index + match[0].length);
        if (lines.some(r => Math.abs(r.top - lines[0].top) > 1)) broken.push(match[0]);
      }
    }
    return {clipped, broken};
  });
}

(async () => {
  const server = await serveRoot();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const urlOf = t => /^https?:/.test(t) ? t : base + encodeURI(t.replace(/^\//, ''));
  let browser, failed = 0;
  try {
    const chrome = findChrome();
    if (!chrome) throw new Error('Chrome을 찾을 수 없습니다. CHROME 환경 변수로 위치를 지정하세요.');
    browser = await launch({executablePath: chrome});
    for (const t of targets) {
      const url = urlOf(t), errs = [], notes = [];
      const page = await browser.newPage();
      await page.setViewport({width: 1440, height: 900});
      const res = await page.goto(url, {waitUntil: 'networkidle0', timeout: 30000});
      if (!res || ![200, 304].includes(res.status())) throw new Error(`${t}: HTTP ${res ? res.status() : '응답 없음'}`);
      const src = outsideSvg(await res.text());

      // 틀을 덮어쓰지 않는다. <style>은 자유 블록 안에서만, 선택자는 그 블록의 #id로 시작해야 한다
      const styles = await page.evaluate(inspectStyles);
      if (styles.outside.length) errs.push(`자유 블록(div.free[id]) 밖에 <style>이 ${styles.outside.length}개 있다: ${styles.outside.slice(0, 2).join(' | ')}`);
      if (styles.unscoped.length) errs.push(`자유 블록 <style>의 선택자가 그 블록의 #id로 시작하지 않는다: ${styles.unscoped.slice(0, 3).join(' | ')}`);
      const links = [...src.matchAll(/<link[^>]+rel=["']?stylesheet[^>]*>/gi)].map(m => (m[0].match(/href=["']([^"']+)/) || [])[1] || '');
      const own = links.filter(h => h.includes(CSS_PATH.split('?')[0]));
      if (own.length !== 1 || !own[0].includes(CSS_PATH)) errs.push(`공통 CSS를 ${CSS_PATH}날짜 주소로 한 번 불러야 한다(불러온 것: ${links.join(', ') || '없음'})`);
      const extra = links.filter(h => !own.includes(h) && !/diagram-viewer\.css|fonts\.googleapis|pretendard/.test(h));
      if (extra.length) errs.push(`틀 밖의 CSS를 불렀다: ${extra.join(', ')}`);

      // 뼈대에 없는 class를 쓰지 않는다(공통 CSS와 뷰어 CSS에 있는 class만)
      const sheets = await page.evaluate(async () => Promise.all([...document.querySelectorAll('link[rel=stylesheet]')].filter(l => /explain\.css|diagram-viewer\.css/.test(l.href)).map(l => fetch(l.href).then(r => r.text()))));
      const known = new Set(sheets.flatMap(s => [...classesIn(s)]));
      const source = await page.evaluate(inspectSource, src, [...known]);
      // style 속성은 데이터 값을 CSS 변수로 넘길 때만 쓴다(예: 막대 길이 style="--v:42%")
      if (source.inline.length) errs.push(`SVG와 자유 블록 밖에 CSS 변수가 아닌 style 속성이 ${source.inline.length}개 있다: ${source.inline.slice(0, 2).join(' | ')}`);
      if (source.unknown.length) errs.push(`틀에 없는 class: ${source.unknown.join(', ')}`);
      if (source.freeNoId) errs.push(`id가 없는 div.free가 ${source.freeNoId}개 있다(자유 블록에는 id가 필요하다)`);
      if (source.freeCount) notes.push(`자유 블록 ${source.freeCount}개`);

      // 고정 자리, 그림 자리, 작은 글자, 가운뎃점
      const dom = await page.evaluate(() => {
        const main = document.querySelector('main.page, main.board');
        const board = !!main && main.classList.contains('board');
        const kids = main ? [...main.children] : [];
        const choiceSections = main ? main.querySelectorAll(':scope > section.choices') : [];
        const choices = [...(choiceSections[0]?.querySelectorAll(':scope > article.choice') ?? [])].map(c => ({name: c.querySelector(':scope > h3')?.textContent.trim() ?? '', theory: !!c.querySelector(':scope > p.theory')?.textContent.trim()}));
        const head = main && main.querySelector(':scope > header.page-head');
        const svgs = [...document.querySelectorAll('main svg')].filter(s => !s.parentElement.closest('svg') && !s.closest('.diagram-viewer button, .diagram-viewer [class*=tool], .diagram-viewer [class*=legend]'));
        const textEls = [...document.querySelectorAll('body *')].filter(e => !e.closest('svg') && !(e.closest('.diagram-viewer') && !e.closest('.diagram-content')) && e.offsetParent !== null && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
        return {
          hasMain: !!main, headFirst: kids[0] === head && !!head, hasH1: !!(head && head.querySelector('h1')),
          summaryItems: head && head.querySelector('ul.summary') ? head.querySelectorAll('ul.summary > li').length : 0,
          unknownsLast: !main.querySelector(':scope > section.unknowns') || kids[kids.length - 1].matches('section.unknowns'),
          board, choiceSections: choiceSections.length, choices,
          strayKids: kids.filter(k => !k.matches(board ? 'header.page-head, section.choices, section.claim, details.fold, section.unknowns' : 'header.page-head, section.claim, details.fold, section.unknowns')).map(k => k.tagName.toLowerCase() + (k.className ? '.' + k.className : '')),
          emptySpots: document.querySelectorAll('.diagram[data-src]').length,
          emptyViewers: [...document.querySelectorAll('.diagram-viewer')].filter(v => !v.querySelector('.diagram-content svg')).length,
          svgOutsideViewer: svgs.filter(s => !s.closest('.diagram-viewer .diagram-content') && !s.closest('.chart')).length,
          small: textEls.filter(e => parseFloat(getComputedStyle(e).fontSize) < 14).map(e => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} ${getComputedStyle(e).fontSize}`),
          // 페이지 글의 가운뎃점은 실패, 그림(SVG) 글자의 것은 알림만: 엔진이 그린 글자는 페이지를 만드는 쪽이 고칠 수 없다
          dots: (document.body.innerText.match(/·/g) || []).length - [...document.querySelectorAll('main svg')].reduce((n, s) => n + (s.textContent.match(/·/g) || []).length, 0),
          svgDots: [...document.querySelectorAll('main svg')].reduce((n, s) => n + (s.textContent.match(/·/g) || []).length, 0),
        };
      }).catch(() => ({hasMain: false}));
      if (!dom.hasMain) errs.push('main.page나 main.board가 없다');
      else {
        const root = dom.board ? 'main.board' : 'main.page';
        if (!dom.headFirst || !dom.hasH1) errs.push(`${root}의 첫 자식이 h1을 가진 header.page-head가 아니다`);
        if (dom.summaryItems > 3) errs.push(`요약 항목이 ${dom.summaryItems}개다(세 개 이하)`);
        if (!dom.unknownsLast) errs.push('section.unknowns가 맨 아래가 아니다');
        if (dom.strayKids.length) errs.push(`${root} 바로 아래에 고정 자리 밖의 요소: ${dom.strayKids.join(', ')}`);
        if (dom.board) {
          // 비교판 뼈대: 후보 자리 하나, 후보 2~4개, 후보마다 이름(h3)과 이론 줄(p.theory)
          if (dom.choiceSections !== 1) errs.push(dom.choiceSections ? `후보 자리(section.choices)가 ${dom.choiceSections}개다(하나여야 한다)` : '후보 자리(section.choices)가 없다');
          else {
            if (dom.choices.length < 2) errs.push(`후보(article.choice)가 2개 이상이어야 한다(지금 ${dom.choices.length}개)`);
            if (dom.choices.length > 4) errs.push(`후보(article.choice)는 4개 이하여야 한다(지금 ${dom.choices.length}개)`);
            dom.choices.forEach((c, i) => {
              if (!c.name) errs.push(`후보 ${i + 1}번에 이름(h3)이 없다`);
              if (!c.theory) errs.push(`후보 '${c.name || i + 1 + '번'}'에 이론 줄(p.theory)이 없다`);
            });
          }
        }
        if (dom.emptySpots) errs.push(`채우지 않은 그림 자리 ${dom.emptySpots}개`);
        if (dom.emptyViewers) errs.push(`SVG 그림이 없는 뷰어 ${dom.emptyViewers}개`);
        if (dom.svgOutsideViewer) errs.push(`그림 뷰어(.diagram-viewer .diagram-content) 밖의 SVG ${dom.svgOutsideViewer}개(데이터 차트는 .chart 안)`);
        if (dom.small.length) errs.push(`14px 미만 글자 ${dom.small.length}개: ${dom.small.slice(0, 3).join('; ')}`);
        if (dom.dots > 0) errs.push(`가운뎃점 ${dom.dots}개`);
        if (dom.svgDots) notes.push(`그림 글자의 가운뎃점 ${dom.svgDots}개(엔진 그림이면 엔진 쪽에 알린다)`);
      }

      for (const scheme of ['light', 'dark']) {
        const low = await measure(page, scheme);
        if (low.length) errs.push(`${scheme} 명암비 4.5 미만 ${low.length}개: ${low.slice(0, 3).join('; ')}`);
      }
      await page.emulateMediaFeatures([{name: 'prefers-color-scheme', value: 'light'}]);
      const checkText = async width => {
        const problems = await textProblems(page);
        for (const text of problems.clipped) errs.push(`${width}px 글자 잘림: "${text}"`);
        for (const text of problems.broken) errs.push(`${width}px 단어 중간 끊김: "${text}"`);
      };
      await checkText(1440);
      await page.setViewport({width: 390, height: 844});
      await page.reload({waitUntil: 'networkidle0'});
      await checkText(390);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 0) errs.push(`폰 폭 390px에서 페이지가 ${over}px 가로로 넘친다`);

      console.log((errs.length ? `실패 ${t}\n  - ${errs.join('\n  - ')}` : `통과 ${t}`) + (notes.length ? `\n  알림: ${notes.join('; ')}` : ''));
      if (errs.length) failed++;
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    server.close();
  }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
