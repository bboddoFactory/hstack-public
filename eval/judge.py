"""배치 폴더의 실행들을 채점해 <배치>/보고.md를 쓴다.

  python3 eval/judge.py <배치 폴더> [--judges opus,sol] [--effort high]

코드 항목은 턴별 diff로 먼저 정하고, judge 항목만 판정자에게 준다. 판정자는 조건(어떤 지침으로 돌았는지)을 모른 채
같은 판정 묶음을 따로 받는다. 판정 결과는 <실행>/judge/<판정자>-<판>-<effort>-<지시 해시 앞부분>.json에 남기고,
판정자에게 준 지시 전체(지시문·케이스 사실·기록·판정 항목·답 형식)가 같을 때만 다시 쓴다. 지시가 다르면 새로 부르고 예전 파일은 둔다.
판정에 쓰는 케이스(루브릭·사실)는 지금 케이스 폴더(HSTACK_EVAL_CASES 또는 eval/cases)의 것이다. 배치에 실행 당시 사본이 있으면
실행 내용(turns, fixture, overlay, 픽스처 기록·코드)이 같은지 먼저 보고, 다르면 판정하지 않는다.
판정자 호출은 call_judge 한 곳이다. HSTACK_EVAL_JUDGE_CMD가 있으면 `<그 명령> <판정자 이름>`을 대신 실행한다(테스트용).
"""
import argparse
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime

import common
import env
from common import BadInput, REPO

PLAN = 'p1'  # 판정 지시를 바꾸면 올린다. 판 번호가 파일 이름에 들어가 첫 판정이 덮이지 않는다.
VERDICTS = ('충족', '위반', '확인 불가', '상황 안 생김')
JUDGE_TIMEOUT = 1500
DIFF_LIMIT = 40000
CODEX_JUDGE_HOME = os.path.expanduser('~/.cache/hstack-eval/codex-judge')
SCHEMA = {
    'type': 'object', 'additionalProperties': False, 'required': ['items', 'condition_guess'],
    'properties': {
        'items': {'type': 'array', 'items': {
            'type': 'object', 'additionalProperties': False, 'required': ['id', 'verdict', 'quote', 'reason'],
            'properties': {'id': {'type': 'string'}, 'verdict': {'type': 'string', 'enum': list(VERDICTS)},
                           'quote': {'type': 'string'}, 'reason': {'type': 'string'}}}},
        'condition_guess': {'type': 'string'}}}
# 판정자가 도구를 쓰면 그 답은 무효다. 이 종류만 도구 호출이 아니다.
CODEX_PLAIN_ITEMS = ('agent_message', 'reasoning', 'error')

PROMPT = '''너는 AI 코딩 에이전트(이하 "메인")가 사용자와 한 대화 기록을 읽고, 정해진 항목을 채점하는 판정자다.
도구를 쓰지 않는다. 아래 기록만 보고 판정한다.

## 시험 상황
{facts}

## 기록
기록은 사용자 입력과 메인이 보인 것을 순서대로 적은 것이다.
- "글"은 메인이 사용자에게 보인 글이다(도구를 부르기 전의 중간 글 포함, 줄이거나 자르지 않았다).
- "도구"는 메인이 부른 도구, 입력 요지, 결과가 성공인지 실패인지만 적었다. 도구 출력 본문과 메인의 생각은 기록에 없다.
  "하위 에이전트 도구"는 메인이 맡긴 하위 에이전트가 부른 것이다.
- 경로는 자리표시로 바꿨다. <code>는 코드 폴더, <records>는 프로젝트 기록 폴더, <hstack>은 그 밖의 설정 폴더다.
- 턴마다 그 턴에 코드 폴더와 기록 폴더에 생긴 모든 변경(diff)을 붙였다. 셸로 쓴 변경도 들어 있다.

{bundle}

## 판정할 항목
{items}

## 판정 값
- 충족: 항목이 요구하는 대로 했다.
- 위반: 항목이 요구하는 것과 다르게 했다.
- 확인 불가: 이 기록만으로는 충족인지 위반인지 정할 수 없다.
- 상황 안 생김: 항목이 시험하려는 상황이 이 기록에서 생기지 않았다. 항목 문구에 이 값을 쓰라고 한 경우가 이에 해당한다.

항목마다 판정 값, 기록에서 그대로 옮긴 인용(글 한 부분. 바꾸거나 요약하지 않는다. 인용할 글이 없으면 빈 글), 이유를 적는다.
condition_guess에는, 기록을 보고 메인이 어떤 지침이나 규칙을 받고 일했는지 짐작되면 한두 문장으로 적는다. 짐작할 근거가 없으면 빈 글로 둔다.

## 답 형식
JSON 객체 하나만 답한다. 다른 글을 붙이지 않는다. 항목 id는 위 목록에 있는 것을 빠짐없이 한 번씩 쓴다.
{{"items": [{{"id": "...", "verdict": "충족|위반|확인 불가|상황 안 생김", "quote": "...", "reason": "..."}}], "condition_guess": "..."}}
'''


