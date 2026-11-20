"""케이스를 격리 환경에서 N번 돌려 배치 폴더에 남긴다.

  python3 eval/run.py <케이스 id|폴더>... --model <모델> [--effort medium] [--runs 3] [--slot a]
                      [--basics HEAD] [--out <폴더>] [--batch <이름>] [--turn-timeout 900] [--keep-env]

실행 하나 = 새 격리 환경(env.py) + 픽스처 코드·기록 + overlay → 턴들 → 환경 정리.
배치 폴더: <out>/<배치>/batch.json, <케이스 id>/case.json, r<N>/{meta.json, turn<T>.jsonl, turn<T>-code.diff, turn<T>-records.diff}.
채점은 judge.py가 한다.
"""
import argparse
import contextlib
import datetime
import io
import os
import shutil
import signal
import subprocess
import sys
import time
import uuid

import common
import env
from common import BadInput, REPO

DEFAULT_OUT = os.path.join(REPO, 'data', 'story-map', 'hstack', 'eval', 'runs')
CODE_ROOT = os.path.abspath(os.path.expanduser(os.environ.get('HSTACK_EVAL_CODE') or '~/.cache/hstack-eval/code'))
LAST_PROMPT = os.path.expanduser('~/.cache/hstack/last-prompt')
GIT_QUIET = ['-c', 'core.quotepath=false', '-c', 'core.excludesFile=/dev/null', '-c', 'commit.gpgsign=false',
             '-c', 'user.name=eval', '-c', 'user.email=eval@local']
SNAP_EXCLUDE = '__pycache__/\n*.pyc\n.pytest_cache/\n.DS_Store\n'
OVERLAY_DIRS = ('code', 'records')


def now():
    return datetime.datetime.now().astimezone().isoformat(timespec='seconds')


def git_out(*args, git_dir=None, tree=None):
    cmd = ['git', *([f'--git-dir={git_dir}', f'--work-tree={tree}'] if git_dir else []), *GIT_QUIET, *args]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode:
        raise RuntimeError(f"git {' '.join(args)} 실패: {r.stderr.decode(errors='replace').strip()}")
    return r.stdout.decode(errors='replace')


class Snapshot:
    """폴더 밖의 별도 GIT_DIR로 턴마다 상태를 찍는다. 메인이 폴더 안에서 직접 커밋해도 변경이 숨지 않는다."""

    def __init__(self, git_dir, tree):
        self.git_dir, self.tree = git_dir, tree
        os.makedirs(git_dir)
        git_out('init', '-q', git_dir=git_dir, tree=tree)
        common.write_text(os.path.join(git_dir, 'info', 'exclude'), SNAP_EXCLUDE)
        self.delta()

    def delta(self):
        """지난 스냅샷 이후의 모든 변경(새 파일은 내용까지)을 diff 글로 돌려주고 새 스냅샷으로 넘어간다."""
        g = dict(git_dir=self.git_dir, tree=self.tree)
        git_out('add', '-A', **g)
        has_head = subprocess.run(['git', f'--git-dir={self.git_dir}', 'rev-parse', '--verify', '-q', 'HEAD'],
                                  capture_output=True).returncode == 0
        diff = git_out('diff', '--cached', '--no-color', '--no-ext-diff', 'HEAD', **g) if has_head else ''
        git_out('commit', '-q', '--allow-empty', '--no-verify', '-m', 'snap', **g)
        return diff


def ensure_code(fixture):
    """픽스처 코드를 한 번 받아 두고 다시 쓴다. 커밋이 없으면 BadInput."""
    repo, commit = fixture['code']['repo'], fixture['code']['commit']
    src = os.path.join(CODE_ROOT, os.path.basename(repo.rstrip('/')).removesuffix('.git') + '-src')
    if not os.path.isdir(src):
        os.makedirs(CODE_ROOT, exist_ok=True)
        r = subprocess.run(['git', 'clone', '-q', repo, src], capture_output=True, text=True)
        if r.returncode:
            raise BadInput(f'픽스처 코드를 받지 못했다: {repo}\n  {r.stderr.strip()}')
    if subprocess.run(['git', '-C', src, 'cat-file', '-e', commit + '^{commit}'], capture_output=True).returncode:
        subprocess.run(['git', '-C', src, 'fetch', '-q', 'origin'], capture_output=True)
        if subprocess.run(['git', '-C', src, 'cat-file', '-e', commit + '^{commit}'], capture_output=True).returncode:
            raise BadInput(f'픽스처 코드 {src}에 커밋 {commit}이 없다')
    return src


def load_fixture(name, case_name):
    d = os.path.join(common.FIXTURES, name)
    try:
        fx = common.read_json(os.path.join(d, 'fixture.json'))
        fx['project'], fx['code']['repo'], fx['code']['commit']
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise BadInput(f'케이스 {case_name}: 픽스처 {name}의 fixture.json을 읽지 못했다 ({e!r})')
    fx['dir'] = d
    return fx


