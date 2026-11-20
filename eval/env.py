"""hstack 평가용 격리 환경: 명령 하나로 만들고, 그 안에서 Claude를 띄운다.

  python3 eval/env.py create <이름> [--slot a|b] [--basics <git ref>|worktree|none] [--code <폴더>]
  python3 eval/env.py claude <이름> [-- <claude 인수>...]

환경은 <base>/envs/<이름>/ 아래에 hstack 사본·plugin 사본·work·tmp를 둔다.
로그인은 설정 폴더 경로에 묶여 사본이 풀리므로, 로그인된 설정 폴더 두 개(슬롯 a·b)를 재사용한다.
슬롯은 한 번에 한 환경만 쥔다(슬롯 폴더의 표시 파일).
"""
import argparse
import datetime
import json
import os
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.abspath(os.path.expanduser(os.environ.get('HSTACK_EVAL_BASE') or '~/.cache/hstack-eval'))
SLOTS = {'a': 'claude-config', 'b': 'claude-config-b'}
HOLDER = '.hstack-eval-env'  # 슬롯을 쥔 환경 이름
INCLUDE = ['basics.md', 'how-we-work.md', 'README.md', 'DESIGN.md', 'docs', 'skills', 'hooks', 'agents', 'scripts', '.claude-plugin']
IMPORT_LINE = '@~/workspace/hstack/basics.md'
SESSION_ENV = ('CLAUDECODE', 'CLAUDE_CODE_', 'CLAUDE_PID', 'CLAUDE_EFFORT')
IGNORE =shutil.ignore_patterns('.git', '__pycache__', '.DS_Store')


class Refuse(Exception):
    pass


def slot_dir(slot):
    return os.path.join(BASE, SLOTS[slot])


def env_dir(name):
    return os.path.join(BASE, 'envs', name)


def login_guide(slot_path):
    return (f'설정 폴더가 없거나 로그인이 안 됐다: {slot_path}\n'
            f'  CLAUDE_CONFIG_DIR={slot_path} claude  를 실행한 뒤 /login 으로 로그인하라.')


def check_slot_exists(slot):
    if not os.path.isdir(slot_dir(slot)):
        raise Refuse(login_guide(slot_dir(slot)))


def git(*args):
    r = subprocess.run(['git', '-C', REPO, *args], capture_output=True)
    if r.returncode:
        raise Refuse(f"git {' '.join(args)} 실패: {r.stderr.decode(errors='replace').strip()}")
    return r.stdout


def rewrite_paths(root, new_root):
    """사본 안의 실제 저장소 경로를 사본 경로로 바꿔, 세션이 실제 기록을 건드리지 않게 한다."""
    for dirpath, _, files in os.walk(root):
        for f in files:
            p = os.path.join(dirpath, f)
            if os.path.islink(p):
                continue
            try:
                s = open(p, encoding='utf-8').read()
            except (UnicodeDecodeError, OSError):
                continue
            t = s.replace(REPO, new_root).replace('~/workspace/hstack', new_root)
            if t != s:
                open(p, 'w', encoding='utf-8').write(t)


def lay_hstack(hs, basics):
    """hstack 사본을 hs에 놓고 basics 해석 결과(커밋 id 또는 worktree/none)를 돌려준다."""
    os.makedirs(hs)
    if basics == 'worktree':
        for item in INCLUDE:
            src = os.path.join(REPO, item)
            if os.path.isdir(src):
                shutil.copytree(src, os.path.join(hs, item), ignore=IGNORE)
            elif os.path.isfile(src):
                shutil.copy(src, hs)
        resolved = 'worktree'
    else:
        ref = 'HEAD' if basics == 'none' else basics
        # agents/처럼 그 커밋에 없는 경로가 있으면 git archive가 통째로 실패하므로 있는 것만 넘긴다.
        present = set(git('ls-tree', '--name-only', ref).decode().split('\n'))
        archive = subprocess.run(['git', '-C', REPO, 'archive', ref, *[i for i in INCLUDE if i in present]],
                                 capture_output=True)
        if archive.returncode:
            raise Refuse(f'git archive {ref} 실패: {archive.stderr.decode(errors="replace").strip()}')
        subprocess.run(['tar', '-x', '-C', hs], input=archive.stdout, check=True)
        resolved = 'none' if basics == 'none' else git('rev-parse', ref).decode().strip()
        if basics == 'none':
            open(os.path.join(hs, 'basics.md'), 'w').close()
    os.makedirs(os.path.join(hs, 'data', 'story-map'))
    return resolved


