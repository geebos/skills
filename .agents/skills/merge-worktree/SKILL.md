---
name: merge-worktree
description: Commit staged changes directly on local main, or rebase a completed development branch onto local main, optionally test it, and squash-commit it in single- or multi-worktree repositories. Use when local work is ready to commit or merge into main, or when AGENTS.md invokes merge-worktree.
---

# Merge Worktree

Merge completed worktree changes into local `main` as one Conventional Commit. Do not access remote refs.

## Squash Commit Message

The squash commit message must use Conventional Commits and list every meaningful change. Do not use only a generic one-line message.

```text
<type>[optional scope]: <description>

- <change 1>
- <change 2>
- <change 3>
```

## Workflow

1. Compose the complete commit message and select an optional test command.
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
4. Report the resulting mode, commit, and test status. Do not fetch, pull, push, delete branches, or remove worktrees.

On `main`, the script commits staged changes directly. On a development branch, it rebases onto local `main`, runs the optional test, then squash-merges into an existing `main` worktree or switches the single worktree to `main` before committing.