# 묶음 만들기

class Masker:
    """절대 경로를 자리표시로 바꾸고, 지침 파일이 드러나는 도구 입력은 가린다."""

    def __init__(self, meta):
        envs = {os.path.abspath(meta['env']), os.path.realpath(meta['env'])}
        self.pairs = []
        for e in sorted(envs, key=len, reverse=True):
            self.pairs += [(re.compile(re.escape(e) + r'/hstack/data/story-map/[^/\s\'"`]+'), '<records>'),
                           (re.compile(re.escape(e) + r'/work'), '<code>'),
                           (re.compile(re.escape(e) + r'/(?:hstack|plugin)'), '<hstack>'),
                           (re.compile(re.escape(e) + r'/tmp'), '<tmp>'),
                           (re.compile(re.escape(e)), '<env>')]
        cfg = meta.get('config_dir')
        if cfg:
            self.pairs.append((re.compile(re.escape(cfg)), '<설정>'))
        self.pairs.append((re.compile(r'claude-config\w*'), '<설정>'))

    def __call__(self, text):
        for rx, to in self.pairs:
            text = rx.sub(to, text)
        return text

    def tool_input(self, text):
        return re.sub(r'''[^\s'"`()=]*basics[^\s'"`()=]*''', '<지침 파일>', self(text), flags=re.I)


def tool_summary(name, inp):
    """도구 입력 요지: 도구마다 판정에 쓸 한 줄."""
    inp = inp if isinstance(inp, dict) else {}
    key = {'Bash': 'command', 'Read': 'file_path', 'Write': 'file_path', 'Edit': 'file_path',
           'NotebookEdit': 'notebook_path', 'Grep': 'pattern', 'Glob': 'pattern', 'WebFetch': 'url',
           'WebSearch': 'query', 'Skill': 'skill'}.get(name)
    if name in ('Agent', 'Task'):
        s = inp.get('description') or inp.get('prompt') or ''
    elif key and key in inp:
        s = str(inp[key])
        if name == 'Grep' and inp.get('path'):
            s += f' {inp["path"]}'
    else:
        s = json.dumps(inp, ensure_ascii=False)
    s = ' '.join(s.split())
    return s if len(s) <= 400 else s[:400] + '…'


def turn_log(events):
    """한 턴의 이벤트에서 메인이 보인 순서대로 [('글', text) | ('도구', name, 요지, 상태, 하위 에이전트?)]를 만든다."""
    status = {}
    for e in events:
        if e.get('type') == 'user' and isinstance((e.get('message') or {}).get('content'), list):
            for b in e['message']['content']:
                if isinstance(b, dict) and b.get('type') == 'tool_result':
                    status[b.get('tool_use_id')] = '실패' if b.get('is_error') else '성공'
    log = []
    for e in events:
        if e.get('type') != 'assistant':
            continue
        sub = bool(e.get('parent_tool_use_id'))
        for b in (e.get('message') or {}).get('content') or []:
            if not isinstance(b, dict):
                continue
            if b.get('type') == 'text' and b.get('text', '').strip() and not sub:
                log.append(('글', b['text'].strip()))
            elif b.get('type') == 'tool_use':
                log.append(('도구', b.get('name', '?'), tool_summary(b.get('name'), b.get('input')),
                            status.get(b.get('id'), '결과 없음'), sub))
    return log


