#!/bin/bash
set -e
set -o pipefail

fail() { printf '공개본 미러 실패: %s\n' "$1" >&2; exit 1; }
trap 'printf "공개본 미러 작업이 실패해 private push를 중단합니다.\n" >&2' ERR

[ "${1:-}" = origin ] || exit 0
local_sha= remote_sha=
while IFS=' ' read -r local_ref local_id remote_ref remote_id extra; do
  [ -n "$local_ref" ] && [ -n "$local_id" ] && [ -n "$remote_ref" ] && [ -n "$remote_id" ] && [ -z "$extra" ] || fail 'hook 입력을 해석할 수 없습니다.'
  case "$local_id:$remote_id" in *[!0-9a-f:]*) fail 'commit ID를 해석할 수 없습니다.' ;; esac
  case "${#local_id}:${#remote_id}" in 40:40|64:64) ;; *) fail 'commit ID 길이가 올바르지 않습니다.' ;; esac
  [ "$remote_ref" = refs/heads/main ] || continue
  case "$local_id" in *[!0]*) ;; *) continue ;; esac
  [ -z "$local_sha" ] || fail 'main을 갱신하는 입력이 중복됐습니다.'
  local_sha=$local_id
  remote_sha=$remote_id
done
[ -n "$local_sha" ] || exit 0

private_root=$(cd "$(git rev-parse --show-toplevel)" && pwd -P)
git cat-file -e "$local_sha^{commit}"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/hstack-mirror.XXXXXXXX")
trap 'rm -rf "$tmp"' EXIT
git -C "$private_root" archive --format=tar "$local_sha" > "$tmp/tree.tar"

public_remote=${HSTACK_PUBLIC_REMOTE:-git@github.com:bboddoFactory/hstack-public.git}
public_dir=${HSTACK_PUBLIC_DIR:-$HOME/.cache/hstack-public}
(
  unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_COMMON_DIR
  if [ ! -e "$public_dir" ]; then
    parent=$public_dir
    while [ ! -d "$parent" ]; do parent=$(dirname "$parent"); done
    parent=$(cd "$parent" && pwd -P)
    case "$parent/" in "$private_root/"*) fail 'public 경로가 private 저장소 안에 있습니다.' ;; esac
    git clone --no-checkout "$public_remote" "$public_dir"
  fi
  cd "$public_dir"
  public_root=$(pwd -P)
  case "$private_root/" in "$public_root/"*) fail 'public 경로가 private 저장소와 겹칩니다.' ;; esac
  case "$public_root/" in "$private_root/"*) fail 'public 경로가 private 저장소 안에 있습니다.' ;; esac
  [ -d .git ] && [ "$(git rev-parse --show-toplevel)" = "$public_root" ] || fail 'public clone 경로가 올바르지 않습니다.'
  git remote set-url origin "$public_remote"
  remote_main=$(git ls-remote --heads origin refs/heads/main)
  find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
  git symbolic-ref HEAD refs/heads/main
  if [ -n "$remote_main" ]; then
    git fetch origin refs/heads/main
    git reset --hard FETCH_HEAD
  else
    git update-ref -d refs/heads/main
    git read-tree --empty
  fi
  find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
  tar -xf "$tmp/tree.tar"
  rm -rf data
  if [ -s .gitignore ] && [ "$(tail -c 1 .gitignore | wc -l | tr -d ' ')" = 0 ]; then
    printf '\n' >> .gitignore
  fi
  printf 'data/\n' >> .gitignore
  git add -f -A
  if git diff --cached --quiet; then
    exit 0
  else
    status=$?
    [ "$status" -eq 1 ] || fail '공개본 변경을 비교하지 못했습니다.'
  fi
  git commit -m "공개본 갱신"
  git -c core.hooksPath=/dev/null push origin HEAD:refs/heads/main
)
