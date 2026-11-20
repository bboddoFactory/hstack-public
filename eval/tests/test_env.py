"""격리 환경(eval/env.py)의 행동 테스트.

사용자와 정한 기반 레이어 시나리오를 entry point(명령)로 확인한다.
실제 Claude를 부르는 테스트는 로그인된 평가용 설정 폴더(~/.cache/hstack-eval/claude-config)와
Haiku를 쓴다. 실행: 저장소 루트에서 python3 -m unittest eval/tests/test_env.py
"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import uuid

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENV_PY = os.path.join(REPO, 'eval', 'env.py')
REAL_BASE = os.path.expanduser('~/.cache/hstack-eval')
HAIKU = ['--model', 'haiku']


def env_py(*args, base=None, timeout=300):
    env = dict(os.environ)
    if base:
        env['HSTACK_EVAL_BASE'] = base
    return subprocess.run(['python3', ENV_PY, *args], capture_output=True, text=True, env=env, timeout=timeout)


def env_dir(name, base=REAL_BASE):
    return os.path.join(base, 'envs', name)


def stream(name, prompt, *extra):
    """환경 안에서 claude -p 한 턴을 돌리고 stream-json 줄 목록을 돌려준다."""
    r = env_py('claude', name, '--', '-p', prompt, *HAIKU, '--output-format', 'stream-json', '--verbose', *extra)
    return r, [json.loads(l) for l in r.stdout.splitlines() if l.startswith('{')]


def loaded_files(name):
    p = os.path.join(env_dir(name), 'instructions-loaded.jsonl')
    if not os.path.exists(p):
        return []
    return [json.loads(l)['file_path'] for l in open(p, encoding='utf-8') if l.strip()]


class RealClaude(unittest.TestCase):
    """실제 Claude(Haiku)를 부르는 시나리오. 같은 설정 폴더(슬롯 a)를 쓰므로 차례대로 돈다."""

    def setUp(self):
        self.name = 'test-' + uuid.uuid4().hex[:8]

    def tearDown(self):
        shutil.rmtree(env_dir(self.name), ignore_errors=True)

    def test_happy_path_loads_env_basics_hook_and_skills(self):
        r = env_py('create', self.name, '--slot', 'a')
        self.assertEqual(r.returncode, 0, r.stderr)
        r, events = stream(self.name, 'Reply with exactly: OK')
        self.assertEqual(r.returncode, 0, r.stderr)
        # 이 환경의 basics가 실리고, 실제 hstack의 basics는 실리지 않는다
        files = loaded_files(self.name)
        self.assertIn(os.path.join(env_dir(self.name), 'hstack', 'basics.md'), files)
        self.assertNotIn(os.path.join(REPO, 'basics.md'), files)
        self.assertFalse(any(f.startswith(REPO + os.sep) for f in files), files)
        # hstack 상기 훅이 붙는다
        self.assertIn('[hstack 상기]', r.stdout)
        # hstack 스킬이 보인다
        init = next(e for e in events if e.get('type') == 'system' and e.get('subtype') == 'init')
        self.assertIn('hstack:hippo-mode', json.dumps(init, ensure_ascii=False))

    def test_writes_stay_inside_env(self):
        r = env_py('create', self.name, '--slot', 'a')
        self.assertEqual(r.returncode, 0, r.stderr)
        probe = 'eval-probe-' + uuid.uuid4().hex[:8]
        inside = os.path.join(env_dir(self.name), 'hstack', 'data', 'story-map', probe, 'note.md')
        real = os.path.join(REPO, 'data', 'story-map', probe, 'note.md')
        try:
            stream(self.name, f'Use the Write tool to create the file {inside} with the text: inside. '
                              f'Then use the Write tool to create the file {real} with the text: real. '
                              'If a write is refused, do not retry another way. Reply DONE.')
            self.assertTrue(os.path.exists(inside), '환경 안 쓰기가 안 됐다')
            self.assertFalse(os.path.exists(real), '실제 hstack 저장소에 써졌다')
        finally:
            shutil.rmtree(os.path.dirname(real), ignore_errors=True)

    def test_no_basics_env_loads_empty_basics(self):
        r = env_py('create', self.name, '--slot', 'a', '--basics', 'none')
        self.assertEqual(r.returncode, 0, r.stderr)
        basics = os.path.join(env_dir(self.name), 'hstack', 'basics.md')
        self.assertEqual(open(basics, encoding='utf-8').read().strip(), '')
        r, _ = stream(self.name, 'Reply with exactly: OK')
        self.assertEqual(r.returncode, 0, r.stderr)
        # 빈 파일은 Claude가 지침 로드로 알리지 않는다. 전역 지침(슬롯 CLAUDE.md)은 실리고,
        # 어떤 basics 본문도(환경 것도 실제 저장소 것도) 실리지 않아야 한다.
        files = loaded_files(self.name)
        self.assertTrue(any(f.endswith(os.path.join('claude-config', 'CLAUDE.md')) for f in files), files)
        self.assertFalse(any(f.endswith('basics.md') for f in files), files)
        self.assertNotIn('메인 에이전트의 자리', r.stdout)


class WithoutClaudeCall(unittest.TestCase):
    """모델 호출 없이(또는 로그인 실패로 바로 끝나는) 시나리오. 임시 base를 쓴다."""

    def setUp(self):
        self.base = tempfile.mkdtemp(prefix='hstack-eval-base-')
        os.makedirs(os.path.join(self.base, 'claude-config'))  # 로그인 안 된 슬롯 a
        os.makedirs(os.path.join(self.base, 'claude-config-b'))

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def test_env_copy_has_no_real_repo_paths(self):
        r = env_py('create', 'e1', '--slot', 'a', base=self.base)
        self.assertEqual(r.returncode, 0, r.stderr)
        hs = os.path.join(self.base, 'envs', 'e1', 'hstack')
        hits = subprocess.run(['grep', '-rlF', REPO, hs], capture_output=True, text=True).stdout.split()
        hits += subprocess.run(['grep', '-rlF', '~/workspace/hstack', hs], capture_output=True, text=True).stdout.split()
        self.assertEqual(hits, [])
        self.assertFalse(os.path.exists(os.path.join(hs, 'data', 'story-map', 'hstack')), '실제 기록이 복사됐다')
        slot_md = open(os.path.join(self.base, 'claude-config', 'CLAUDE.md'), encoding='utf-8').read()
        self.assertIn('@' + os.path.join(hs, 'basics.md'), slot_md)
        self.assertNotIn('~/workspace/hstack/basics.md', slot_md)

    def test_refuses_when_slot_points_to_another_env(self):
        self.assertEqual(env_py('create', 'e1', '--slot', 'a', base=self.base).returncode, 0)
        self.assertEqual(env_py('create', 'e2', '--slot', 'a', base=self.base).returncode, 0)
        r = env_py('claude', 'e1', '--', '-p', 'hi', *HAIKU, base=self.base)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('e2', r.stderr)  # 지금 슬롯을 쥔 환경을 알려 준다

    def test_two_slots_hold_two_envs(self):
        self.assertEqual(env_py('create', 'e1', '--slot', 'a', base=self.base).returncode, 0)
        self.assertEqual(env_py('create', 'e2', '--slot', 'b', '--basics', 'none', base=self.base).returncode, 0)
        a = open(os.path.join(self.base, 'claude-config', 'CLAUDE.md'), encoding='utf-8').read()
        b = open(os.path.join(self.base, 'claude-config-b', 'CLAUDE.md'), encoding='utf-8').read()
        self.assertIn(os.path.join('envs', 'e1'), a)
        self.assertIn(os.path.join('envs', 'e2'), b)

    def test_not_logged_in_shows_login_guidance(self):
        self.assertEqual(env_py('create', 'e1', '--slot', 'a', base=self.base).returncode, 0)
        r = env_py('claude', 'e1', '--', '-p', 'hi', *HAIKU, base=self.base, timeout=120)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('/login', r.stderr)
        self.assertIn(os.path.join(self.base, 'claude-config'), r.stderr)


if __name__ == '__main__':
    unittest.main()
