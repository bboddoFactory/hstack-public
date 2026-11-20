# 설명 페이지 뼈대: 고정 자리와 부품 이름

페이지를 만드는 쪽은 이 문서와 `assets/page.html`(부품을 다 보인 예시)만 보고 쓴다. `new page`가 만든 `원본.html`의 내용만 바꾼다. 비교판은 `new board`가 만들고 아래 「비교판 뼈대」를 따른다. 페이지 틀의 모양은 공통 CSS 한 장(`assets/explain.css`)이 정한다.

## 불러오는 것

페이지는 `new`가 만든 원본의 세 줄을 그대로 둔다. CSS를 복사하지 않는다.

글꼴은 `explain.css`가 불러온다. 뷰어 CSS와 스크립트는 `</main>` 뒤에 둔다. 그림 뷰어가 없는 페이지도 같은 세 줄을 쓴다. `style` 속성은 데이터 값을 CSS 변수로 넘길 때만 쓴다(막대 길이 `style="--v:44%"`).

## 페이지 뼈대

```html
<main class="page">
  <header class="page-head">…</header>
  <section class="claim">…</section>   <!-- 절의 수만큼 -->
  <details class="fold">…</details>    <!-- 있을 때만, unknowns 앞 -->
  <section class="unknowns">…</section>
</main>
```

`main.page` 바로 아래에는 이 넷만 둔다.

## 비교판 뼈대

사용자가 후보 중에서 골라야 하는 자료는 `new board`가 만든 비교판이다. 설명 페이지와 같은 부품(표, 그림 묶음, 코드)을 쓰고 자리만 다르다.

```html
<main class="board">
  <header class="page-head">…</header>      <!-- h1은 고를 질문, ul.summary에 권고, div.modebar(라이트와 다크 단추)는 틀이 준 그대로 -->
  <section class="choices">                 <!-- 필수, 하나 -->
    <article class="choice">                <!-- 2개에서 4개 -->
      <h3>후보 이름</h3>
      <p class="theory">이론 이름: 한 줄 뜻</p>
      …                                      <!-- 내용: 글, 표, 그림 -->
    </article>
  </section>
  <section class="claim">…</section>        <!-- 있을 때만 -->
  <details class="fold">…</details>         <!-- 있을 때만 -->
  <section class="unknowns">…</section>     <!-- 맨 아래 -->
</main>
```

후보는 넓은 화면에서 가로로 나란히 놓이고 폰 폭에서 세로로 쌓인다. check가 후보 수(2개에서 4개)와 후보마다 이름(`h3`)과 이론 줄(`p.theory`)을 본다. 값과 이론은 [비교판 만드는 법](../../ui-design/references/comparison-board.md)을 따른다. 라이트와 다크 단추는 그 페이지 안에서만 모드를 바꾸고, 설명 페이지는 기기 설정을 따른다.

## 고정 자리 (순서 고정)

| 자리 | 요소와 class | 안에 들어가는 것 |
|---|---|---|
| 1 머리 | `header.page-head` | `p.page-type`(분류 한 줄, 없으면 뺀다), `h1`(제목), `ul.summary`(요약). 첫 자식이어야 한다 |
| 2 본문 절 | `section.claim` (`id`를 붙인다) | `h2`(주장 한 문장)와 아래 부품. 절의 수와 구성은 페이지마다 다르다 |
| 3 접어 둔 상세 | `details.fold` | 있을 때만. `unknowns` 앞에 둔다 |
| 4 확인하지 못한 것 | `section.unknowns` | `h2`와 `ul.unknown-list > li`. 맨 아래 한 곳이고 화면 폭 전체의 회색 띠로 보인다 |

요약(`ul.summary`)은 항목 셋 이하다. `<li><strong>굵은 앞 구절.</strong> 나머지</li>` 모양이다.

## 부품