def read_json(path):
    if not os.path.exists(path):
        return {}
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def write_slot(slot, name, env):
    """슬롯 설정 폴더에 이 환경의 CLAUDE.md·settings.json을 쓰고 슬롯을 쥔다."""
    sd = slot_dir(slot)
    glob = open(os.path.expanduser('~/.claude/CLAUDE.md'), encoding='utf-8').read()
    with open(os.path.join(sd, 'CLAUDE.md'), 'w', encoding='utf-8') as f:
        f.write(glob.replace(IMPORT_LINE, '@' + os.path.join(env, 'hstack', 'basics.md')))
    sp = os.path.join(sd, 'settings.json')
    st = read_json(sp)
    log = os.path.join(env, 'instructions-loaded.jsonl')
    st['claudeMdExcludes'] = [os.path.expanduser('~/.claude/CLAUDE.md'), REPO + '/**']
    st.setdefault('hooks', {})['InstructionsLoaded'] = [
        {'hooks': [{'type': 'command', 'command': f"cat >> '{log}'; echo >> '{log}'"}]}]
    st['sandbox'] = {'enabled': True, 'autoAllowBashIfSandboxed': True, 'filesystem': {'allowWrite': [env]}}
    st.setdefault('permissions', {})['allow'] = [f'Edit(/{env}/**)']
    with open(sp, 'w', encoding='utf-8') as f:
        json.dump(st, f, indent=2, ensure_ascii=False)
    with open(os.path.join(sd, HOLDER), 'w', encoding='utf-8') as f:
        f.write(name + '\n')


def commands(name):
    me = f'python3 {os.path.join(REPO, "eval", "env.py")}'
    return (f'  한 턴:   {me} claude {name} -- -p "<프롬프트>"\n'
            f'  대화형: {me} claude {name}')


