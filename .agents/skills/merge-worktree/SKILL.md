---
name: merge-worktree
description: Commit staged changes directly on local main, or serialize, rebase, optionally test, and squash-commit a completed development branch through a main worktree or the only worktree. Use when local work is ready to commit or merge into main, or when AGENTS.md invokes merge-worktree.
---

# Merge Worktree

Merge completed worktree changes into local `main` as one Conventional Commit. Do not access remote refs.

## Workflow

1. Compose the squash commit message according to `AGENTS.md` and select an optional test command.
2. Use the current worktree as the execution directory:
   - On `main`, stage exactly the changes to commit. Leave no unstaged or untracked files.
   - On a development branch, commit every change and leave the worktree clean.
3. Run the script:
   ```bash
   bash .agents/skills/merge-worktree/scripts/merge-worktree.sh \
     --message "<conventional-commit-message>" \
     --test-command "<test-command>"
   ```
   Omit `--test-command` when no test is required.
4. Report the resulting mode, commit, and test status. Do not fetch, pull, push, create, delete, or remove worktrees or branches.

The script holds a repository-wide lock in the Git common directory for its entire operation, so concurrent `merge-worktree` invocations fail without modifying either worktree. The lock does not coordinate unrelated Git commands.

On `main`, the script commits staged changes directly. On a development branch, it rebases and tests in the development worktree and verifies that `main` did not move. If `main` is checked out in another clean worktree, it squash-merges and commits there. If the repository has only the current worktree and `main` is not checked out, it switches that worktree to `main` before squash-merging and committing. If multiple worktrees exist but none has `main` checked out, it fails instead of choosing a target. It never updates `refs/heads/main` directly or creates a worktree.

## Validation

After changing this Skill, run:

```bash
bash .agents/skills/merge-worktree/tests/test-merge-worktree.sh
```