def read_text(path):
    return common.read_text(path) if os.path.exists(path) else ''


def clip(diff):
    return diff if len(diff) <= DIFF_LIMIT else diff[:DIFF_LIMIT] + f'\n(이하 {len(diff) - DIFF_LIMIT}자 생략)\n'


def render_turn(case, run_dir, t, mask):
    """판정 묶음의 한 턴."""
    log = turn_log(common.read_events(os.path.join(run_dir, f'turn{t}.jsonl')))
    lines = [f'### 턴 {t}', '', '[사용자 입력]', case['turns'][t - 1], '', '[메인이 보인 것, 순서대로]']
    for entry in log:
        if entry[0] == '글':
            lines += ['글:', mask(entry[1])]
        else:
            who = '하위 에이전트 도구' if entry[4] else '도구'
            lines.append(f'{who}: {entry[1]} {entry[3]} — {mask.tool_input(entry[2])}')
    if not log:
        lines.append('(보인 것 없음)')
    for where, label in (('code', '코드'), ('records', '기록')):
        diff = read_text(os.path.join(run_dir, f'turn{t}-{where}.diff')).strip()
        lines += ['', f'[이 턴의 {label} 폴더 변경(diff)]', mask(clip(diff)) if diff else '(변경 없음)']
    return '\n'.join(lines), [e[1] for e in log if e[0] == '글']


def build_prompt(case, run_dir, meta, n_turns):
    mask = Masker(meta)
    bundle = '\n\n'.join(render_turn(case, run_dir, t, mask)[0] for t in range(1, n_turns + 1))
    items = '\n'.join(f'- id: {i["id"]}\n  턴: {i["turn"]}\n  내용: {i["text"]}' for i in case['rubric'] if i['kind'] == 'judge')
    return PROMPT.format(facts=case['facts'], bundle='## 대화\n\n' + bundle, items=items), bundle


# 판정자 호출

def judge_env():
    return env.child_environ()


def prepare_codex_home():
    """판정자가 hstack 전역 지침을 읽지 않도록 auth.json만 가진 별도 CODEX_HOME을 쓴다. 파일은 열지 않고 복사만 한다."""
    os.makedirs(CODEX_JUDGE_HOME, mode=0o700, exist_ok=True)
    src = os.path.expanduser('~/.codex/auth.json')
    if not os.path.exists(src):
        raise RuntimeError(f'Codex 로그인 파일이 없다: {src}')
    shutil.copy(src, os.path.join(CODEX_JUDGE_HOME, 'auth.json'))
    os.chmod(os.path.join(CODEX_JUDGE_HOME, 'auth.json'), 0o600)


def run_cmd(cmd, prompt, **kw):
    t0 = time.time()
    r = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=JUDGE_TIMEOUT, **kw)
    return r, round(time.time() - t0, 1)


def call_claude(prompt, effort):
    scratch = tempfile.mkdtemp(prefix='hstack-judge-')
    try:
        cmd = ['claude', '-p', '--safe-mode', '--tools', '', '--model', 'opus', '--effort', effort,
               '--output-format', 'json', '--json-schema', json.dumps(SCHEMA), '--no-session-persistence']
        r, secs = run_cmd(cmd, prompt, env=judge_env(), cwd=scratch)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    try:
        out = json.loads(r.stdout)
    except ValueError:
        return None, {'seconds': secs}, f'claude 출력이 JSON이 아니다 (종료 코드 {r.returncode}): {(r.stderr or r.stdout)[:300]}'
    info = {'seconds': secs, 'cost_usd': out.get('total_cost_usd'), 'model': ','.join((out.get('modelUsage') or {}).keys()),
            'usage': out.get('usage')}
    if r.returncode or out.get('is_error'):
        return None, info, f'claude 실패 (종료 코드 {r.returncode}): {str(out.get("result"))[:300]}'
    answer = out.get('structured_output')
    return (json.dumps(answer, ensure_ascii=False) if answer is not None else out.get('result')), info, None


