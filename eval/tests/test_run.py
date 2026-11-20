"""실행기(eval/run.py)의 행동 테스트.

RealClaude는 로그인된 슬롯 a와 Haiku로 실제 claude -p를 부른다(차례대로 돈다).
픽스처 코드는 ~/.cache/hstack-eval/code에 받아 둔 otterwiki를 쓴다(없으면 실행기가 받는다).
실행: 저장소 루트에서 python3 -m unittest eval/tests/test_run.py
"""
import glob
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RUN_PY = os.path.join(REPO, 'eval', 'run.py')
HAIKU = ['--model', 'haiku', '--effort', 'low']


def run_py(*args, env=None, timeout=900):
    return subprocess.run([sys.executable, RUN_PY, *args], capture_output=True, text=True,
                          env={**os.environ, **(env or {})}, timeout=timeout)


def make_case(root, turns, overlay=None, **extra):
    d = os.path.join(root, 'case-probe')
    os.makedirs(d)
    case = {'id': 'case-probe', 'rule': '시험용', 'fixture': 'otterwiki', 'facts': '시험용 케이스',
            'turns': turns, 'rubric': [{'id': 'x', 'turn': 1, 'kind': 'code', 'check': 'unchanged', 'where': 'code'}]}
    case.update(extra)
    for k in [k for k, v in case.items() if v is None]:
        del case[k]
    json.dump(case, open(os.path.join(d, 'case.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    for rel, text in (overlay or {}).items():
        p = os.path.join(d, 'overlay', rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, 'w', encoding='utf-8').write(text)
    return d


def text_of(jsonl):
    out = []
    for line in open(jsonl, encoding='utf-8'):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get('type') == 'assistant':
            out += [c.get('text', '') for c in e['message']['content'] if c.get('type') == 'text']
    return '\n'.join(out)


class RealClaude(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='hstack-run-test-')
        self.out = os.path.join(self.tmp, 'runs')

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def batch_dir(self):
        dirs = glob.glob(os.path.join(self.out, '*'))
        self.assertEqual(len(dirs), 1, dirs)
        return dirs[0]

    def test_turns_continue_one_session_and_diffs_are_per_turn(self):
        case = make_case(self.tmp, [
            'Use the Write tool to create the file probe.txt in the current directory with the single word PELICAN. '
            'Then reply DONE.',
            'Without using any tool, tell me the single word you wrote into probe.txt. Reply with just that word.'])
        r = run_py(case, '--runs', '2', *HAIKU, '--out', self.out)
        self.assertEqual(r.returncode, 0, r.stderr)
        b = self.batch_dir()
        for n in (1, 2):
            d = os.path.join(b, 'case-probe', f'r{n}')
            # 1턴에 만든 파일은 1턴 diff에만, 2턴 diff는 비어 있다
            t1 = open(os.path.join(d, 'turn1-code.diff'), encoding='utf-8').read()
            self.assertIn('probe.txt', t1)
            self.assertIn('PELICAN', t1)
            self.assertEqual(open(os.path.join(d, 'turn2-code.diff'), encoding='utf-8').read().strip(), '')
            self.assertTrue(os.path.exists(os.path.join(d, 'turn1-records.diff')))
            # 2턴은 1턴과 같은 세션이라 1턴에 한 일을 기억한다
            self.assertIn('PELICAN', text_of(os.path.join(d, 'turn2.jsonl')).upper())
            meta = json.load(open(os.path.join(d, 'meta.json'), encoding='utf-8'))
            self.assertEqual([t['turn'] for t in meta['turns']], [1, 2])
            for t in meta['turns']:
                self.assertEqual(t['exit_code'], 0)
                self.assertFalse(t['cut'])
                self.assertIn('haiku', t['model'])  # 실제로 돈 모델
                self.assertGreater(t['cost_usd'], 0)
        # 회귀 비교에 쓰는 배치 식별값
        batch = json.load(open(os.path.join(b, 'batch.json'), encoding='utf-8'))
        head = subprocess.run(['git', '-C', REPO, 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
        self.assertTrue(head.startswith(batch['hstack_commit']) or batch['hstack_commit'].startswith(head[:7]))
        self.assertEqual(batch['model'], 'haiku')
        self.assertEqual(batch['effort'], 'low')
        self.assertEqual(batch['runs'], 2)
        self.assertTrue(batch['claude_version'])
        sha = hashlib.sha256(open(os.path.join(case, 'case.json'), 'rb').read()).hexdigest()
        self.assertEqual(batch['cases'][0]['sha256'], sha)

    def test_initial_state_is_fixture_plus_overlay_and_real_repo_untouched(self):
        case = make_case(self.tmp, ['Reply with exactly: OK'],
                         overlay={'records/tasks/시험/작업.md': '# 시험 작업\nOVERLAY-MARK\n'})
        r = run_py(case, '--runs', '1', *HAIKU, '--out', self.out, '--keep-env')
        self.assertEqual(r.returncode, 0, r.stderr)
        meta = json.load(open(os.path.join(self.batch_dir(), 'case-probe', 'r1', 'meta.json'), encoding='utf-8'))
        env = meta['env']
        try:
            # 코드: otterwiki v2.27.0
            self.assertIn('version_info = (2, 27, 0,', open(os.path.join(env, 'work', 'otterwiki', 'version.py')).read())
            # 기록: 픽스처 기록 + 케이스 overlay
            rec = os.path.join(env, 'hstack', 'data', 'story-map', 'otterwiki')
            self.assertTrue(os.path.exists(os.path.join(rec, 'product.md')))
            self.assertIn('OVERLAY-MARK', open(os.path.join(rec, 'tasks', '시험', '작업.md'), encoding='utf-8').read())
            # 실제 저장소 기록에는 아무것도 생기지 않는다
            self.assertFalse(os.path.exists(os.path.join(REPO, 'data', 'story-map', 'otterwiki')))
        finally:
            shutil.rmtree(env, ignore_errors=True)

    def test_turn_timeout_marks_run_cut(self):
        case = make_case(self.tmp, ['Count slowly from 1 to 400, one number per line, then reply DONE.'])
        r = run_py(case, '--runs', '1', *HAIKU, '--out', self.out, '--turn-timeout', '3')
        self.assertNotEqual(r.returncode, 0)  # 끊긴 실행이 있으면 실패로 끝나고 알린다
        meta = json.load(open(os.path.join(self.batch_dir(), 'case-probe', 'r1', 'meta.json'), encoding='utf-8'))
        self.assertTrue(meta['turns'][0]['cut'])


class WithoutModel(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='hstack-run-test-')
        self.out = os.path.join(self.tmp, 'runs')

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_unknown_case_is_refused(self):
        r = run_py('없는-케이스', '--runs', '1', *HAIKU, '--out', self.out)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('없는-케이스', r.stderr)
        self.assertFalse(os.path.exists(self.out))

    def test_case_without_turns_is_refused_before_anything_runs(self):
        case = make_case(self.tmp, None)
        r = run_py(case, '--runs', '1', *HAIKU, '--out', self.out)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('turns', r.stderr)
        self.assertFalse(os.path.exists(self.out))

    def test_model_is_required(self):
        case = make_case(self.tmp, ['hi'])
        r = run_py(case, '--runs', '1', '--out', self.out)
        self.assertNotEqual(r.returncode, 0)  # 기본값(실제 설정의 모델)에 맡기지 않는다

    def test_not_logged_in_slot_records_failed_turn(self):
        base = os.path.join(self.tmp, 'base')
        os.makedirs(os.path.join(base, 'claude-config'))
        os.makedirs(os.path.join(base, 'claude-config-b'))
        case = make_case(self.tmp, ['hi', 'ㄱㄱ'])
        r = run_py(case, '--runs', '1', *HAIKU, '--out', self.out, env={'HSTACK_EVAL_BASE': base}, timeout=300)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('/login', r.stderr)
        d = glob.glob(os.path.join(self.out, '*', 'case-probe', 'r1'))[0]
        meta = json.load(open(os.path.join(d, 'meta.json'), encoding='utf-8'))
        self.assertNotEqual(meta['turns'][0]['exit_code'], 0)


if __name__ == '__main__':
    unittest.main()
