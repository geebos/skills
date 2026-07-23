#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: merge-worktree.sh --message <commit-message> [--test-command <command>]" >&2
}

commit_message=""
test_command=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --message)
      if [ "$#" -lt 2 ]; then
        usage
        exit 2
      fi
      commit_message=$2
      shift 2
      ;;
    --test-command)
      if [ "$#" -lt 2 ]; then
        usage
        exit 2
      fi
      test_command=$2
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [ -z "$commit_message" ]; then
  echo "Commit message must not be empty." >&2
  usage
  exit 2
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Run this script with a Git worktree as the working directory." >&2
  exit 1
fi

current_worktree=$(git rev-parse --show-toplevel)
current_branch=$(git branch --show-current)

if [ -z "$current_branch" ]; then
  echo "Detached HEAD is not supported." >&2
  exit 1
fi

if [ "$current_branch" = "main" ]; then
  if git diff --cached --quiet; then
    echo "Main has no staged changes to commit." >&2
    exit 1
  fi

  if ! git diff --quiet; then
    echo "Main has unstaged tracked changes. Stage or restore them before committing." >&2
    exit 1
  fi

  if [ -n "$(git ls-files --others --exclude-standard)" ]; then
    echo "Main has untracked files. Stage or remove them before committing." >&2
    exit 1
  fi

  git commit -m "$commit_message"
  commit_sha=$(git rev-parse HEAD)

  echo "MODE=direct-main"
  echo "MAIN_WORKTREE=$current_worktree"
  echo "COMMIT=$commit_sha"
  exit 0
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Development worktree must be clean before rebase." >&2
  exit 1
fi

dev_worktree=$current_worktree
dev_branch=$current_branch

if ! git show-ref --verify --quiet refs/heads/main; then
  echo "Local main branch does not exist." >&2
  exit 1
fi

main_before=$(git rev-parse refs/heads/main)
git rebase main

if [ -n "$test_command" ]; then
  echo "Running test command: $test_command"
  if ! bash -c "$test_command"; then
    echo "Test command failed. Local main was not modified." >&2
    exit 1
  fi
else
  echo "No test command supplied; skipping tests."
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Test command left the development worktree dirty. Local main was not modified." >&2
  exit 1
fi

if [ "$(git rev-parse refs/heads/main)" != "$main_before" ]; then
  echo "Local main changed during rebase or testing. Re-run after reviewing the new main." >&2
  exit 1
fi

main_worktree=$(
  git worktree list --porcelain |
    awk '
      /^worktree / { path = substr($0, 10) }
      /^branch refs\/heads\/main$/ { print path; exit }
    '
)

if [ -n "$main_worktree" ]; then
  mode="separate-main-worktree"
  if [ -n "$(git -C "$main_worktree" status --porcelain)" ]; then
    echo "Main worktree must be clean before squash merge: $main_worktree" >&2
    exit 1
  fi
else
  mode="single-worktree"
  main_worktree=$dev_worktree
  git switch main
fi

if ! git -C "$main_worktree" merge --squash "$dev_branch"; then
  echo "Squash merge failed. Resolve or restore the main worktree manually: $main_worktree" >&2
  exit 1
fi

if ! git -C "$main_worktree" commit -m "$commit_message"; then
  echo "Commit failed. Review the staged squash changes in: $main_worktree" >&2
  exit 1
fi

commit_sha=$(git -C "$main_worktree" rev-parse HEAD)

echo "MODE=$mode"
echo "MAIN_WORKTREE=$main_worktree"
echo "DEV_WORKTREE=$dev_worktree"
echo "DEV_BRANCH=$dev_branch"
echo "COMMIT=$commit_sha"
