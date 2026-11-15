#!/bin/sh
# hstack 길잡이의 표가 실제 저장소와 맞는지 본다. 어긋난 곳을 한 줄씩 알리고, 있으면 1로 끝난다.
HSTACK="${HSTACK_HOME:-$HOME/workspace/hstack}"
GUIDE="$HSTACK/skills/hstack-guide/SKILL.md"
bad=0
say() { echo "어긋남: $1"; bad=1; }

cd "$HSTACK" || { echo "hstack을 찾지 못함: $HSTACK"; exit 1; }

for f in *.md; do
  grep -q "\`$f\`" "$GUIDE" || say "$f 가 길잡이의 표에 없다"
done
for d in skills/*/; do
  grep -q "\`$d\`" "$GUIDE" || say "$d 가 길잡이의 표에 없다"
done
for d in */; do
  case "$d" in skills/) continue ;; esac
  grep -q "\`$d" "$GUIDE" || say "$d 가 길잡이의 표에 없다"
done
grep -o '`[A-Za-z0-9._/-]*\.md`' "$GUIDE" | tr -d '`' | sort -u | while read -r f; do
  case "$f" in */*|SKILL.md|DESIGN.md|CLAUDE.md|product.md|decisions.md|log.md) continue ;; esac
  [ -f "$f" ] || echo "어긋남: 길잡이가 말하는 $f 가 없다"
done | grep . && bad=1

for f in .claude-plugin/plugin.json .claude-plugin/marketplace.json; do
  python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$f" 2>/dev/null || say "올바른 JSON이 아니다(비었거나 깨졌다): $f"
done
v1=$(grep -o '"version": *"[^"]*"' .claude-plugin/plugin.json | head -1)
v2=$(grep -o '"version": *"[^"]*"' .claude-plugin/marketplace.json | head -1)
[ -n "$v1" ] || say "plugin.json에 버전이 없다"
[ "$v1" = "$v2" ] || say "버전이 다르다: plugin.json $v1, marketplace.json $v2"
ver=$(echo "$v1" | sed -E 's/.*"([0-9][0-9.]*)".*/\1/')
[ -f docs/migrations.md ] && grep -q "^## $ver " docs/migrations.md || say "docs/migrations.md에 현재 버전($ver)의 항목이 없다(기록에 영향이 없으면 '기록에 영향 없음' 한 줄)"

new=$(git status --porcelain | grep '^??')
[ -z "$new" ] || { echo "커밋에 안 들어간 새 파일:"; echo "$new"; bad=1; }

[ "$bad" = 0 ] && echo "맞음: 길잡이의 표, 버전, 새 파일 모두 이상 없음"
exit "$bad"