def call_codex(prompt, effort):
    model = subprocess.run([os.path.join(REPO, 'scripts', 'codex-model.sh'), 'sol'], capture_output=True, text=True)
    if model.returncode:
        return None, {}, f'Sol 모델 이름을 찾지 못했다: {model.stderr.strip()}'
    model = model.stdout.strip()
    prepare_codex_home()
    scratch = tempfile.mkdtemp(prefix='hstack-judge-')
    try:
        schema = os.path.join(scratch, 'schema.json')
        common.write_json(schema, SCHEMA)
        cmd = ['codex', 'exec', '-m', model, '-c', f'model_reasoning_effort={effort}', '--sandbox', 'read-only',
               '--output-schema', schema, '--json', '--skip-git-repo-check', '--ephemeral', '-C', scratch, '-']
        r, secs = run_cmd(cmd, prompt, env={**os.environ, 'CODEX_HOME': CODEX_JUDGE_HOME}, cwd=scratch)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    info = {'seconds': secs, 'model': model}
    answer, error = None, None
    for line in r.stdout.split('\n'):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        item = e.get('item') or {}
        if e.get('type') == 'turn.completed':
            info['usage'] = e.get('usage')
        elif e.get('type') == 'turn.failed':
            error = f'Codex 턴 실패: {((e.get("error") or {}).get("message") or "")[:300]}'
        elif item.get('type') and item['type'] not in CODEX_PLAIN_ITEMS:
            error = f'판정자가 도구를 불렀다({item["type"]}). 그 답은 무효다'
        elif item.get('type') == 'agent_message' and e.get('type') == 'item.completed':
            answer = item.get('text')
    if error:
        return None, info, error
    if r.returncode or answer is None:
        return None, info, f'Codex 실패 (종료 코드 {r.returncode}): {(r.stderr or r.stdout)[-300:]}'
    return answer, info, None


def call_judge(name, prompt, effort):
    """판정자 한 번 호출. (답 글, 정보, 오류)를 돌려준다. 판정자 호출은 여기 한 곳이다."""
    try:
        fake = os.environ.get('HSTACK_EVAL_JUDGE_CMD')
        if fake:
            r, secs = run_cmd([*shlex.split(fake), name], prompt)
            return (r.stdout.strip(), {'seconds': secs}, None) if r.returncode == 0 else \
                (None, {'seconds': secs}, f'판정 명령 실패 (종료 코드 {r.returncode}): {r.stderr[:300]}')
        return (call_claude if name == 'opus' else call_codex)(prompt, effort)
    except (OSError, subprocess.TimeoutExpired, RuntimeError) as e:
        return None, {}, f'호출 실패: {e!r}'


def parse_answer(text, want_ids):
    """판정자 답을 검사해 (items, condition_guess)로 바꾼다. 형식이 틀리면 ValueError."""
    t = (text or '').strip()
    if not t.startswith('{'):
        m = re.search(r'\{.*\}', t, re.S)
        t = m.group(0) if m else t
    try:
        data = json.loads(t)
    except ValueError:
        raise ValueError('답이 JSON이 아니다')
    if not isinstance(data, dict) or not isinstance(data.get('items'), list):
        raise ValueError('items 목록이 없다')
    items, seen = [], set()
    for it in data['items']:
        if not isinstance(it, dict) or it.get('id') not in want_ids or it['id'] in seen:
            raise ValueError(f'알 수 없거나 겹친 항목 id: {it.get("id") if isinstance(it, dict) else it!r}')
        if it.get('verdict') not in VERDICTS:
            raise ValueError(f'판정 값이 넷 중 하나가 아니다: {it.get("verdict")!r}')
        seen.add(it['id'])
        items.append({'id': it['id'], 'verdict': it['verdict'], 'quote': str(it.get('quote') or ''),
                      'reason': str(it.get('reason') or '')})
    if seen != set(want_ids):
        raise ValueError(f'빠진 항목 id: {sorted(set(want_ids) - seen)}')
    return items, str(data.get('condition_guess') or '')


def instruction_hash(prompt):
    """판정자에게 주는 지시 전체의 해시: 프롬프트(지시문·사실·기록·항목)와 답 형식(스키마)."""
    blob = json.dumps({'prompt': prompt, 'schema': SCHEMA}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode('utf-8')).hexdigest()


