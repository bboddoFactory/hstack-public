"""judge.check_same_run(실행 당시와 지금 케이스가 같은 실행인가)의 안쪽 테스트. 모델을 부르지 않는다."""
import json
import os
import shutil
import sys
import tempfile
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, 'eval'))
import common  # noqa: E402
import judge  # noqa: E402

CASE_ID = '짧은-진행-답-1'


class SameRunTest(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='hstack-same-run-')
        self.case_dir = os.path.join(REPO, 'eval', 'cases', CASE_ID)
        self.case = common.load_case(self.case_dir)
        self.batch = os.path.join(self.tmp, 'b')
        os.makedirs(os.path.join(self.batch, CASE_ID))
        shutil.copy(os.path.join(self.case_dir, 'case.json'), os.path.join(self.batch, CASE_ID, 'case.json'))
        fx = os.path.join(common.FIXTURES, self.case['fixture'])
        self.entry = {'id': CASE_ID, 'overlay_sha256': common.sha256_tree(os.path.join(self.case_dir, 'overlay')),
                      'fixture_records_sha256': common.sha256_tree(os.path.join(fx, 'records')),
                      'fixture_commit': common.read_json(os.path.join(fx, 'fixture.json'))['code']['commit']}

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def check(self, entry=None):
        return judge.check_same_run(self.batch, CASE_ID, self.case, self.case_dir, entry or self.entry)

    def test_same_run_has_no_difference(self):
        self.assertEqual(self.check(), [])

    def test_changed_overlay_fixture_records_and_commit_are_named(self):
        self.assertEqual(self.check({**self.entry, 'overlay_sha256': 'x'}), ['overlay'])
        self.assertEqual(self.check({**self.entry, 'fixture_records_sha256': 'x'}), ['fixture_records'])
        self.assertEqual(self.check({**self.entry, 'fixture_commit': 'x'}), ['fixture_commit'])

    def test_changed_fixture_name_is_named(self):
        old = json.loads(json.dumps(self.case))
        old['fixture'] = 'other'
        common.write_json(os.path.join(self.batch, CASE_ID, 'case.json'), old)
        self.assertIn('fixture', self.check())

    def test_no_snapshot_means_no_check(self):
        os.remove(os.path.join(self.batch, CASE_ID, 'case.json'))
        self.assertEqual(self.check({'id': CASE_ID, 'overlay_sha256': 'x'}), [])


if __name__ == '__main__':
    unittest.main()
