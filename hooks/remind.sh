#!/bin/bash
# 사용자 메시지마다 reminder.md의 글을 메인 맥락에 덧붙인다(UserPromptSubmit).
# Claude Code는 플러그인의 hooks/hooks.json이, Codex는 scripts/sync-codex-basics.py가 이 파일을 등록한다.
# 문구는 reminder.md에서 고친다. 등록된 명령이 그대로라 Codex의 훅 재승인이 필요 없다.
cat > /dev/null
python3 - "$(dirname "$0")/reminder.md" <<'PY'
import json, sys
text = open(sys.argv[1], encoding='utf-8').read().strip()
print(json.dumps({'hookSpecificOutput': {'hookEventName': 'UserPromptSubmit', 'additionalContext': text}}, ensure_ascii=False))
PY