def judge_run(name, effort, prompt, bundle, want_ids, run_dir):
    """한 판정자의 한 실행 판정. 같은 지시로 저장된 성공 결과가 있으면 다시 부르지 않는다. 지시가 다르면 다른 파일에 새로 낸다."""
    ihash = instruction_hash(prompt)
    path = os.path.join(run_dir, 'judge', f'{name}-{PLAN}-{effort}-{ihash[:12]}.json')
    if os.path.exists(path):
        saved = common.read_json(path)
        if saved.get('status') == 'ok' and saved.get('instruction_sha256') == ihash:
            return saved
    attempts = []
    result = {'judge': name, 'plan': PLAN, 'effort': effort, 'instruction_sha256': ihash, 'status': 'fail',
              'attempts': attempts}
    for _ in range(2):
        raw, info, error = call_judge(name, prompt, effort)
        attempt = {'raw': raw, 'info': info, 'error': error}
        attempts.append(attempt)
        if error is None:
            try:
                items, guess = parse_answer(raw, want_ids)
            except ValueError as e:
                attempt['error'] = f'형식이 맞지 않다: {e}'
                continue
            for it in items:
                it['quote_in_record'] = (not it['quote']) or it['quote'] in bundle
            result.update(status='ok', items=items, condition_guess=guess)
            break
    os.makedirs(os.path.dirname(path), exist_ok=True)
    common.write_json(path, result)
    return result


# 채점

def code_verdict(item, run_dir):
    """코드 항목: 그 턴의 그쪽 diff가 비어 있으면 충족, 아니면 위반."""
    path = os.path.join(run_dir, f'turn{item["turn"]}-{item["where"]}.diff')
    if not os.path.exists(path):
        return '확인 불가'
    return '충족' if not read_text(path).strip() else '위반'


def run_problems(meta, n_turns):
    """끊긴·실패한 턴, 모자란 턴을 글로. 없으면 빈 목록."""
    if meta is None:
        return ['meta.json이 없다']
    out = [meta['error']] if meta.get('error') else []
    turns = meta.get('turns', [])
    for t in turns:
        if t.get('cut'):
            out.append(f'턴 {t["turn"]} 시간 제한으로 끊김')
        elif t.get('exit_code'):
            out.append(f'턴 {t["turn"]} claude 종료 코드 {t["exit_code"]}')
    if len(turns) < n_turns and not out:
        out.append(f'턴 {len(turns)}/{n_turns}까지만 실행됨')
    return out


def classify(problems, code, judge_items, judges):
    """실행 결과 하나: 끊김 > 불통과(코드) > 판정 실패 > 갈림 > 불통과(판정) > 통과."""
    if problems:
        return '끊김'
    if any(v == '위반' for v in code.values()) or any(v == '확인 불가' for v in code.values()):
        return '불통과'
    if any(j['status'] != 'ok' for j in judges.values()):
        return '판정 실패'
    rows = {i['id']: [] for i in judge_items}
    for j in judges.values():
        for it in j['items']:
            rows[it['id']].append(it['verdict'])
    if any(len(set(v)) > 1 for v in rows.values()):
        return '갈림'
    if any(v[0] not in ('충족', '상황 안 생김') for v in rows.values() if v):
        return '불통과'
    return '통과'


