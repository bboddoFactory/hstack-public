#!/usr/bin/env python3
"""Apply shared basics to the managed part of Codex's global instructions."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from datetime import datetime, timezone

START = '<!-- hstack:basics:start -->'
END = '<!-- hstack:basics:end -->'


def render(root):
    source = (root / 'basics.md').read_text(encoding='utf-8')
    version = json.loads((root / '.claude-plugin/plugin.json').read_text())['version']
    marketplace = json.loads((root / '.claude-plugin/marketplace.json').read_text())
    versions = [p['version'] for p in marketplace['plugins'] if p['name'] == 'hstack']
    if versions != [version]:
        raise ValueError('플러그인과 마켓의 버전이 다릅니다.')
    if START in source or END in source:
        raise ValueError('원본에 반영 구간 표식을 넣을 수 없습니다.')
    body = source.replace('~/workspace/hstack', str(root))
    # Resolve Markdown file references and the record directory relative to hstack.
    def link(match):
        value = match.group(1)
        if value.startswith(('http:', 'https:', '/', '#', '~')):
            return match.group(0)
        return '](' + (root / value).as_posix() + ')'
    body = re.sub(r'\]\(([^\s)]+)\)', link, body)
    for filename in ('basics.md', 'how-we-work.md'):
        body = body.replace('`' + filename + '`', '`' + str(root / filename) + '`')
    body = body.replace('`scripts/sync-codex-basics.py`', '`' + str(root / 'scripts/sync-codex-basics.py') + '`')
    body = body.replace('`data/story-map/', '`' + str(root / 'data/story-map') + '/')
    digest = hashlib.sha256(source.encode()).hexdigest()
    rendered_digest = hashlib.sha256(body.encode()).hexdigest()
    metadata = json.dumps({'version': version, 'root': str(root),
                           'source_sha256': digest, 'rendered_sha256': rendered_digest},
                          ensure_ascii=False)
    return f'{START}\n<!-- {metadata} -->\n{body.rstrip()}\n{END}'


def merge(old, block):
    if not old.count(START) and not old.count(END):
        return old + ('\n\n' if old and not old.endswith('\n\n') else '') + block + '\n'
    if old.count(START) != 1 or old.count(END) != 1:
        raise ValueError('반영 구간 표식이 누락되었거나 중복됐습니다. 파일을 변경하지 않습니다.')
    begin, end = old.index(START), old.index(END)
    if begin >= end:
        raise ValueError('반영 구간 표식 순서가 잘못됐습니다.')
    return old[:begin] + block + old[end + len(END):]


REMIND = 'hooks/remind.sh'


def merge_hooks(old_text, command):
    """Register the hstack reminder hook under UserPromptSubmit, keeping every other hook."""
    data = json.loads(old_text) if old_text.strip() else {}
    groups = data.setdefault('hooks', {}).setdefault('UserPromptSubmit', [])
    for group in groups:
        group['hooks'] = [h for h in group.get('hooks', []) if REMIND not in h.get('command', '')]
    groups[:] = [g for g in groups if g['hooks']]
    groups.append({'hooks': [{'type': 'command', 'command': command, 'timeout': 10}]})
    return json.dumps(data, ensure_ascii=False, indent=2) + '\n'


def write_atomic(target, text, prefix):
    if target.exists():
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        backup = target.with_name(target.name + '.backup-' + stamp)
        shutil.copy2(target, backup)
        print(f'백업: {backup}')
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=target.parent, prefix=prefix)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            output.write(text)
        if target.exists():
            os.chmod(name, target.stat().st_mode & 0o777)
        os.replace(name, target)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    if target.read_text(encoding='utf-8') != text:
        raise ValueError(f'저장 결과가 예상 내용과 다릅니다: {target}')


def sync_hooks(root, codex_home, check):
    """Codex runs hooks only after the user trusts them once in an interactive session."""
    target = codex_home / 'hooks.json'
    old = target.read_text(encoding='utf-8') if target.exists() else ''
    expected = merge_hooks(old, f"bash '{root / REMIND}'")
    if old.strip() and json.loads(old) == json.loads(expected):
        print(f'상기 훅 최신: {target}')
        return 0
    if check:
        print(f'상기 훅 갱신 필요: {target}')
        return 1
    write_atomic(target, expected, '.hstack-hooks-')
    print(f'상기 훅 등록: {target}. Codex를 대화형으로 한 번 열어 훅을 승인해야 실행된다.')
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='변경하지 않고 최신 여부만 확인')
    parser.add_argument('--target', type=Path, help='시험용 출력 파일 (기본: Codex 전역 파일)')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    codex_home = Path(os.environ.get('CODEX_HOME') or Path.home() / '.codex').expanduser()
    target = (args.target or codex_home / 'AGENTS.md').expanduser().absolute()
    override = codex_home / 'AGENTS.override.md'
    if args.target is None and override.exists() and override.read_text().strip():
        raise ValueError('전역 AGENTS.override.md가 우선 적용 중입니다. 먼저 적용 경로를 확인하세요.')
    old = target.read_text(encoding='utf-8') if target.exists() else ''
    expected = merge(old, render(root))
    if args.check:
        if old != expected:
            print(f'갱신 필요: {target}')
            status = 1
        else:
            print(f'최신 본문과 경로 일치: {target}')
            status = 0
    elif expected == old:
        print(f'이미 최신 상태: {target}')
        status = 0
    else:
        write_atomic(target, expected, '.hstack-agents-')
        print(f'반영 완료: {target} ({len(expected.encode())} bytes)')
        status = 0
    if args.target is not None:
        return status
    return max(status, sync_hooks(root, codex_home, args.check))


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError) as error:
        print(f'오류: {error}')
        raise SystemExit(2)
