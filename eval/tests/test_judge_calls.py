"""실제 판정자 호출 경로(call_claude, call_codex)의 안쪽 테스트. 가짜 claude·codex 실행 파일을 PATH 앞에 둔다.

모델을 부르지 않는다. 확인하는 것: 부르는 명령 인수, 부모 세션 환경 변수 거르기, 분리된 CODEX_HOME,
Codex 이벤트에 도구 호출이 있으면 답이 무효, 로그인 파일 내용이 어디에도 새지 않는다.
실행: 저장소 루트에서 python3 -m unittest eval/tests/test_judge_calls.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_judge as T  # noqa: E402

FAKE_CLAUDE = textwrap.dedent('''\
    #!/usr/bin/env python3
    import json, os, sys
    log = os.environ['FAKE_LOG']
    n = len(os.listdir(log)) + 1
    with open(os.path.join(log, f'claude-{n}.json'), 'w') as f:
        json.dump({'argv': sys.argv[1:], 'env': {k: v for k, v in os.environ.items() if k.startswith('CLAUDE')},
                   'stdin_head': sys.stdin.read()[:40]}, f)
    answer = json.loads(os.environ['FAKE_ANSWER'])
    print(json.dumps({'type': 'result', 'is_error': False, 'result': '', 'structured_output': answer,
                      'total_cost_usd': 0.5, 'modelUsage': {'claude-opus-5-5': {}}}))
''')
FAKE_CODEX = textwrap.dedent('''\
    #!/usr/bin/env python3
    import json, os, sys
    log = os.environ['FAKE_LOG']
    n = len(os.listdir(log)) + 1
    with open(os.path.join(log, f'codex-{n}.json'), 'w') as f:
        json.dump({'argv': sys.argv[1:], 'codex_home': os.environ.get('CODEX_HOME'),
                   'stdin_head': sys.stdin.read()[:40]}, f)
    ev = [{'type': 'thread.started', 'thread_id': 't'}, {'type': 'turn.started'},
          {'type': 'item.completed', 'item': {'type': 'error', 'message': 'deprecated 안내'}}]
    if os.environ.get('FAKE_CODEX_MODE') == 'tool':
        ev.append({'type': 'item.started', 'item': {'type': 'command_execution', 'command': 'ls'}})
    ev += [{'type': 'item.completed', 'item': {'type': 'agent_message', 'text': os.environ['FAKE_ANSWER']}},
           {'type': 'turn.completed', 'usage': {'input_tokens': 1}}]
    print('\\n'.join(json.dumps(e) for e in ev))
''')


def write(path, text):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


class RealCallPaths(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='hstack-judgecall-test-')
        self.home = os.path.join(self.tmp, 'home')
        os.makedirs(os.path.join(self.home, '.codex'))
        write(os.path.join(self.home, '.codex', 'auth.json'), '{"FAKE-SECRET": 1}')
        write(os.path.join(self.home, '.codex', 'models_cache.json'),
              json.dumps({'models': [{'slug': 'gpt-6-sol'}, {'slug': 'gpt-6.2-sol'}]}))
        self.bin = os.path.join(self.tmp, 'bin')
        os.makedirs(self.bin)
        for name, body in (('claude', FAKE_CLAUDE), ('codex', FAKE_CODEX)):
            write(os.path.join(self.bin, name), body)
            os.chmod(os.path.join(self.bin, name), 0o755)
        self.log = os.path.join(self.tmp, 'log')
        os.makedirs(self.log)
        self.batch = T.Batch(self.tmp)
        self.batch.run(1, [T.turn1, T.turn2])

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def judge(self, **extra):
        env = {**os.environ, 'HOME': self.home, 'PATH': self.bin + os.pathsep + os.environ['PATH'],
               'FAKE_LOG': self.log, 'FAKE_ANSWER': T.ALL_OK, 'CLAUDECODE': '1', 'CLAUDE_CODE_SAFE_MODE': '1', **extra}
        env.pop('HSTACK_EVAL_JUDGE_CMD', None)
        return subprocess.run([sys.executable, T.JUDGE_PY, self.batch.dir], capture_output=True, text=True, env=env,
                              timeout=120)

    def calls(self, kind):
        return [json.loads(read(os.path.join(self.log, f))) for f in sorted(os.listdir(self.log)) if f.startswith(kind)]

    def report(self):
        return read(os.path.join(self.batch.dir, '보고.md'))

    def test_commands_env_and_isolated_codex_home(self):
        r = self.judge()
        self.assertEqual(r.returncode, 0, r.stderr)
        (c,) = self.calls('claude')
        for flag in ('--safe-mode', '--no-session-persistence', '--json-schema'):
            self.assertIn(flag, c['argv'])
        self.assertEqual(c['argv'][c['argv'].index('--tools') + 1], '')
        self.assertEqual(c['argv'][c['argv'].index('--model') + 1], 'opus')
        self.assertEqual(c['argv'][c['argv'].index('--effort') + 1], 'high')
        self.assertEqual(c['env'], {})  # 부모 Claude 세션 변수를 걸러 냈다
        (x,) = self.calls('codex')
        self.assertEqual(x['argv'][x['argv'].index('-m') + 1], 'gpt-6.2-sol')
        self.assertIn('model_reasoning_effort=high', x['argv'])
        self.assertEqual(x['argv'][x['argv'].index('--sandbox') + 1], 'read-only')
        self.assertIn('--output-schema', x['argv'])
        home = os.path.join(self.home, '.cache', 'hstack-eval', 'codex-judge')
        self.assertEqual(x['codex_home'], home)
        self.assertEqual(sorted(os.listdir(home)), ['auth.json'])
        self.assertIn('1번 중 1번 통과', self.report())
        self.assertNotIn('FAKE-SECRET', r.stdout + r.stderr + self.report())

    def test_codex_tool_call_invalidates_answer(self):
        r = self.judge(FAKE_CODEX_MODE='tool')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(self.calls('codex')), 2)  # 한 번 다시 부르고
        self.assertIn('판정 실패', self.report())  # 그래도 도구를 부르면 통과로 세지 않는다
        self.assertIn('1번 중 0번 통과', self.report())


if __name__ == '__main__':
    unittest.main()
