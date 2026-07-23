---
name: merge-worktree
description: Rebase a completed development worktree branch onto local main, run a supplied test command, and squash-commit it into the main worktree through a validated script. Use when tested development work in a Git worktree is ready to merge into local main or when AGENTS.md invokes merge-worktree.
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

1. Ensure every development change is committed.
2. Compose the complete squash commit message and select the required test command.
3. Run the script with the development worktree path as the execution directory. Pass the commit message and test command:
   ```bash
   bash .agents/skills/merge-worktree/scripts/merge-worktree.sh \
     --message "<conventional-commit-message>" \
     --test-command "<test-command>"
   ```
4. Report the resulting commit and test status. Do not fetch, pull, push, delete branches, or remove worktrees.

The script validates clean worktrees, rebases the development branch onto local `main`, runs the supplied test command in the development worktree, locates the `main` worktree, performs `merge --squash`, and creates the supplied commit.