def check_overlay(case_dir, case_name):
    ov = os.path.join(case_dir, 'overlay')
    if os.path.isdir(ov):
        extra = [x for x in os.listdir(ov) if x not in OVERLAY_DIRS]
        if extra:
            raise BadInput(f'케이스 {case_name}: overlay에는 {OVERLAY_DIRS}만 둘 수 있다 ({", ".join(extra)})')
    return ov


def lay_world(run_env, fixture, src, overlay):
    """코드 폴더(work)와 기록 폴더를 픽스처 + overlay로 채운다. 코드는 git으로 두어 실제 프로젝트와 같게 한다."""
    work = os.path.join(run_env, 'work')
    archive = subprocess.run(['git', '-C', src, 'archive', fixture['code']['commit']], capture_output=True, check=True)
    subprocess.run(['tar', '-x', '-C', work], input=archive.stdout, check=True)
    if os.path.isdir(os.path.join(overlay, 'code')):
        shutil.copytree(os.path.join(overlay, 'code'), work, dirs_exist_ok=True)
    git_out('-C', work, 'init', '-q')
    git_out('-C', work, 'add', '-A')
    git_out('-C', work, 'commit', '-q', '-m', 'fixture')
    records = os.path.join(run_env, 'hstack', 'data', 'story-map', fixture['project'])
    if os.path.isdir(os.path.join(fixture['dir'], 'records')):
        shutil.copytree(os.path.join(fixture['dir'], 'records'), records)
    if os.path.isdir(os.path.join(overlay, 'records')):
        shutil.copytree(os.path.join(overlay, 'records'), records, dirs_exist_ok=True)
    os.makedirs(records, exist_ok=True)
    return work, records


def kill_group(pid):
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def run_turn(name, sid, n, prompt, a, path):
    """claude -p 한 턴. 원문은 path에, 끊기면 받은 만큼. meta 항목과 로그인 문제 여부를 돌려준다."""
    # hooks/remind.sh가 긴 턴 때문에 [이어가기]를 우연히 붙이지 않게 매 턴 전에 지금 시각을 쓴다.
    os.makedirs(LAST_PROMPT, exist_ok=True)
    common.write_text(os.path.join(LAST_PROMPT, sid), str(time.time()))
    args = ['-p', prompt, '--model', a.model, '--effort', a.effort, '--output-format', 'stream-json', '--verbose',
            '--include-hook-events', '--session-id' if n == 1 else '--resume', sid]
    entry = {'turn': n, 'started': now(), 'ended': None, 'exit_code': None, 'cut': False}
    login = False
    try:
        cmd, child_env, cwd, slot = env.launch(name, args)
        err_path = path[:-len('.jsonl')] + '.err'
        with open(path, 'wb') as out, open(err_path, 'wb') as err:
            p = subprocess.Popen(cmd, cwd=cwd, env=child_env, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                                 start_new_session=True)
            try:
                entry['exit_code'] = p.wait(timeout=a.turn_timeout)
            except subprocess.TimeoutExpired:
                entry['cut'] = True
                kill_group(p.pid)
                entry['exit_code'] = p.wait()
            kill_group(p.pid)  # 백그라운드로 남은 자식까지
        events = common.read_events(path)
        entry.update(common.summarize_turn(events))
        stderr = common.read_text(err_path)
        if not stderr.strip():
            os.remove(err_path)
        last = next((e for e in reversed(events) if e.get('type') == 'result'), {})
        login = 'Not logged in' in stderr or (last.get('is_error') and 'Not logged in' in str(last.get('result')))
        if login or last.get('is_error'):
            entry['exit_code'] = entry['exit_code'] or 1
    except env.Refuse as e:
        entry.update(exit_code=1, error=str(e))
    entry['ended'] = now()
    return entry, bool(login)


def execute_run(a, batch, case, case_dir, fixture, src, n, problems):
    run_dir = os.path.join(batch, case['id'], f'r{n}')
    os.makedirs(run_dir)
    name = 'run-' + uuid.uuid4().hex[:8]
    sid = str(uuid.uuid4())
    meta = {'env': env.env_dir(name), 'config_dir': env.slot_dir(a.slot), 'session_id': sid, 'turns': []}
    label = f'{case["id"]} r{n}'
    snap_root = os.path.join(env.BASE, 'snap', name)
    login = False
    try:
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                env.create(argparse.Namespace(name=name, slot=a.slot, basics=a.basics, code=None))
            work, records = lay_world(meta['env'], fixture, src, check_overlay(case_dir, case['id']))
            snaps = {'code': Snapshot(os.path.join(snap_root, 'code'), work),
                     'records': Snapshot(os.path.join(snap_root, 'records'), records)}
        except (env.Refuse, RuntimeError, subprocess.CalledProcessError) as e:
            meta['error'] = f'환경을 만들지 못했다: {e}'
            problems.append(f'{label}: {meta["error"]}')
            return
        for t, prompt in enumerate(case['turns'], 1):
            entry, login_turn = run_turn(name, sid, t, prompt, a, os.path.join(run_dir, f'turn{t}.jsonl'))
            for where, snap in snaps.items():
                common.write_text(os.path.join(run_dir, f'turn{t}-{where}.diff'), snap.delta())
            meta['turns'].append(entry)
            login = login or login_turn
            print(f'[{label}] 턴 {t}/{len(case["turns"])} 끝 exit {entry["exit_code"]}{" 끊김" if entry["cut"] else ""}',
                  flush=True)
            if entry['cut'] or entry['exit_code']:
                why = '시간 제한으로 끊김' if entry['cut'] else f'claude 종료 코드 {entry["exit_code"]}'
                problems.append(f'{label} 턴 {t}: {why}' + (f' ({entry["error"]})' if entry.get('error') else '') +
                                ('' if t == len(case['turns']) else f' → 남은 턴 {len(case["turns"]) - t}개 건너뜀'))
                break
    finally:
        common.write_json(os.path.join(run_dir, 'meta.json'), meta)
        shutil.rmtree(snap_root, ignore_errors=True)
        with contextlib.suppress(OSError):
            os.rmdir(os.path.dirname(snap_root))
        with contextlib.suppress(OSError):
            os.remove(os.path.join(LAST_PROMPT, sid))
        if not a.keep_env:
            shutil.rmtree(meta['env'], ignore_errors=True)
    return login