| 부품 | 요소와 class | 언제 쓰나 |
|---|---|---|
| 요약 | `ul.summary` | 머리 안, 제목 바로 아래 |
| 선택지 제목과 설명 | `h3`, `p.intro` | 정할 것이 있는 절의 비교 표 앞. 첫 단락의 첫 낱말 몇 개는 `span.newthought`로 감싼다 |
| 비교 표 | `table.compare` | 같은 기준으로 여러 대상을 견줄 때. `thead > tr > th`, 이름 칸은 `td.name > b`(필요하면 `span`으로 짧은 설명), 나머지 칸은 `td[data-label="열 이름"]`. 폰에서 "열 이름: 값"으로 쌓인다 |
| 권고 | `p.recommend` | 비교 표 다음. `<strong>권고: …</strong>`로 시작한다 |
| 미정과 정함 | `strong.status.status-open`, `strong.status.status-set` | 글 앞에 붙는 표시. 글자는 "미정", "정함" |
| 그림 묶음 | `figure.fig` | 그림 하나와 그 설명. 아래 별도 절 |
| 접어 둔 상세 | `details.fold > summary`와 `div.fold-body` | `div.fold-body` 안에 `h3`, `ul.link-list > li`(링크는 `a`, 주소 글은 `span.url`) |
| 확인하지 못한 것 | `ul.unknown-list` | `section.unknowns` 안 |
| 코드 블록 | `pre.code > code` | 명령이나 코드 여러 줄. 긴 줄은 블록 안에서 옆으로 밀고 페이지는 넘치지 않는다. 글자는 작은 글자(14px)다 |
| 글 속 코드 | `code` | 문장 속 명령, 파일 이름, 값 |
| 이미지 | `figure.fig > img[alt]`와 `figcaption` | 화면 캡처와 사진. `alt`에 무엇이 보이는지 쓰고, `src`는 자료 폴더 안의 파일이다(build가 판마다 고정한다) |

## 그림 묶음 `figure.fig`

자식 요소는 아래 순서로 둔다. 있는 것만 쓴다. 그림 설명(`figcaption`)은 화면에서 그림 위에 보인다.

```html
<figure class="fig">
  <div class="diagram-viewer" data-width="1300" data-height="900">…</div>   <!-- 또는 div.chart -->
  <figcaption>
    <p class="fig-sub">그림 종류와 고른 이유</p>
    <p class="fig-legend">범례</p>   <!-- 손으로 그린 그림만. 색 견본 범례는 div.fig-legend > span > i.sw.acc 등. 엔진 그림의 범례는 뷰어가 보인다 -->
  </figcaption>
  <ol class="badge-list"><li><strong class="status status-open">미정</strong> 번호 배지의 뜻</li></ol>
  <p class="fig-note">그림이나 표 아래 덧붙임</p>   <!-- 덧붙임이 여럿이면 div.fig-note > ul > li -->
</figure>
```

그림 자리에는 아래 중 하나가 온다. 한 묶음에 하나다.

| 그림 | 요소 | 어디에 두나 |
|---|---|---|
| 관계 그림(흐름, 시퀀스, 구조, 상태, 표 관계 등)의 SVG | `div.diagram-viewer` | 뷰어 안. 아래 구조를 쓴다 |
| 값의 크기를 보이는 막대 SVG | `svg` | `div.chart` 안 |
| 막대(HTML) | `div.bars > div.panel`(`h3`, `p.meta`, `div.bar > span.who, span.track > i, span.val`). 길이는 `<i style="--v:42%">` | `div.chart` 안 |
| 누적 막대(HTML) | `div.stack > div`(칸마다 `style="--v:3"`으로 폭 비율)와 `div.stack-total` | `div.chart` 안 |
| 칸 흐름(HTML) | `div.lanes > div.lane > div.box(.sec, .acc) + svg.arr` | `div.chart` 안 |
| 트리(HTML) | `div.tree > div.root, div.branches > div.branch > div.head + ul.chips`, `div.check` | `div.chart` 안 |
| 비교 표 | `table.compare` | `figure.fig` 바로 아래 |
| 화면 캡처, 사진 | `img[alt]` | `figure.fig` 바로 아래. 그림 묶음에서 위에 `figcaption`이 보인다 |

