#!/bin/sh
# codex-model.sh <계열>: Codex 모델 목록(models_cache.json)에서 gpt-<판>-<계열> 중
# 판이 가장 높은 slug 하나를 출력한다. 없거나 목록을 못 읽으면 출력 없이 오류로 끝난다.
exec python3 -I - "$1" <<'EOF'
import json, os, re, sys

family = (sys.argv[1] if len(sys.argv) > 1 else "").lower()
path = os.path.join(os.environ.get("CODEX_HOME") or os.path.expanduser("~/.codex"), "models_cache.json")

def fail(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)

if not family:
    fail("usage: codex-model.sh <계열>")
try:
    with open(path) as f:
        slugs = [m["slug"] for m in json.load(f)["models"]]
except (OSError, ValueError, KeyError, TypeError) as e:
    fail("모델 목록을 읽을 수 없다: %s (%s)" % (path, e))

pattern = re.compile(r"gpt-(\d+(?:\.\d+)*)-" + re.escape(family), re.IGNORECASE)
found = []
for s in slugs:
    m = isinstance(s, str) and pattern.fullmatch(s)
    if m:
        found.append((tuple(int(n) for n in m.group(1).split(".")), s))
if not found:
    fail("계열 '%s'에 맞는 모델이 없다: %s" % (family, path))
print(max(found)[1])
EOF
