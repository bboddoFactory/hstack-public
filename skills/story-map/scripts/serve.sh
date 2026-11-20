#!/bin/sh
# 현황판 주소를 알린다. 허브(skills/browser-explain/scripts/hub.mjs)가 그 포트에서 응답하면 주소만 찍고 끝나고,
# 응답하지 않으면 같은 주소를 찍고 허브를 이 프로세스로 띄운다(끄면 허브도 꺼진다). 늘 켜 두려면 hub.mjs install.
# 포트는 PORT(기본 27180), 저장소 위치는 HSTACK_HUB_ROOT로 바꾼다(허브와 같은 이름).
port=${PORT:-27180}
echo "http://127.0.0.1:$port/skills/story-map/board/?p=$( "$(dirname "$0")/project-id.sh" )"
curl -fs -o /dev/null --max-time 2 "http://127.0.0.1:$port/api/list" && exit 0
exec node "$(dirname "$0")/../../browser-explain/scripts/hub.mjs"