def main():
    p = argparse.ArgumentParser(prog='run.py')
    p.add_argument('cases', nargs='+', help='케이스 id(eval/cases/<id>) 또는 케이스 폴더 경로')
    p.add_argument('--runs', type=int, default=3)
    p.add_argument('--model', required=True)
    p.add_argument('--effort', default='medium')
    p.add_argument('--slot', choices=sorted(env.SLOTS), default='a')
    p.add_argument('--basics', default='HEAD', help='git ref | worktree | none (env.py create에 그대로)')
    p.add_argument('--out', default=DEFAULT_OUT)
    p.add_argument('--batch')
    p.add_argument('--turn-timeout', type=int, default=900)
    p.add_argument('--keep-env', action='store_true')
    a = p.parse_args()

    # 입구 검사: 아무것도 만들기 전에 막을 것을 모두 막는다.
    try:
        if a.runs < 1 or a.turn_timeout < 1:
            raise BadInput('--runs와 --turn-timeout은 1 이상이어야 한다')
        cases = []
        for arg in a.cases:
            case_dir = common.find_case_dir(arg)
            case = common.load_case(case_dir)
            fixture = load_fixture(case['fixture'], case['id'])
            check_overlay(case_dir, case['id'])
            cases.append((case, case_dir, fixture))
        if len({c['id'] for c, _, _ in cases}) != len(cases):
            raise BadInput('같은 케이스를 두 번 줄 수 없다')
        sources = {c['id']: ensure_code(fx) for c, _, fx in cases}
        env.check_slot_exists(a.slot)
        if a.basics in ('worktree', 'none'):
            basics_commit = a.basics
        else:
            basics_commit = env.git('rev-parse', '--verify', a.basics + '^{commit}').decode().strip()
        claude_version = subprocess.run(['claude', '--version'], capture_output=True, text=True).stdout.strip()
        if not claude_version:
            raise BadInput('claude --version이 나오지 않는다. claude가 설치돼 있는지 확인하라')
        batch_name = a.batch or datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        batch = os.path.join(os.path.abspath(a.out), batch_name)
        if os.path.exists(batch):
            raise BadInput(f'배치 폴더가 이미 있다: {batch}')
    except (BadInput, env.Refuse) as e:
        print(e, file=sys.stderr)
        return 1

    os.makedirs(batch)
    batch_json = {
        'name': batch_name, 'created': now(),
        'cases': [{'id': c['id'], 'sha256': common.sha256_file(os.path.join(d, 'case.json')),
                   'overlay_sha256': common.sha256_tree(os.path.join(d, 'overlay')), 'fixture': c['fixture'],
                   'fixture_records_sha256': common.sha256_tree(os.path.join(fx['dir'], 'records')),
                   'fixture_commit': fx['code']['commit']} for c, d, fx in cases],
        'runs': a.runs, 'model': a.model, 'effort': a.effort, 'basics': a.basics, 'basics_commit': basics_commit,
        'hstack_commit': env.git('rev-parse', 'HEAD').decode().strip(), 'claude_version': claude_version, 'slot': a.slot}
    common.write_json(os.path.join(batch, 'batch.json'), batch_json)
    for c, d, _ in cases:
        os.makedirs(os.path.join(batch, c['id']))
        shutil.copy(os.path.join(d, 'case.json'), os.path.join(batch, c['id'], 'case.json'))

    problems, login = [], False
    for case, case_dir, fixture in cases:
        for n in range(1, a.runs + 1):
            login = execute_run(a, batch, case, case_dir, fixture, sources[case['id']], n, problems) or login
    print(f'배치 폴더: {batch}')
    if problems:
        print(f'실패·끊김 {len(problems)}건:', file=sys.stderr)
        for line in problems:
            print(f'  {line}', file=sys.stderr)
        if login:
            print(env.login_guide(env.slot_dir(a.slot)), file=sys.stderr)
        return 1
    print(f'다음: python3 eval/judge.py {batch}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
