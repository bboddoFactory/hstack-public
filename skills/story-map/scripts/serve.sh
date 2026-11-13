#!/bin/sh
# 현황판 서버를 띄운다. 모든 프로젝트를 한 서버가 보여 준다.
# hstack 저장소(기본 ~/workspace/hstack)를 그대로 내보낸다. 산출물(data/)과 현황판 틀(skills/story-map/board/)이 둘 다 거기 있다.
# 주소: http://<주소>:<포트>/skills/story-map/board/?p=<프로젝트 이름>
# Tailscale이 있으면 그 주소에, 없으면 이 PC 안에서만(127.0.0.1) 연다.
root=${HSTACK_HOME:-$HOME/workspace/hstack}
port=${STORY_MAP_PORT:-5180}
ip=$(tailscale ip -4 2>/dev/null | head -1)
[ -z "$ip" ] && ip=$(/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4 2>/dev/null | head -1)
[ -z "$ip" ] && ip=127.0.0.1
echo "http://$ip:$port/skills/story-map/board/?p=$( "$(dirname "$0")/project-id.sh" )"
exec python3 -m http.server "$port" --bind "$ip" -d "$root"
