#!/bin/sh
# codex-model.sh <계열>이 Codex 모델 목록에서 그 계열의 가장 높은 판을 고르는지 본다.
# 실행: sh scripts/codex-model.test.sh
here=$(cd "$(dirname "$0")" && pwd)
cmd="$here/codex-model.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail=0
check() { # 설명, 기대 출력, 실제 출력
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: 기대 '$2', 실제 '$3'"; fail=1; fi
}

# 목록의 순서는 판 순서가 아니다. 숫자로 비교해야 6.10이 6.9보다 높다.
cat > "$tmp/models_cache.json" <<'EOF'
{"fetched_at":"2026-11-19T00:00:00Z","models":[
 {"slug":"gpt-6-sol"},{"slug":"gpt-6.9-sol"},{"slug":"gpt-6.10-sol"},{"slug":"gpt-6.2-sol"},
 {"slug":"gpt-6-astra"},{"slug":"gpt-6.2-astra"},
 {"slug":"gpt-6.1-terra"},{"slug":"gpt-5.6-terra"},
 {"slug":"gpt-6-luna"},
 {"slug":"gpt-reserve"},{"slug":"codex-auto-review"}]}
EOF
export CODEX_HOME="$tmp"
check "sol: 숫자 비교로 가장 높은 판" "gpt-6.10-sol" "$(sh "$cmd" sol)"
check "astra" "gpt-6.2-astra" "$(sh "$cmd" astra)"
check "terra: 앞 숫자가 큰 판" "gpt-6.1-terra" "$(sh "$cmd" terra)"
check "luna: 판이 하나" "gpt-6-luna" "$(sh "$cmd" luna)"
check "대문자 계열 이름" "gpt-6.2-astra" "$(sh "$cmd" Astra)"

# 없는 계열은 조용히 다른 모델을 내지 않고 실패한다.
out=$(sh "$cmd" nova 2>"$tmp/err"); code=$?
check "없는 계열: 표준 출력 비어 있음" "" "$out"
[ $code -ne 0 ] && echo "ok   없는 계열: 0이 아닌 종료" || { echo "FAIL 없는 계열이 0으로 끝남"; fail=1; }
grep -q nova "$tmp/err" && echo "ok   없는 계열: 오류에 계열 이름" || { echo "FAIL 없는 계열 오류에 이름이 없음"; fail=1; }

# 목록 파일이 없으면 실패하고 이유를 말한다.
export CODEX_HOME="$tmp/none"
out=$(sh "$cmd" sol 2>"$tmp/err"); code=$?
check "목록 없음: 표준 출력 비어 있음" "" "$out"
[ $code -ne 0 ] && echo "ok   목록 없음: 0이 아닌 종료" || { echo "FAIL 목록 없음이 0으로 끝남"; fail=1; }
[ -s "$tmp/err" ] && echo "ok   목록 없음: 오류 문구" || { echo "FAIL 목록 없음 오류 문구가 비어 있음"; fail=1; }

exit $fail
