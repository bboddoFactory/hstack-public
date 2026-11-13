#!/bin/sh
# 지금 폴더가 속한 프로젝트의 이름을 한 줄로 낸다.
# git 저장소면 원래 저장소(워크트리가 아니라)의 폴더 이름, 아니면 지금 폴더 이름.
common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
if [ -n "$common" ]; then
  basename "$(dirname "$common")"
else
  basename "$(pwd -P)"
fi
