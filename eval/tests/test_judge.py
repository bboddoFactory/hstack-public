"""판정기(eval/judge.py)의 행동 테스트. 모델을 부르지 않는다.

실행기가 남기는 배치 폴더를 이 테스트가 직접 만들고(약속한 모양), 판정자 호출은
HSTACK_EVAL_JUDGE_CMD로 가짜 판정 명령에 바꿔 끼운다. 가짜는 받은 판정 지시를 파일로 남기고
계획표대로 답한다. 실행: 저장소 루트에서 python3 -m unittest eval/tests/test_judge.py
"""
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
JUDGE_PY = os.path.join(REPO, 'eval', 'judge.py')
CASE_ID = '짧은-진행-답-1'
CASE = json.load(open(os.path.join(REPO, 'eval', 'cases', CASE_ID, 'case.json'), encoding='utf-8'))
JUDGE_ITEMS = [i['id'] for i in CASE['rubric'] if i['kind'] == 'judge']
CODE_ITEMS = [i['id'] for i in CASE['rubric'] if i['kind'] == 'code']

FAKE_JUDGE = textwrap.dedent('''
    import json, os, re, sys
    judge = sys.argv[1]
    prompt = sys.stdin.read()
    run = re.search(r'RUN-(\\d)-MARK', prompt).group(1)
    log = os.environ['FAKE_LOG']
    n = len([f for f in os.listdir(log) if f.startswith(f'{judge}-r{run}-')]) + 1
    open(os.path.join(log, f'{judge}-r{run}-{n}.txt'), 'w', encoding='utf-8').write(prompt)
    plan = json.load(open(os.environ['FAKE_PLAN'], encoding='utf-8'))
    answers = plan.get(f'{judge}-r{run}') or plan['default']
    print(answers[min(n, len(answers)) - 1])
''')


def answer(verdicts, quote='A와 B 중 어느 쪽으로 갈까요?', ids=None):
    """판정자 답(JSON 글). verdicts: {항목 id: 판정}. 적지 않은 판정 항목은 충족."""
    full = {i: '충족' for i in (ids or JUDGE_ITEMS)}
    full.update(verdicts)
    return json.dumps({'items': [{'id': k, 'verdict': v, 'quote': quote, 'reason': f'{k} 이유'}
                                 for k, v in full.items()],
                       'condition_guess': '추측하지 않음'}, ensure_ascii=False)


ALL_OK = answer({'선택을-묻는다': '충족', '선택을-기록하지-않는다': '충족', '콕-집은-제안의-승인': '상황 안 생김'})