막대 색은 한 규칙이다: 막대와 칸은 모두 중립 회색이고, 이 그림에서 봐야 할 하나(또는 한 묶음)에만 `class="hl"`을 붙여 강조색으로 칠한다. 칸 class는 칸의 뜻이 아니라 역할(`hl`과 기본)이다. 노랑 같은 주석색과 미정 색은 막대에 쓰지 않는다.

```html
<div class="chart"><div class="bars"><div class="panel">
  <div class="bar"><span class="who">지금</span><span class="track"><i style="--v:25%"></i></span><span class="val">1,000건</span></div>
  <div class="bar"><span class="who">내년</span><span class="track"><i class="hl" style="--v:100%"></i></span><span class="val">4,000건</span></div>
</div></div></div>

<div class="chart">
  <div class="stack" role="img" aria-label="4건 중 성공 3건, 재시도 1건">
    <div style="--v:3"><b>3</b>성공</div><div class="hl" style="--v:1"><b>1</b>재시도</div>
  </div>
  <div class="stack-total"><span>0</span><span>4건</span></div>
</div>
```

`div.chart`는 뷰어 없이 페이지 폭에 맞춰 줄어드는 그림의 자리다. 값의 크기를 보이는 그림과 HTML로 그린 그림을 여기에 둔다. 관계 그림의 SVG는 `div.chart`에 넣지 않고 모두 뷰어 안에 둔다.

### 그림 뷰어 구조

```html
<div class="diagram-viewer" data-width="1300" data-height="900">
  <div class="diagram-viewport" tabindex="0" role="region" aria-label="그림 이름">
    <div class="diagram-content">
      <svg viewBox="0 0 1300 900">…</svg>
    </div>
  </div>
</div>
```

- `data-width`와 `data-height`는 SVG `viewBox`의 폭과 높이와 같게 쓴다.
- 도구 모음과 범례 단추는 뷰어가 만든다. 페이지에 단추를 쓰지 않고, "좌우로 밀어서 본다" 같은 안내 문구도 쓰지 않는다.
- 그림 이름(`aria-label`)은 그림이 무엇인지 말하는 한 구절이다.
- 화살촉 마커는 그 SVG 자신의 `defs`에 둔다. 한 페이지에 SVG가 여럿이면 마커 `id`를 그림마다 다르게 쓴다. 엔진 SVG는 `arrow`를 쓰므로 손으로 그린 SVG는 다른 이름(예: `flow-arrow`)을 쓴다.

### 엔진이 그린 그림 넣기

원본 페이지의 그림 자리에 `<div class="diagram" data-src="그림.svg"></div>` 한 줄을 쓰고, 같은 폴더에 입력 `그림.json`을 둔다(`data-src`는 원본 페이지 기준 경로). 스킬 CLI의 `build <자료 폴더>`가 JSON에서 SVG를 다시 그려 이 자리를 위의 뷰어 구조와 SVG로 바꾼 판을 놓는다. 원본은 고쳐 쓰는 쪽이고 판은 build가 새로 놓는다(올린 판은 고치지 않는다). SVG를 읽거나 붙여 넣지 않고 고치지 않는다. 손으로 그린 SVG는 위 뷰어 구조에 직접 쓴다. 엔진 SVG는 흰 바탕과 자기 색을 가지고 있어 어두운 모드에서도 흰 판으로 읽힌다. `explain.css`는 엔진 SVG의 색을 건드리지 않는다.

- 시퀀스처럼 루트 `svg`에 `data-head-top`이 있으면 뷰어가 틀 없이 페이지 흐름으로 펼치고, 내려 읽는 동안 참가자 줄이 창 위에 붙는다. 폰 폭에서는 그림 안에서 가로로 움직인다.
- 컨테이너, 시스템 컨텍스트, ERD는 고정 높이 틀 안에서 확대하고 옮긴다.
- 범례는 뷰어의 범례 단추가 펼친다. 페이지에 따로 그리지 않는다.

