---
name: merge-worktree
description: Commit staged changes directly on local main, or serialize, rebase, squash-commit on a temporary branch, optionally test, and fast-forward a completed development branch through a main worktree or the primary worktree. Use when local work is ready to commit or merge into main, or when AGENTS.md invokes merge-worktree.
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

On `main`, the script commits staged changes directly. On a development branch, it rebases the development branch onto `main`, creates a temporary branch from `main` in the development worktree, squash-merges and commits there, and runs the optional test against that squash commit. After verifying that `main` did not move, it restores the development branch, fast-forwards `main` to the temporary branch, and deletes the temporary branch. If `main` is checked out in another clean worktree, the fast-forward happens there. If no worktree has `main` checked out and the script is running in the primary worktree (the original repository directory), it switches that worktree to `main` before fast-forwarding, even when linked worktrees also exist. The same situation is rejected when the script is running in a linked worktree. It never updates `refs/heads/main` directly or creates a worktree.

## Validation

After changing this Skill, run:

```bash
bash .agents/skills/merge-worktree/tests/test-merge-worktree.sh
```