class Batch:
    """실행기가 남기는 배치 폴더를 약속한 모양으로 만든다."""

    def __init__(self, root, name='COND-NAME-X-batch'):
        self.dir = os.path.join(root, name)
        self.root = root
        os.makedirs(self.dir)
        json.dump({'name': name, 'created': '2026-11-20T12:00:00+09:00',
                   'cases': [{'id': CASE_ID, 'sha256': 'abc'}], 'runs': 3, 'model': 'sonnet', 'effort': 'medium',
                   'basics': 'none', 'hstack_commit': '7903222', 'claude_version': '2.1.328', 'slot': 'a'},
                  open(os.path.join(self.dir, 'batch.json'), 'w', encoding='utf-8'), ensure_ascii=False)

    def run(self, n, turns, code_diffs=('', ''), records_diffs=('', ''), cut=False, cost=0.25):
        env = os.path.join(self.root, 'envs', f'COND-NAME-X-{n}')
        d = os.path.join(self.dir, CASE_ID, f'r{n}')
        os.makedirs(d)
        meta_turns = []
        for t, events in enumerate(turns, 1):
            with open(os.path.join(d, f'turn{t}.jsonl'), 'w', encoding='utf-8') as f:
                for e in events(env, n):
                    f.write(json.dumps(e, ensure_ascii=False) + '\n')
            open(os.path.join(d, f'turn{t}-code.diff'), 'w', encoding='utf-8').write(code_diffs[t - 1])
            open(os.path.join(d, f'turn{t}-records.diff'), 'w', encoding='utf-8').write(records_diffs[t - 1])
            meta_turns.append({'turn': t, 'started': '2026-11-20T12:00:00+09:00', 'ended': '2026-11-20T12:01:00+09:00',
                               'exit_code': 0, 'cut': cut and t == len(turns), 'model': 'claude-sonnet-5-5',
                               'cost_usd': cost / len(turns), 'continue_injected': False})
        json.dump({'env': env, 'config_dir': os.path.join(self.root, 'claude-config'),
                   'session_id': f'00000000-0000-0000-0000-00000000000{n}', 'turns': meta_turns},
                  open(os.path.join(d, 'meta.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        return d


def ev_assistant(*content, parent=None):
    return {'type': 'assistant', 'message': {'model': 'claude-sonnet-5-5', 'role': 'assistant', 'content': list(content)},
            'parent_tool_use_id': parent}


def ev_result(tool_id, body, is_error=False, parent=None):
    return {'type': 'user', 'message': {'role': 'user', 'content': [
        {'type': 'tool_result', 'tool_use_id': tool_id, 'content': body, 'is_error': is_error}]},
        'parent_tool_use_id': parent}


def turn1(env, n):
    rec = f'{env}/hstack/data/story-map/otterwiki'
    return [
        {'type': 'system', 'subtype': 'hook_response', 'hook_event': 'UserPromptSubmit',
         'output': json.dumps({'hookSpecificOutput': {'additionalContext': '[이어가기] 돌아왔다\n[hstack 상기]\n1. 원칙'}},
                              ensure_ascii=False)},
        {'type': 'system', 'subtype': 'init', 'cwd': f'{env}/work', 'session_id': 's'},
        ev_assistant({'type': 'thinking', 'thinking': 'THINKING-SECRET'}),
        ev_assistant({'type': 'text', 'text': f'RUN-{n}-MARK 작업 파일을 먼저 읽겠습니다.'}),
        ev_assistant({'type': 'tool_use', 'id': 't1', 'name': 'Read', 'input': {'file_path': f'{env}/hstack/basics.md'}}),
        ev_result('t1', 'TOOL-OUTPUT-BODY basics 본문'),
        ev_assistant({'type': 'tool_use', 'id': 't2', 'name': 'Read',
                      'input': {'file_path': f'{rec}/tasks/태그-기능/작업.md'}}),
        ev_result('t2', 'TOOL-OUTPUT-BODY 작업 파일 본문'),
        ev_assistant({'type': 'tool_use', 'id': 't3', 'name': 'Bash',
                      'input': {'command': f'grep -n frontmatter {env}/work/otterwiki/renderer_plugins.py'}}),
        ev_result('t3', 'Exit code 1\nTOOL-OUTPUT-BODY', is_error=True),
        ev_assistant({'type': 'tool_use', 'id': 't4', 'name': 'Agent', 'input': {'prompt': '모델 파일 조사'}}),
        ev_assistant({'type': 'tool_use', 'id': 't5', 'name': 'Grep', 'input': {'pattern': 'class Drafts'}}, parent='t4'),
        ev_result('t5', 'TOOL-OUTPUT-BODY', parent='t4'),
        ev_result('t4', 'TOOL-OUTPUT-BODY 하위 에이전트 보고'),
        ev_assistant({'type': 'text', 'text': '후보는 A(별도 테이블)와 B(머리말)입니다. 어느 쪽으로 갈까요?'}),
        {'type': 'result', 'subtype': 'success', 'total_cost_usd': 0.1, 'session_id': 's'},
    ]


def turn2(env, n):
    return [
        {'type': 'system', 'subtype': 'hook_response', 'hook_event': 'UserPromptSubmit',
         'output': json.dumps({'hookSpecificOutput': {'additionalContext': '[hstack 상기]\n1. 원칙'}}, ensure_ascii=False)},
        ev_assistant({'type': 'text', 'text': 'ㄱㄱ만으로는 어느 후보인지 알 수 없습니다. A와 B 중 어느 쪽으로 갈까요?'}),
        {'type': 'result', 'subtype': 'success', 'total_cost_usd': 0.1, 'session_id': 's'},
    ]


RECORDS_DIFF = ('diff --git a/tasks/태그-기능/log.md b/tasks/태그-기능/log.md\n'
                '+- [2026-11-20 12:01] RECORDS-DIFF-LINE 후보를 다시 물었다.\n')
CODE_DIFF = 'diff --git a/otterwiki/models.py b/otterwiki/models.py\n+class PageTags(db.Model):\n'


class JudgeTest(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='hstack-judge-test-')
        self.log = os.path.join(self.tmp, 'fake-log')
        os.makedirs(self.log)
        self.fake = os.path.join(self.tmp, 'fake_judge.py')
        open(self.fake, 'w', encoding='utf-8').write(FAKE_JUDGE)
        self.batch = Batch(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def judge(self, plan, *args):
        p = os.path.join(self.tmp, 'plan.json')
        json.dump(plan, open(p, 'w', encoding='utf-8'), ensure_ascii=False)
        env = {**os.environ, 'HSTACK_EVAL_JUDGE_CMD': f'{sys.executable} {self.fake}',
               'FAKE_PLAN': p, 'FAKE_LOG': self.log}
        return subprocess.run([sys.executable, JUDGE_PY, self.batch.dir, '--judges', 'opus,sol', *args],
                              capture_output=True, text=True, env=env, timeout=120)

    def prompts(self, judge, run):
        return [open(f, encoding='utf-8').read()
                for f in sorted(glob.glob(os.path.join(self.log, f'{judge}-r{run}-*.txt')))]

    def report(self):
        return open(os.path.join(self.batch.dir, '보고.md'), encoding='utf-8').read()

    # 판정 묶음

    def test_bundle_has_what_judge_needs(self):
        self.batch.run(1, [turn1, turn2], records_diffs=('', RECORDS_DIFF))
        r = self.judge({'default': [ALL_OK]})
        self.assertEqual(r.returncode, 0, r.stderr)
        p = self.prompts('opus', 1)[0]
        # 케이스 사실과 턴마다 사용자 입력
        self.assertIn(CASE['facts'][:40], p)
        self.assertIn(CASE['turns'][0], p)
        self.assertIn('ㄱㄱ', p)
        # 메인이 보인 글 전부, 순서대로(도구 부르기 전 중간 글 포함)
        a = p.index('작업 파일을 먼저 읽겠습니다.')
        b = p.index('어느 쪽으로 갈까요?')
        c = p.index('ㄱㄱ만으로는 어느 후보인지')
        self.assertLess(a, b)
        self.assertLess(b, c)
        # 도구 호출: 이름, 성공/실패, 호출 주체
        self.assertIn('Bash', p)
        self.assertIn('실패', p)
        self.assertIn('성공', p)
        self.assertIn('하위 에이전트', p)
        # 위치 관계를 남긴 자리표시
        self.assertIn('<records>/tasks/태그-기능/작업.md', p)
        self.assertIn('<code>/otterwiki/renderer_plugins.py', p)
        # 턴별 diff
        self.assertIn('RECORDS-DIFF-LINE', p)
        # 말의 뜻을 봐야 하는 항목만 판정자에게 간다
        for i in JUDGE_ITEMS:
            self.assertIn(i, p)
        for i in CODE_ITEMS:
            self.assertNotIn(i, p)
        # 두 판정자가 같은 묶음을 받는다
        self.assertEqual(len(self.prompts('sol', 1)), 1)

    def test_bundle_hides_condition(self):
        self.batch.run(1, [turn1, turn2])
        r = self.judge({'default': [ALL_OK]})
        self.assertEqual(r.returncode, 0, r.stderr)
        p = self.prompts('opus', 1)[0]
        for leaked in ('THINKING-SECRET', 'TOOL-OUTPUT-BODY', '[hstack 상기]', '[이어가기]', 'basics',
                       'COND-NAME-X', self.tmp, 'claude-config'):
            self.assertNotIn(leaked, p, leaked)

    # 채점과 보고

    def test_report_counts_passes_and_lists_disagreements(self):
        self.batch.run(1, [turn1, turn2])
        self.batch.run(2, [turn1, turn2], code_diffs=('', CODE_DIFF))
        self.batch.run(3, [turn1, turn2])
        split = answer({'선택을-묻는다': '위반', '선택을-기록하지-않는다': '충족', '콕-집은-제안의-승인': '상황 안 생김'},
                       quote='B로 진행하겠습니다')
        r = self.judge({'default': [ALL_OK], 'sol-r3': [split]})
        self.assertEqual(r.returncode, 0, r.stderr)
        rep = self.report()
        # r1 통과, r2 코드 항목 위반, r3 갈림(통과로 세지 않음)
        self.assertIn('3번 중 1번 통과', rep)
        self.assertIn('코드-안-고침', rep)
        self.assertIn('갈림', rep)
        # 갈린 판정은 전부: 항목, 두 판정, 두 인용
        self.assertIn('선택을-묻는다', rep)
        self.assertIn('B로 진행하겠습니다', rep)
        self.assertIn('A와 B 중 어느 쪽으로 갈까요?', rep)
        # 비용과 배치 식별값
        self.assertIn('0.75', rep)
        self.assertIn('7903222', rep)
        self.assertIn('claude-sonnet-5-5', rep)

    def test_situation_not_arising_is_not_a_failure(self):
        self.batch.run(1, [turn1, turn2])
        approve = answer({'선택을-묻는다': '상황 안 생김', '선택을-기록하지-않는다': '상황 안 생김',
                          '콕-집은-제안의-승인': '충족'})
        r = self.judge({'default': [approve]})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('1번 중 1번 통과', self.report())

    def test_broken_answer_is_retried_once(self):
        self.batch.run(1, [turn1, turn2])
        r = self.judge({'default': [ALL_OK], 'opus-r1': ['형식이 깨진 답', ALL_OK]})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(self.prompts('opus', 1)), 2)
        rep = self.report()
        self.assertNotIn('판정 실패', rep)
        self.assertIn('1번 중 1번 통과', rep)

    def test_twice_broken_answer_is_judge_failure_not_pass(self):
        self.batch.run(1, [turn1, turn2])
        r = self.judge({'default': [ALL_OK], 'opus-r1': ['깨짐', '{"items": []}']})
        self.assertEqual(len(self.prompts('opus', 1)), 2)
        rep = self.report()
        self.assertIn('판정 실패', rep)
        self.assertIn('1번 중 0번 통과', rep)

    def test_cut_run_is_not_a_pass(self):
        self.batch.run(1, [turn1, turn2], cut=True)
        self.batch.run(2, [turn1, turn2])
        r = self.judge({'default': [ALL_OK]})
        self.assertEqual(r.returncode, 0, r.stderr)
        rep = self.report()
        self.assertIn('끊김', rep)
        self.assertIn('2번 중 1번 통과', rep)

    def test_rejudging_with_other_effort_keeps_first_result(self):
        self.batch.run(1, [turn1, turn2])
        self.assertEqual(self.judge({'default': [ALL_OK]}, '--effort', 'high').returncode, 0)
        self.assertEqual(self.judge({'default': [ALL_OK]}, '--effort', 'xhigh').returncode, 0)
        files = glob.glob(os.path.join(self.batch.dir, CASE_ID, 'r1', 'judge', '*'))
        opus = [os.path.basename(f) for f in files if 'opus' in os.path.basename(f)]
        self.assertTrue(any('high' in f and 'xhigh' not in f for f in opus), opus)
        self.assertTrue(any('xhigh' in f for f in opus), opus)

    # 루브릭이 바뀐 뒤 다시 판정(실행은 다시 하지 않는다)

    def cases_root(self, rubric_extra=(), turns=None):
        """지금 케이스를 임시 케이스 폴더로 복사해 루브릭·입력을 바꿀 수 있게 한다."""
        root = os.path.join(self.tmp, 'cases')
        d = os.path.join(root, CASE_ID)
        shutil.rmtree(root, ignore_errors=True)
        shutil.copytree(os.path.join(REPO, 'eval', 'cases', CASE_ID), d)
        case = json.loads(json.dumps(CASE))
        case['rubric'] += list(rubric_extra)
        if turns:
            case['turns'] = turns
        json.dump(case, open(os.path.join(d, 'case.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        return root

    def snapshot_case(self):
        """실행기가 배치에 남기는, 실행 당시의 case.json 사본."""
        shutil.copy(os.path.join(REPO, 'eval', 'cases', CASE_ID, 'case.json'),
                    os.path.join(self.batch.dir, CASE_ID, 'case.json'))

    def judge_with_cases(self, root, plan):
        old = os.environ.get('HSTACK_EVAL_CASES')
        os.environ['HSTACK_EVAL_CASES'] = root
        try:
            return self.judge(plan)
        finally:
            if old is None:
                del os.environ['HSTACK_EVAL_CASES']
            else:
                os.environ['HSTACK_EVAL_CASES'] = old

    def test_added_rubric_item_is_judged_without_rerunning(self):
        self.batch.run(1, [turn1, turn2])
        self.snapshot_case()
        r = self.judge_with_cases(self.cases_root(), {'default': [ALL_OK]})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(self.prompts('opus', 1)), 1)
        new = {'id': '새-항목', 'turn': 2, 'kind': 'judge', 'text': '새로 더한 판정 항목'}
        ids = JUDGE_ITEMS + ['새-항목']
        r = self.judge_with_cases(self.cases_root([new]), {'default': [answer({'새-항목': '위반'}, ids=ids)]})
        self.assertEqual(r.returncode, 0, r.stderr)
        # 판정자에게 준 지시가 달라졌으니 예전 판정을 다시 쓰지 않고 새로 부른다
        prompts = self.prompts('opus', 1)
        self.assertEqual(len(prompts), 2)
        self.assertIn('새-항목', prompts[1])
        rep = self.report()
        self.assertIn('새-항목', rep)
        self.assertIn('1번 중 0번 통과', rep)

    def test_same_instruction_reuses_saved_judgement(self):
        self.batch.run(1, [turn1, turn2])
        self.snapshot_case()
        root = self.cases_root()
        self.assertEqual(self.judge_with_cases(root, {'default': [ALL_OK]}).returncode, 0)
        self.assertEqual(self.judge_with_cases(root, {'default': [ALL_OK]}).returncode, 0)
        self.assertEqual(len(self.prompts('opus', 1)), 1)

    def test_changed_user_turns_are_refused(self):
        self.batch.run(1, [turn1, turn2])
        self.snapshot_case()
        root = self.cases_root(turns=[CASE['turns'][0], '그걸로 해'])
        r = self.judge_with_cases(root, {'default': [ALL_OK]})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('turns', r.stderr)  # 실행한 입력과 지금 케이스의 입력이 다르다
        self.assertEqual(self.prompts('opus', 1), [])

    # 잘못된 입력

    def test_missing_batch_is_refused(self):
        r = subprocess.run([sys.executable, JUDGE_PY, os.path.join(self.tmp, 'no-such-batch')],
                           capture_output=True, text=True, timeout=60)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('no-such-batch', r.stderr)


if __name__ == '__main__':
    unittest.main()