### 그림의 모양은 그림이 가진다

`explain.css`는 페이지 틀만 정한다. SVG 안의 상자, 선, 글자 모양을 정하는 class는 없다. 손으로 그린 SVG는 자기 모양을 SVG 안 `<style>`에 둔다.

- `<style>`은 문서 전체에 적용되므로 규칙은 SVG의 `id`로 좁힌다(`#flow-fig .node`).
- 색은 SVG 루트의 CSS 변수로 두고, 어두운 모드는 그 안의 `@media (prefers-color-scheme: dark)`가 바꾼다. 페이지의 변수를 쓰지 않아 SVG만 떼어 가도 같게 보인다.
- 값은 아래 표에서 고른다. 표에 없는 색이 필요하면 가장 가까운 값을 쓴다. SVG 글자는 14px 이상이다.

| 역할 | 밝은 모드 | 어두운 모드 |
|---|---|---|
| 종이 | `#fff` | `#0b0c0c` |
| 글자 | `#0b0c0c` | `#fff` |
| 상자 테두리 | `#6f777b` | `#8f979b` |
| 선 | `#505a5f` | `#b1b4b6` |
| 강조 | `#1d70b8` | `#a8c1ff` |
| 강조 바탕 | `#eaf0ff` | `#283852` |
| 회색 바탕 | `#f3f2f1` | `#1f2325` |
| 미정 바탕 | `#fff5df` | `#342b19` |
| 미정 선 | `#a07b36` | `#d5b477` |
| 미정 글자 | `#67430b` | `#f4d49a` |

```html
<svg id="flow-fig" viewBox="0 0 400 120" role="img" aria-labelledby="t1">
  <title id="t1">흐름 그림 이름</title>
  <style>
  #flow-fig{--paper:#fff;--ink:#0b0c0c;--edge:#6f777b;--line:#505a5f;--accent:#1d70b8;--soft:#eaf0ff}
  @media (prefers-color-scheme:dark){#flow-fig{--paper:#0b0c0c;--ink:#fff;--edge:#8f979b;--line:#b1b4b6;--accent:#a8c1ff;--soft:#283852}}
  #flow-fig .node{fill:var(--paper);stroke:var(--edge);stroke-width:1.7}
  #flow-fig .accent{fill:var(--soft);stroke:var(--accent)}
  #flow-fig .label{fill:var(--ink);font-size:20px;font-weight:600}
  #flow-fig .edge{fill:none;stroke:var(--line);stroke-width:2;marker-end:url(#flow-arrow)}
  #flow-fig marker path{fill:var(--line)}
  </style>
  <defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 10 5 0 10Z"/></marker></defs>
  <rect x="10" y="30" width="140" height="60" rx="8" class="node"/>
  <text x="80" y="66" class="label" text-anchor="middle">주문 서버</text>
  <path d="M150 60H250" class="edge"/>
  <rect x="250" y="30" width="140" height="60" rx="8" class="node accent"/>
  <text x="320" y="66" class="label" text-anchor="middle">알림 서버</text>
</svg>
```

## 자유 블록: 부품에 없는 모양이 꼭 필요할 때만

`section.claim`이나 `figure.fig` 안에 `<div class="free" id="이름">`을 두면 그 안에서만 자기 `<style>`, 부품에 없는 class, 인라인 style, `<script>`를 쓸 수 있다. `<style>`의 선택자는 모두 `#이름`으로 시작한다. 블록 밖에서는 SVG 안을 빼고 `<style>`과 부품 표에 없는 class를 쓰지 않는다. 대비, 작은 글자, 글자 잘림, 단어 끊김, 폰 폭 넘침은 블록 안에도 적용되고, check와 build가 블록 수를 센다.
