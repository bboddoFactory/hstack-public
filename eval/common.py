"""run.py와 judge.py가 함께 쓰는 것: 케이스 읽기·검사, 해시, stream-json 읽기.

둘이 따로 읽으면 케이스 형식과 이벤트 해석이 조용히 어긋나므로 한 곳에 둔다.
"""
import hashlib
import json
import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASES_DEFAULT = os.path.join(REPO, 'eval', 'cases')
FIXTURES = os.path.join(REPO, 'eval', 'fixtures')
CODE_CHECKS = ('unchanged',)
WHERES = ('code', 'records')
CONTINUE_MARK = '[이어가기]'


class BadInput(Exception):
    pass


def cases_dir():
    """케이스 폴더: 환경 변수 HSTACK_EVAL_CASES가 있으면 그것, 없으면 eval/cases. run과 judge가 같은 규칙을 쓴다."""
    return os.environ.get('HSTACK_EVAL_CASES') or CASES_DEFAULT


def read_text(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        return f.read()


def write_text(path, text):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def read_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def write_json(path, obj):
    write_text(path, json.dumps(obj, indent=2, ensure_ascii=False))


def sha256_file(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def sha256_tree(root):
    """폴더 안 파일의 상대 경로와 내용을 합친 해시. 폴더가 없으면 빈 해시."""
    h = hashlib.sha256()
    for dirpath, dirs, files in os.walk(root):
        dirs.sort()
        for f in sorted(files):
            p = os.path.join(dirpath, f)
            h.update(os.path.relpath(p, root).encode('utf-8') + b'\0')
            with open(p, 'rb') as f:
                h.update(f.read() + b'\0')
    return h.hexdigest()


def find_case_dir(arg):
    """케이스 인수(id 또는 폴더 경로)를 케이스 폴더로 바꾼다."""
    for d in (os.path.join(cases_dir(), arg), arg):
        if os.path.isfile(os.path.join(d, 'case.json')):
            return os.path.abspath(d)
    raise BadInput(f'케이스를 찾지 못했다: {arg} ({cases_dir()}/{arg}/case.json 도, 폴더 경로로도 없다)')


def load_case(case_dir):
    """case.json을 읽고 필수 필드를 검사한다. 잘못이면 케이스 이름과 빠진 필드 이름을 담아 BadInput."""
    name = os.path.basename(case_dir)
    try:
        case = read_json(os.path.join(case_dir, 'case.json'))
    except ValueError as e:
        raise BadInput(f'케이스 {name}: case.json이 JSON이 아니다 ({e})')
    if not isinstance(case, dict):
        raise BadInput(f'케이스 {name}: case.json이 객체가 아니다')
    for field, kind in (('id', str), ('rule', str), ('fixture', str), ('facts', str), ('turns', list), ('rubric', list)):
        if field not in case:
            raise BadInput(f'케이스 {name}: 필수 필드가 없다: {field}')
        if not isinstance(case[field], kind) or not case[field]:
            raise BadInput(f'케이스 {name}: 필드 {field}가 비었거나 형식이 틀리다')
    if not all(isinstance(t, str) and t for t in case['turns']):
        raise BadInput(f'케이스 {name}: turns는 비지 않은 글의 목록이어야 한다')
    seen = set()
    for item in case['rubric']:
        if not isinstance(item, dict):
            raise BadInput(f'케이스 {name}: rubric 항목이 객체가 아니다')
        iid = item.get('id')
        for field in ('id', 'turn', 'kind'):
            if field not in item:
                raise BadInput(f'케이스 {name}: rubric 항목({iid})에 필수 필드가 없다: {field}')
        if iid in seen:
            raise BadInput(f'케이스 {name}: rubric 항목 id가 겹친다: {iid}')
        seen.add(iid)
        if not isinstance(item['turn'], int) or not 1 <= item['turn'] <= len(case['turns']):
            raise BadInput(f'케이스 {name}: rubric 항목({iid})의 turn이 1~{len(case["turns"])} 범위가 아니다')
        if item['kind'] == 'code':
            if item.get('check') not in CODE_CHECKS:
                raise BadInput(f'케이스 {name}: rubric 항목({iid})의 check는 {CODE_CHECKS} 중 하나여야 한다')
            if item.get('where') not in WHERES:
                raise BadInput(f'케이스 {name}: rubric 항목({iid})의 where는 {WHERES} 중 하나여야 한다')
        elif item['kind'] == 'judge':
            if not item.get('text'):
                raise BadInput(f'케이스 {name}: rubric 항목({iid})에 필수 필드가 없다: text')
        else:
            raise BadInput(f'케이스 {name}: rubric 항목({iid})의 kind는 code 또는 judge여야 한다')
    return case


def read_events(path):
    """stream-json 줄을 읽는다. 끊겨서 깨진 줄은 건너뛴다."""
    events = []
    if not os.path.exists(path):
        return events
    for line in read_text(path).split('\n'):  # splitlines는 글 안의 U+2028 등에서도 끊어 JSON 줄을 깨뜨린다
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if isinstance(e, dict):
            events.append(e)
    return events


def summarize_turn(events):
    """한 턴 이벤트에서 실제 모델, 비용, 토큰, [이어가기] 주입 여부를 뽑는다."""
    models = []
    for e in events:
        if e.get('type') == 'assistant':
            m = (e.get('message') or {}).get('model')
            if m and m != '<synthetic>' and m not in models:
                models.append(m)
        elif e.get('type') == 'system' and e.get('subtype') == 'init' and e.get('model') and not models:
            models.append(e['model'])
    results = [e for e in events if e.get('type') == 'result']
    last = results[-1] if results else {}
    injected = any(e.get('type') == 'system' and str(e.get('subtype', '')).startswith('hook') and
                   CONTINUE_MARK in json.dumps(e, ensure_ascii=False) for e in events)
    return {'model': ','.join(models) or None, 'cost_usd': last.get('total_cost_usd'), 'usage': last.get('usage'),
            'continue_injected': injected}
