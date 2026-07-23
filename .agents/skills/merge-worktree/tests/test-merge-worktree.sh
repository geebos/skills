#!/usr/bin/env bash

set -euo pipefail

skill_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
merge_script="$skill_dir/scripts/merge-worktree.sh"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/merge-worktree-tests.XXXXXX")

cleanup() {
  rm -rf -- "$test_root"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_equal() {
  if [ "$1" != "$2" ]; then
    fail "expected '$1' to equal '$2'"
  fi
}

configure_repo() {
  git -C "$1" config user.name "Merge Worktree Test"
  git -C "$1" config user.email "merge-worktree@example.com"
}

test_single_worktree_merge() {
  local repo="$test_root/single"
  local output="$test_root/single.out"
  local main_before

  git init -q -b main "$repo"
  configure_repo "$repo"
  printf 'base\n' >"$repo/base.txt"
  git -C "$repo" add base.txt
  git -C "$repo" commit -q -m initial
  main_before=$(git -C "$repo" rev-parse main)

  git -C "$repo" switch -q -c dev/single
  printf 'change\n' >"$repo/change.txt"
  git -C "$repo" add change.txt
  git -C "$repo" commit -q -m development

  (
    cd "$repo"
    bash "$merge_script" \
      --message "feat: single topology" \
      --test-command "git diff --quiet"
  ) >"$output" 2>&1

  grep -q '^MODE=single-worktree$' "$output"
  assert_equal "$(git -C "$repo" branch --show-current)" "main"
  assert_equal "$(git -C "$repo" rev-parse main^)" "$main_before"
  assert_equal \
    "$(git -C "$repo" rev-parse 'main^{tree}')" \
    "$(git -C "$repo" rev-parse 'dev/single^{tree}')"
  test -z "$(git -C "$repo" status --porcelain)"
  test ! -d "$repo/.git/merge-worktree.lock"
}

test_main_worktree_merge() {
  local main_repo="$test_root/multi-main"
  local dev_repo="$test_root/multi-dev"
  local output="$test_root/multi.out"
  local main_before

  git init -q -b main "$main_repo"
  configure_repo "$main_repo"
  printf 'base\n' >"$main_repo/base.txt"
  git -C "$main_repo" add base.txt
  git -C "$main_repo" commit -q -m initial
  main_before=$(git -C "$main_repo" rev-parse main)

  git -C "$main_repo" worktree add -q -b dev/multi "$dev_repo"
  printf 'change\n' >"$dev_repo/change.txt"
  git -C "$dev_repo" add change.txt
  git -C "$dev_repo" commit -q -m development

  (
    cd "$dev_repo"
    bash "$merge_script" --message "feat: multi topology"
  ) >"$output" 2>&1

  grep -q '^MODE=main-worktree$' "$output"
  assert_equal "$(git -C "$main_repo" branch --show-current)" "main"
  assert_equal "$(git -C "$dev_repo" branch --show-current)" "dev/multi"
  assert_equal "$(git -C "$main_repo" rev-parse main^)" "$main_before"
  assert_equal \
    "$(git -C "$main_repo" rev-parse 'main^{tree}')" \
    "$(git -C "$dev_repo" rev-parse 'dev/multi^{tree}')"
  test -z "$(git -C "$main_repo" status --porcelain)"
  test -z "$(git -C "$dev_repo" status --porcelain)"
  test ! -d "$main_repo/.git/merge-worktree.lock"
}

test_ambiguous_worktrees_rejected() {
  local root_repo="$test_root/ambiguous-root"
  local other_repo="$test_root/ambiguous-other"
  local output="$test_root/ambiguous.out"
  local status

  git init -q -b main "$root_repo"
  configure_repo "$root_repo"
  git -C "$root_repo" commit -q --allow-empty -m initial
  git -C "$root_repo" switch -q -c dev/one
  git -C "$root_repo" worktree add -q -b dev/two "$other_repo"

  set +e
  (
    cd "$root_repo"
    bash "$merge_script" --message "feat: ambiguous topology"
  ) >"$output" 2>&1
  status=$?
  set -e

  test "$status" -ne 0
  grep -q 'multiple worktrees exist' "$output"
  assert_equal "$(git -C "$root_repo" branch --show-current)" "dev/one"
  test ! -d "$root_repo/.git/merge-worktree.lock"
}

test_lock_and_direct_main() {
  local repo="$test_root/direct"
  local output="$test_root/direct.out"
  local lock_output="$test_root/lock.out"
  local lock_status

  git init -q -b main "$repo"
  configure_repo "$repo"
  git -C "$repo" commit -q --allow-empty -m initial

  mkdir "$repo/.git/merge-worktree.lock"
  printf 'pid=123\nworktree=test\nbranch=main\n' \
    >"$repo/.git/merge-worktree.lock/owner"

  set +e
  (
    cd "$repo"
    bash "$merge_script" --message "docs: blocked"
  ) >"$lock_output" 2>&1
  lock_status=$?
  set -e

  test "$lock_status" -ne 0
  grep -q 'holds the repository lock' "$lock_output"
  grep -q 'pid=123' "$lock_output"
  rm "$repo/.git/merge-worktree.lock/owner"
  rmdir "$repo/.git/merge-worktree.lock"

  printf 'direct\n' >"$repo/direct.txt"
  git -C "$repo" add direct.txt
  (
    cd "$repo"
    bash "$merge_script" --message "docs: direct main"
  ) >"$output" 2>&1

  grep -q '^MODE=direct-main$' "$output"
  test -z "$(git -C "$repo" status --porcelain)"
  test ! -d "$repo/.git/merge-worktree.lock"
}

test_single_worktree_merge
test_main_worktree_merge
test_ambiguous_worktrees_rejected
test_lock_and_direct_main

echo "OK: merge-worktree regression tests passed"