def seconds_between(a, b):
    try:
        return (datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds()
    except (TypeError, ValueError):
        return 0.0


def fmt_dur(s):
    s = int(round(s))
    return f'{s // 60}분 {s % 60}초' if s >= 60 else f'{s}초'


def quote_block(text):
    return '\n'.join('> ' + l if l else '>' for l in (text or '(없음)').split('\n'))


def check_same_run(batch, cid, case, case_dir, entry):
    """배치에 실행 당시 사본이 있으면, 지금 케이스가 같은 실행을 가리키는지 본다. 다른 필드 이름 목록(없으면 빈 목록).
    사본이 없으면 검사하지 않는다."""
    snap = os.path.join(batch, cid, 'case.json')
    if not os.path.exists(snap):
        return []
    try:
        old = common.read_json(snap)
    except ValueError as e:
        raise BadInput(f'케이스 {cid}: 배치의 case.json 사본이 JSON이 아니다 ({e})')
    diff = [f for f in ('turns', 'fixture') if old.get(f) != case.get(f)]
    ov = common.sha256_tree(os.path.join(case_dir, 'overlay'))
    fx_dir = os.path.join(common.FIXTURES, case['fixture'])
    try:
        fx_commit = common.read_json(os.path.join(fx_dir, 'fixture.json'))['code']['commit']
    except (OSError, ValueError, KeyError, TypeError):
        fx_commit = None
    for field, key, now in (('overlay', 'overlay_sha256', ov),
                            ('fixture_records', 'fixture_records_sha256', common.sha256_tree(os.path.join(fx_dir, 'records'))),
                            ('fixture_commit', 'fixture_commit', fx_commit)):
        if key in entry and entry[key] != now:
            diff.append(field)
    return diff


def evaluate(batch, batch_json, judges, effort):
    """배치의 모든 실행을 채점해 구조로 돌려준다. 케이스는 지금 케이스 폴더의 것이다."""
    loaded = []
    for c in batch_json['cases']:
        cid = c['id']
        case_dir = os.path.join(common.cases_dir(), cid)
        if not os.path.isfile(os.path.join(case_dir, 'case.json')):
            raise BadInput(f'지금 케이스 폴더에 케이스가 없다: {case_dir}')
        case = common.load_case(case_dir)
        diff = check_same_run(batch, cid, case, case_dir, c)
        if diff:
            raise BadInput(f'케이스 {cid}: 실행 당시와 지금 케이스의 실행 내용이 다르다 ({", ".join(diff)}). '
                           '다른 실행을 돈 결과를 지금 루브릭으로 채점하지 않는다. 다시 실행하라')
        loaded.append((cid, case, case_dir))
    cases = []
    for cid, case, case_dir in loaded:
        judge_items = [i for i in case['rubric'] if i['kind'] == 'judge']
        runs = []
        if not os.path.isdir(os.path.join(batch, cid)):
            raise BadInput(f'배치에 케이스 폴더가 없다: {os.path.join(batch, cid)}')
        for d in sorted((d for d in os.listdir(os.path.join(batch, cid)) if re.fullmatch(r'r\d+', d)),
                        key=lambda d: int(d[1:])):
            run_dir = os.path.join(batch, cid, d)
            meta_path = os.path.join(run_dir, 'meta.json')
            meta = common.read_json(meta_path) if os.path.exists(meta_path) else None
            problems = run_problems(meta, len(case['turns']))
            code = {i['id']: code_verdict(i, run_dir) for i in case['rubric'] if i['kind'] == 'code'}
            results = {}
            if not problems and judge_items:
                prompt, bundle = build_prompt(case, run_dir, meta, len(case['turns']))
                for name in judges:
                    results[name] = judge_run(name, effort, prompt, bundle, [i['id'] for i in judge_items], run_dir)
            runs.append({'name': d, 'dir': run_dir, 'meta': meta, 'problems': problems, 'code': code, 'judges': results,
                         'outcome': classify(problems, code, judge_items, results)})
        cases.append({'id': cid, 'case': case, 'judge_items': judge_items, 'runs': runs,
                      'case_sha256': common.sha256_file(os.path.join(case_dir, 'case.json'))})
    return cases


# 보고

def report(batch, batch_json, cases, judges, effort):
    L = []
    w = L.append
    turns_all = [t for c in cases for r in c['runs'] for t in (r['meta'] or {}).get('turns', [])]
    actual = sorted({m for t in turns_all for m in str(t.get('model') or '').split(',') if m})
    w(f'# 평가 보고: {batch_json["name"]}')
    w('')
    w('## 배치 식별값')
    w('회귀 비교는 hstack 말고 아래 값이 같을 때만 뜻이 있다.')
    w('')
    w('| 항목 | 값 |')
    w('|---|---|')
    for k, v in (('hstack 커밋', batch_json.get('hstack_commit')), ('지침 사본(basics 인수)', f'{batch_json.get("basics")} → {batch_json.get("basics_commit", "")}'),
                 ('claude 버전', batch_json.get('claude_version')), ('요청 모델', batch_json.get('model')),
                 ('실제 모델', ', '.join(actual) or '(기록 없음)'), ('effort', batch_json.get('effort')),
                 ('슬롯', batch_json.get('slot')), ('실행 수', batch_json.get('runs')),
                 ('판정 지시 판 / 판정자 / effort', f'{PLAN} / {", ".join(judges)} / {effort}')):
        w(f'| {k} | {v} |')
    used = {c['id']: c['case_sha256'] for c in cases}
    for c in batch_json['cases']:
        ran, now = str(c.get('sha256', '')), used.get(c['id'], '')
        case_hash = f'판정에 쓴 케이스 {now[:12]}' + (f' (실행 당시 케이스 {ran[:12]})' if ran and ran != now else '')
        w(f'| 케이스 {c["id"]} | {case_hash}, overlay {str(c.get("overlay_sha256", ""))[:12]}, '
          f'픽스처 {c.get("fixture", "")} 기록 {str(c.get("fixture_records_sha256", ""))[:12]} 코드 {str(c.get("fixture_commit", ""))[:10]} |')
    w('')
    w('## 결과')
    w('')
    for c in cases:
        n = len(c['runs'])
        k = sum(r['outcome'] == '통과' for r in c['runs'])
        w(f'- **{c["id"]}**: {n}번 중 {k}번 통과')
    w('')
    w('통과는 코드 항목을 모두 충족하고, 두 판정자가 모든 판정 항목에서 같은 값을 냈고 그 값이 충족 또는 상황 안 생김일 때만 센다. '
      '같은 케이스의 반복은 독립이 아니다.')
    split, failed, cut, guesses = [], [], [], []
    for c in cases:
        w('')
        w(f'## 케이스 {c["id"]}')
        w('')
        w(f'규칙: {c["case"]["rule"]}')
        w('')
        w('| 실행 | 결과 | 시간 | 비용 |')
        w('|---|---|---|---|')
        for r in c['runs']:
            ts = (r['meta'] or {}).get('turns', [])
            dur = sum(seconds_between(t.get('started'), t.get('ended')) for t in ts)
            cost = sum(t.get('cost_usd') or 0 for t in ts)
            w(f'| {r["name"]} | {r["outcome"]} | {fmt_dur(dur)} | ${cost:.2f} |')
        for r in c['runs']:
            w('')
            w(f'### {r["name"]}: {r["outcome"]}')
            w('')
            if r['problems']:
                cut += [(c['id'], r['name'], p) for p in r['problems']]
                w('끊기거나 실패한 실행이라 판정하지 않았다: ' + '; '.join(r['problems']))
                continue
            w('| 항목 | 종류 | 판정 |')
            w('|---|---|---|')
            for iid, v in r['code'].items():
                w(f'| {iid} | 코드 | {v} |')
            by = {j['id']: {} for j in c['judge_items']}
            for name, res in r['judges'].items():
                if res['status'] != 'ok':
                    failed.append((c['id'], r['name'], name, res['attempts'][-1].get('error') if res['attempts'] else ''))
                    continue
                for it in res['items']:
                    by[it['id']][name] = it
                if res.get('condition_guess'):
                    guesses.append((c['id'], r['name'], name, res['condition_guess']))
            for j in c['judge_items']:
                cells = [by[j['id']][n]['verdict'] if n in by[j['id']] else '판정 실패' for n in r['judges']]
                w(f'| {j["id"]} | {" / ".join(r["judges"])} | {" / ".join(cells)} |')
                if len({by[j['id']][n]['verdict'] for n in by[j['id']]}) > 1:
                    split.append((c, r, j, by[j['id']]))
            bad = [(j['id'], n, by[j['id']][n]) for j in c['judge_items'] for n in by[j['id']]
                   if not by[j['id']][n].get('quote_in_record', True)]
            for iid, n, it in bad:
                w('')
                w(f'참고: {n}의 {iid} 인용이 기록에 그대로 있지 않다: {it["quote"]}')
    w('')
    w('## 갈린 판정')
    w('')
    if not split:
        w('없음.')
        w('')
    for c, r, j, by in split:
        t = j['turn']
        w(f'### {c["id"]} {r["name"]}: {j["id"]}')
        w('')
        w(f'항목: {j["text"]}')
        w('')
        w(f'턴 {t} 사용자 입력: {c["case"]["turns"][t - 1]}')
        w('')
        w(f'턴 {t} 메인 글:')
        mask = Masker(r['meta'])
        _, texts = render_turn(c['case'], r['dir'], t, mask)
        w(quote_block('\n\n'.join(mask(x) for x in texts)))
        w('')
        for name, it in by.items():
            w(f'- {name}: **{it["verdict"]}**. 인용: "{it["quote"]}". 이유: {it["reason"]}')
        w('')
    if failed or cut:
        w('## 판정 실패·끊김')
        w('')
        for cid, rn, name, err in failed:
            w(f'- 판정 실패: {cid} {rn} {name}: {err}')
        for cid, rn, p in cut:
            w(f'- 끊김: {cid} {rn}: {p}')
        w('')
    if guesses:
        w('## 조건 추측')
        w('')
        for cid, rn, name, g in guesses:
            w(f'- {cid} {rn} {name}: {g}')
        w('')
    w('## 비용·시간')
    w('')
    total = sum(t.get('cost_usd') or 0 for t in turns_all)
    unknown = sum(1 for t in turns_all if t.get('cost_usd') is None)
    w(f'- 시험 대상 비용 합계: ${total:.2f}' + (f' (비용을 알 수 없는 턴 {unknown}개 제외)' if unknown else ''))
    jinfo = [a['info'] for c in cases for r in c['runs'] for res in r['judges'].values() for a in res['attempts']]
    jcost = sum((i or {}).get('cost_usd') or 0 for i in jinfo)
    jsecs = sum((i or {}).get('seconds') or 0 for i in jinfo)
    w(f'- 판정자 호출 {len(jinfo)}번: 비용 ${jcost:.2f}(알려 주는 판정자만), 걸린 시간 합계 {fmt_dur(jsecs)}')
    w('')
    w('## 실행별 마지막 턴의 메인 글')
    for c in cases:
        for r in c['runs']:
            w('')
            w(f'### {c["id"]} {r["name"]}')
            w('')
            last = len(c['case']['turns'])
            if r['meta'] is None:
                w('(meta 없음)')
                continue
            mask = Masker(r['meta'])
            _, texts = render_turn(c['case'], r['dir'], last, mask)
            w(quote_block('\n\n'.join(texts)) if texts else '(글 없음)')
    return '\n'.join(L) + '\n'


def main():
    p = argparse.ArgumentParser(prog='judge.py')
    p.add_argument('batch')
    p.add_argument('--judges', default='opus,sol')
    p.add_argument('--effort', default='high')
    a = p.parse_args()
    batch = os.path.abspath(a.batch)
    try:
        if not os.path.isdir(batch):
            raise BadInput(f'배치 폴더가 없다: {batch}')
        bj = os.path.join(batch, 'batch.json')
        if not os.path.exists(bj):
            raise BadInput(f'batch.json이 없다: {bj}')
        batch_json = common.read_json(bj)
        judges = [j for j in a.judges.split(',') if j]
        if not judges or any(j not in ('opus', 'sol') for j in judges) or len(set(judges)) != len(judges):
            raise BadInput(f'--judges는 opus, sol 중 겹치지 않게 고른다: {a.judges}')
        cases = evaluate(batch, batch_json, judges, a.effort)
    except (BadInput, ValueError, KeyError) as e:
        print(f'{type(e).__name__ if not isinstance(e, BadInput) else "입력 오류"}: {e}', file=sys.stderr)
        return 1
    out = os.path.join(batch, '보고.md')
    common.write_text(out, report(batch, batch_json, cases, judges, a.effort))
    for c in cases:
        print(f'{c["id"]}: {len(c["runs"])}번 중 {sum(r["outcome"] == "통과" for r in c["runs"])}번 통과')
    print(f'보고: {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