def create(a):
    # 입구 검사: 아무것도 지우기 전에 막을 것을 모두 막는다.
    if not a.name or '/' in a.name or a.name.startswith('.'):
        raise Refuse(f'환경 이름이 올바르지 않다: {a.name!r}')
    check_slot_exists(a.slot)
    if IMPORT_LINE not in open(os.path.expanduser('~/.claude/CLAUDE.md'), encoding='utf-8').read():
        raise Refuse(f'~/.claude/CLAUDE.md에서 {IMPORT_LINE} 줄을 찾지 못했다. basics 없이 도는 환경을 막으려고 만들기를 멈춘다.')
    if a.code and not os.path.isdir(a.code):
        raise Refuse(f'--code 폴더가 없다: {a.code}')
    if a.basics not in ('worktree', 'none'):
        git('rev-parse', '--verify', a.basics + '^{commit}')

    env = env_dir(a.name)
    shutil.rmtree(env, ignore_errors=True)
    os.makedirs(env)
    hs = os.path.join(env, 'hstack')
    resolved = lay_hstack(hs, a.basics)
    rewrite_paths(hs, hs)
    # --plugin-dir 폴더는 Claude Code가 쓰기를 막는다. 플러그인(설치본)과 기록 폴더를 가른다.
    shutil.copytree(hs, os.path.join(env, 'plugin'), ignore=shutil.ignore_patterns('data'))
    work = os.path.join(env, 'work')
    if a.code:
        shutil.copytree(a.code, work, symlinks=True)
    else:
        os.makedirs(work)
    os.makedirs(os.path.join(env, 'tmp'))
    write_slot(a.slot, a.name, env)
    meta = {'name': a.name, 'slot': a.slot, 'basics': a.basics, 'commit': resolved,
            'created': datetime.datetime.now().astimezone().isoformat(timespec='seconds')}
    with open(os.path.join(env, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    print(f'환경 {a.name} 만듦 (슬롯 {a.slot}, basics {a.basics} → {resolved})\n{commands(a.name)}')
    return 0


def launch(name, args):
    """환경 안에서 claude를 띄울 명령·환경 변수·작업 폴더·슬롯을 돌려준다(run.py도 같은 방식으로 띄운다)."""
    env = env_dir(name)
    meta_path = os.path.join(env, 'meta.json')
    if not os.path.exists(meta_path):
        raise Refuse(f'환경이 없다: {env}\n  python3 eval/env.py create {name} 으로 먼저 만든다.')
    slot = read_json(meta_path)['slot']
    check_slot_exists(slot)
    holder_path = os.path.join(slot_dir(slot), HOLDER)
    holder = open(holder_path, encoding='utf-8').read().strip() if os.path.exists(holder_path) else None
    if holder != name:
        raise Refuse(f'슬롯 {slot}({slot_dir(slot)})를 지금 환경 {holder or "(없음)"}이(가) 쥐고 있다.\n'
                     f'  {name}을(를) 다시 create하거나 다른 슬롯(--slot)을 쓰라.')

    cmd = ['claude', '--plugin-dir', os.path.join(env, 'plugin'), '--add-dir', os.path.join(env, 'hstack'), *args]
    # 훅이 넣은 글([hstack 상기])은 stream-json에 훅 이벤트를 넣어야 출력에 보인다(1차 run.py도 항상 켰다).
    if 'stream-json' in args and '--include-hook-events' not in args:
        cmd.append('--include-hook-events')
    return cmd, child_environ({'CLAUDE_CONFIG_DIR': slot_dir(slot), 'TMPDIR': os.path.join(env, 'tmp')}), \
        os.path.join(env, 'work'), slot


def child_environ(extra=None):
    """부모가 Claude 세션이면 CLAUDE_CODE_SAFE_MODE 등이 상속돼 자식의 플러그인·훅을 꺼 버린다. 세션 변수는 걸러 낸다."""
    inherited = {k: v for k, v in os.environ.items() if not k.startswith(SESSION_ENV)}
    return {**inherited, **(extra or {})}


def claude(name, args):
    cmd, child_env, cwd, slot = launch(name, args)
    if '-p' not in args and '--print' not in args:
        return subprocess.run(cmd, cwd=cwd, env=child_env).returncode
    r = subprocess.run(cmd, cwd=cwd, env=child_env, stdin=subprocess.DEVNULL, capture_output=True, text=True)
    sys.stdout.write(r.stdout)
    sys.stderr.write(r.stderr)
    if 'Not logged in' in r.stdout + r.stderr:
        print(login_guide(slot_dir(slot)), file=sys.stderr)
        return r.returncode or 1
    return r.returncode


def main():
    argv = sys.argv[1:]
    rest = []
    if '--' in argv:
        i = argv.index('--')
        argv, rest = argv[:i], argv[i + 1:]
    p = argparse.ArgumentParser(prog='env.py')
    sub = p.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('create')
    c.add_argument('name')
    c.add_argument('--slot', choices=sorted(SLOTS), default='a')
    c.add_argument('--basics', default='HEAD', help='git ref | worktree | none')
    c.add_argument('--code')
    k = sub.add_parser('claude')
    k.add_argument('name')
    a = p.parse_args(argv)
    try:
        return create(a) if a.cmd == 'create' else claude(a.name, rest)
    except Refuse as e:
        print(e, file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
