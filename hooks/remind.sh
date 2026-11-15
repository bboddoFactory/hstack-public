#!/bin/bash
# 사용자 메시지마다 reminder.md의 상기 문구를 메인 맥락에 덧붙인다(UserPromptSubmit).
# 같은 세션에서 직전 사용자 메시지와 10분 이상 떨어져 있으면 [이어가기] 줄을 앞에 붙인다.
# 시각은 세션 id별 파일에 적어 동시에 열린 세션끼리 섞이지 않게 한다. 서브에이전트 완료 알림은 사용자가
# 돌아온 것이 아니므로 시각을 갱신하지 않는다. 입력에 세션 id가 없으면 [이어가기] 없이 상기 문구만 붙인다.
# 훅 입력은 표준 입력으로 읽는다. 명령 인수로 넘기면 긴 메시지에서 실행 자체가 실패한다.
python3 -I -c "$(cat <<'PY'
import json, os, re, sys, time

GAP = 600
text = open(sys.argv[1], encoding='utf-8').read().strip()
try:
    data = json.loads(sys.stdin.read() or '{}')
except ValueError:
    data = {}
if not isinstance(data, dict):
    data = {}
sid = str(data.get('session_id') or '')
prompt = str(data.get('prompt') or '')
if sid and re.fullmatch(r'[A-Za-z0-9_-]+', sid) and not prompt.lstrip().startswith('<task-notification>'):
    folder = os.path.expanduser('~/.cache/hstack/last-prompt')
    path = os.path.join(folder, sid)
    now = time.time()
    try:
        last = float(open(path).read().strip())
    except (OSError, ValueError):
        last = None
    try:
        os.makedirs(folder, exist_ok=True)
        with open(path, 'w') as f:
            f.write(str(now))
    except OSError:
        pass
    if last is not None and now - last >= GAP:
        minutes = int((now - last) // 60)
        gap = f'{minutes // 60}시간 {minutes % 60}분' if minutes >= 60 else f'{minutes}분'
        text = (f'[이어가기] 사용자가 {gap} 만에 이 세션으로 돌아왔다. 답하기 전에 이 세션의 현재 작업(작업 파일 경로), '
                '하던 일, 열린 결정을 먼저 보여 준다. 작업이 정해지지 않은 세션이면 그렇다고 말한다.\n\n' + text)
print(json.dumps({'hookSpecificOutput': {'hookEventName': 'UserPromptSubmit', 'additionalContext': text}}, ensure_ascii=False))
PY
)" "$(dirname "$0")/reminder.md"
